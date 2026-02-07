import { getBolt11InvoiceForLnAddress } from '../lightning/lnAddress.js';
function satsFromMsat(amountMsat) {
    if (amountMsat % 1000n !== 0n) {
        // We can support msat later if we route to a provider that supports it.
        throw new Error(`amountMsat must be divisible by 1000 (got ${amountMsat})`);
    }
    const sats = amountMsat / 1000n;
    if (sats > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error('amount too large');
    return Number(sats);
}
export async function opennodeSendToLnAddress(opts) {
    const baseUrl = (opts.config.baseUrl ?? 'https://api.opennode.co').replace(/\/$/, '');
    // 1) Resolve LN Address -> LNURLp invoice (BOLT11)
    const { bolt11 } = await getBolt11InvoiceForLnAddress({
        lnAddress: opts.destinationLnAddress,
        amountMsat: opts.amountMsat,
        comment: opts.comment,
    });
    // 2) Pay invoice via OpenNode LN withdrawal
    const body = {
        type: 'ln',
        amount: satsFromMsat(opts.amountMsat),
        address: bolt11,
        // OpenNode webhook for async settlement (application/x-www-form-urlencoded)
        callback_url: opts.callbackUrl,
        // external_id: opts.idempotencyKey, // if supported (undocumented in current docs)
    };
    // Avoid sending undefined fields (some APIs are picky)
    if (!body.callback_url)
        delete body.callback_url;
    const res = await fetch(`${baseUrl}/v2/withdrawals`, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: opts.config.apiKey,
            // Some APIs accept idempotency keys via header; OpenNode docs don't specify,
            // but keeping this here makes the intent explicit and is harmless if ignored.
            'x-idempotency-key': opts.idempotencyKey,
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`OpenNode withdrawal failed (${res.status}): ${text.slice(0, 500)}`);
    }
    let json;
    try {
        json = JSON.parse(text);
    }
    catch {
        throw new Error(`OpenNode withdrawal: invalid JSON: ${text.slice(0, 200)}`);
    }
    const w = json?.data;
    if (!w?.id) {
        throw new Error(`OpenNode withdrawal: missing data.id`);
    }
    return {
        provider: 'opennode',
        withdrawal: w,
        bolt11,
    };
}
