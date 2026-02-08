import { getBolt11InvoiceForLnAddress } from '../lightning/lnAddress.js';

export type OpenNodeConfig = {
  apiKey: string;
  baseUrl?: string; // default https://api.opennode.co
};

export type OpenNodeWithdrawal = {
  id: string;
  type: 'ln' | string;
  amount: number;
  reference?: string;
  fee?: number;
  status?: string;
  processed_at?: number;
};

function openNodeBaseUrl(config: OpenNodeConfig): string {
  return (config.baseUrl ?? 'https://api.opennode.co').replace(/\/$/, '');
}

function openNodeHeaders(apiKey: string, idempotencyKey: string): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: apiKey,
    'x-idempotency-key': idempotencyKey,
  };
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  const out = { ...input };
  for (const [k, v] of Object.entries(out)) {
    if (v === undefined) delete (out as any)[k];
  }
  return out;
}

function satsFromMsat(amountMsat: bigint): number {
  if (amountMsat % 1000n !== 0n) {
    // We can support msat later if we route to a provider that supports it.
    throw new Error(`amountMsat must be divisible by 1000 (got ${amountMsat})`);
  }
  const sats = amountMsat / 1000n;
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount too large');
  return Number(sats);
}

export async function opennodeSendToLnAddress(opts: {
  config: OpenNodeConfig;
  destinationLnAddress: string;
  amountMsat: bigint;
  idempotencyKey: string;
  comment?: string;
  callbackUrl?: string;
}): Promise<{ provider: 'opennode'; withdrawal: OpenNodeWithdrawal; bolt11: string }> {
  const baseUrl = openNodeBaseUrl(opts.config);

  // 1) Resolve LN Address -> LNURLp invoice (BOLT11)
  const { bolt11 } = await getBolt11InvoiceForLnAddress({
    lnAddress: opts.destinationLnAddress,
    amountMsat: opts.amountMsat,
    comment: opts.comment,
  });

  // 2) Pay invoice via OpenNode LN withdrawal
  const body = omitUndefined({
    type: 'ln',
    amount: satsFromMsat(opts.amountMsat),
    address: bolt11,
    // OpenNode webhook for async settlement (application/x-www-form-urlencoded)
    callback_url: opts.callbackUrl || undefined,
    // external_id: opts.idempotencyKey, // if supported (undocumented in current docs)
  });

  const res = await fetch(`${baseUrl}/v2/withdrawals`, {
    method: 'POST',
    // Some APIs accept idempotency keys via header; OpenNode docs don't specify,
    // but keeping this here makes the intent explicit and is harmless if ignored.
    headers: openNodeHeaders(opts.config.apiKey, opts.idempotencyKey),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenNode withdrawal failed (${res.status}): ${text.slice(0, 500)}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenNode withdrawal: invalid JSON: ${text.slice(0, 200)}`);
  }

  const w = json?.data as Partial<OpenNodeWithdrawal>;
  if (!w?.id) {
    throw new Error(`OpenNode withdrawal: missing data.id`);
  }

  return {
    provider: 'opennode',
    withdrawal: w as OpenNodeWithdrawal,
    bolt11,
  };
}
