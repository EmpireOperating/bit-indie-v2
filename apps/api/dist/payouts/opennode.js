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
        // NOTE: OpenNode docs suggest using callback_url for async settlement.
        // We do not provide one in v1, so we treat a successful 201 response as “submitted”.
        // callback_url: undefined,
        // external_id: opts.idempotencyKey, // if supported (undocumented in current docs)
    };
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
