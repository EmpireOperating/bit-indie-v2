import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../prisma.js';
import { fail, ok } from './httpResponses.js';

function hmacHex(key: string, msg: string): string {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

function safeHexEquals(a: string, b: string): boolean {
  const aHex = a.trim().toLowerCase();
  const bHex = b.trim().toLowerCase();
  if (aHex.length !== bHex.length) return false;

  const aBuf = Buffer.from(aHex, 'utf8');
  const bBuf = Buffer.from(bHex, 'utf8');
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function normalizeHashedOrder(value: unknown): {
  digest: string;
  hadPrefix: boolean;
  validHex: boolean;
} {
  const raw = String(value ?? '').trim();
  const hadPrefix = raw.toLowerCase().startsWith('sha256=');
  const digest = hadPrefix ? raw.slice('sha256='.length).trim() : raw;
  const validHex = /^[0-9a-fA-F]{64}$/.test(digest);

  return {
    digest,
    hadPrefix,
    validHex,
  };
}

function normalizeProcessedAt(value: unknown): {
  processed_at: string | null;
  processed_at_iso: string | null;
  processed_at_valid: boolean;
} {
  const processedAt = String(value ?? '').trim();
  if (!processedAt) {
    return {
      processed_at: null,
      processed_at_iso: null,
      processed_at_valid: false,
    };
  }

  const parsedMs = Date.parse(processedAt);
  if (!Number.isNaN(parsedMs)) {
    return {
      processed_at: processedAt,
      processed_at_iso: new Date(parsedMs).toISOString(),
      processed_at_valid: true,
    };
  }

  return {
    processed_at: processedAt,
    processed_at_iso: null,
    processed_at_valid: false,
  };
}

function normalizeError(value: unknown): { error: string | null; error_truncated: boolean } {
  const errorRaw = String(value ?? '').trim();
  if (!errorRaw) return { error: null, error_truncated: false };

  if (errorRaw.length > 500) {
    return {
      error: errorRaw.slice(0, 500),
      error_truncated: true,
    };
  }

  return {
    error: errorRaw,
    error_truncated: false,
  };
}

function normalizeNumericAudit(value: unknown): {
  raw: string | null;
  number: number | null;
  valid: boolean;
} {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return {
      raw: null,
      number: null,
      valid: false,
    };
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return {
      raw,
      number: null,
      valid: false,
    };
  }

  return {
    raw,
    number: numeric,
    valid: true,
  };
}

function normalizeAddress(value: unknown): {
  address: string | null;
  valid: boolean;
  kind: 'bech32' | 'base58' | 'unknown' | null;
} {
  const address = String(value ?? '').trim();
  if (!address) {
    return {
      address: null,
      valid: false,
      kind: null,
    };
  }

  const bech32Like = /^(bc1|tb1|bcrt1)[ac-hj-np-z02-9]{11,100}$/i.test(address);
  if (bech32Like) {
    return {
      address,
      valid: true,
      kind: 'bech32',
    };
  }

  const base58Like = /^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,49}$/.test(address);
  if (base58Like) {
    return {
      address,
      valid: true,
      kind: 'base58',
    };
  }

  return {
    address,
    valid: false,
    kind: 'unknown',
  };
}

function normalizeReference(value: unknown): { reference: string | null; reference_truncated: boolean } {
  const referenceRaw = String(value ?? '').trim();
  if (!referenceRaw) return { reference: null, reference_truncated: false };

  if (referenceRaw.length > 200) {
    return {
      reference: referenceRaw.slice(0, 200),
      reference_truncated: true,
    };
  }

  return {
    reference: referenceRaw,
    reference_truncated: false,
  };
}

function normalizeWebhookId(value: unknown): {
  id: string | null;
  id_raw: string | null;
  id_length: number | null;
  id_truncated: boolean;
  id_had_surrounding_whitespace: boolean;
} {
  const idRaw = String(value ?? '');
  const idTrimmed = idRaw.trim();
  if (!idTrimmed) {
    return {
      id: null,
      id_raw: null,
      id_length: null,
      id_truncated: false,
      id_had_surrounding_whitespace: false,
    };
  }

  const idTruncated = idTrimmed.length > 128;
  return {
    id: idTruncated ? idTrimmed.slice(0, 128) : idTrimmed,
    id_raw: idTrimmed,
    id_length: idTrimmed.length,
    id_truncated: idTruncated,
    id_had_surrounding_whitespace: idRaw !== idTrimmed,
  };
}

function normalizeType(value: unknown): {
  type: string | null;
  type_raw: string | null;
  type_known: boolean;
} {
  const typeRaw = String(value ?? '').trim();
  if (!typeRaw) {
    return {
      type: null,
      type_raw: null,
      type_known: false,
    };
  }

  const type = typeRaw.toLowerCase();
  return {
    type,
    type_raw: typeRaw,
    type_known: type === 'withdrawal',
  };
}

function webhookPayoutIdAuditMeta(withdrawalId: string, providerWithdrawalId: unknown): {
  provider_withdrawal_id: string | null;
  provider_withdrawal_id_length: number | null;
  provider_withdrawal_id_matches: boolean;
  provider_withdrawal_id_casefold_matches: boolean;
} {
  const providerId = String(providerWithdrawalId ?? '').trim();
  const inboundId = String(withdrawalId ?? '').trim();

  if (!providerId) {
    return {
      provider_withdrawal_id: null,
      provider_withdrawal_id_length: null,
      provider_withdrawal_id_matches: false,
      provider_withdrawal_id_casefold_matches: false,
    };
  }

  return {
    provider_withdrawal_id: providerId,
    provider_withdrawal_id_length: providerId.length,
    provider_withdrawal_id_matches: providerId === inboundId,
    provider_withdrawal_id_casefold_matches: providerId.toLowerCase() === inboundId.toLowerCase(),
  };
}

function webhookAmountFeeAuditMeta(amountMeta: { number: number | null; valid: boolean }, feeMeta: { number: number | null; valid: boolean }): {
  amount_negative: boolean;
  amount_zero: boolean;
  fee_negative: boolean;
  fee_zero: boolean;
  fee_greater_than_amount: boolean;
  fee_equal_amount: boolean;
} {
  const amount = amountMeta.valid ? amountMeta.number : null;
  const fee = feeMeta.valid ? feeMeta.number : null;

  return {
    amount_negative: amount != null ? amount < 0 : false,
    amount_zero: amount != null ? amount === 0 : false,
    fee_negative: fee != null ? fee < 0 : false,
    fee_zero: fee != null ? fee === 0 : false,
    fee_greater_than_amount: fee != null && amount != null ? fee > amount : false,
    fee_equal_amount: fee != null && amount != null ? fee === amount : false,
  };
}

function webhookStatusErrorAuditMeta(status: string, error: string | null): {
  error_present: boolean;
  error_missing_for_failure: boolean;
  error_present_on_confirmed: boolean;
  error_present_on_unknown_status: boolean;
} {
  const errorPresent = Boolean(error);
  const statusIsFailure = status === 'error' || status === 'failed';
  const statusIsConfirmed = status === 'confirmed';
  const statusIsUnknown = !statusIsFailure && !statusIsConfirmed;

  return {
    error_present: errorPresent,
    error_missing_for_failure: statusIsFailure && !errorPresent,
    error_present_on_confirmed: statusIsConfirmed && errorPresent,
    error_present_on_unknown_status: statusIsUnknown && errorPresent,
  };
}

// OpenNode withdrawals webhook:
// POST callback_url | application/x-www-form-urlencoded
// { id, type, amount, reference, processed_at, address, fee, status, error, hashed_order }
export async function registerOpenNodeWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/opennode/withdrawals', async (req, reply) => {
    const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
    if (!apiKey) {
      req.log.warn({ route: 'opennode.withdrawals' }, 'OPENNODE_API_KEY not set; rejecting webhook');
      // Misconfiguration: do not pretend success; but also avoid 500 which implies an internal crash.
      return reply.code(503).send(fail('opennode webhook misconfigured'));
    }

    const body = (req.body ?? {}) as Record<string, any>;

    const withdrawalId = String(body.id ?? '').trim();
    const statusRaw = String(body.status ?? '').trim();
    const status = statusRaw.toLowerCase();
    const statusKnown = status === 'confirmed' || status === 'error' || status === 'failed';
    const hashedOrder = normalizeHashedOrder(body.hashed_order);
    const received = hashedOrder.digest;
    const { error, error_truncated } = normalizeError(body.error);
    const processedAtMeta = normalizeProcessedAt(body.processed_at);
    const feeMeta = normalizeNumericAudit(body.fee);
    const amountMeta = normalizeNumericAudit(body.amount);
    const addressMeta = normalizeAddress(body.address);
    const referenceMeta = normalizeReference(body.reference);
    const webhookIdMeta = normalizeWebhookId(body.id);
    const typeMeta = normalizeType(body.type);
    const amountFeeAuditMeta = webhookAmountFeeAuditMeta(amountMeta, feeMeta);
    const statusErrorAuditMeta = webhookStatusErrorAuditMeta(status, error);

    // Persist a subset of the webhook payload for auditability.
    // NOTE: keep this strictly additive / behavior-neutral.
    const webhookMeta = {
      receivedAt: new Date().toISOString(),
      status,
      status_raw: statusRaw || null,
      status_known: statusKnown,
      id: webhookIdMeta.id,
      id_raw: webhookIdMeta.id_raw,
      id_length: webhookIdMeta.id_length,
      id_truncated: webhookIdMeta.id_truncated,
      id_had_surrounding_whitespace: webhookIdMeta.id_had_surrounding_whitespace,
      ...processedAtMeta,
      fee: body.fee ?? null,
      fee_number: feeMeta.number,
      fee_valid: feeMeta.valid,
      amount: amountMeta.raw,
      amount_number: amountMeta.number,
      amount_valid: amountMeta.valid,
      ...amountFeeAuditMeta,
      address: addressMeta.address,
      address_valid: addressMeta.valid,
      address_kind: addressMeta.kind,
      reference: referenceMeta.reference,
      reference_truncated: referenceMeta.reference_truncated,
      type: typeMeta.type,
      type_raw: typeMeta.type_raw,
      type_known: typeMeta.type_known,
      hashed_order_prefixed: hashedOrder.hadPrefix,
      hashed_order_valid_hex: hashedOrder.validHex,
      error,
      error_truncated,
      ...statusErrorAuditMeta,
    };

    if (!withdrawalId || !received) {
      return reply.code(400).send(fail('missing id/hashed_order'));
    }

    if (!status) {
      return reply.code(400).send(fail('missing status'));
    }

    const calculated = hmacHex(apiKey, withdrawalId);
    if (!safeHexEquals(calculated, received)) {
      req.log.warn({ withdrawalId }, 'opennode withdrawals webhook: invalid hashed_order');
      return reply.code(401).send(fail('Unauthorized'));
    }

    const payout = await prisma.payout.findFirst({ where: { provider: 'opennode', providerWithdrawalId: withdrawalId } });
    if (!payout) {
      req.log.warn({ withdrawalId }, 'opennode withdrawals webhook: payout not found');
      // 200 to prevent webhook retries from hammering us forever.
      return reply.code(200).send(ok({}));
    }

    const webhookMetaWithPayoutId = {
      ...webhookMeta,
      ...webhookPayoutIdAuditMeta(withdrawalId, payout.providerWithdrawalId),
    };

    if (status === 'confirmed') {
      // Mark SENT only on confirmation + write idempotent ledger entry.
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.payout.findUnique({ where: { id: payout.id } });
        if (!fresh) return;

        if (fresh.status !== 'SENT') {
          await tx.payout.update({
            where: { id: fresh.id },
            data: {
              status: 'SENT',
              confirmedAt: new Date(),
              lastError: null,
              providerMetaJson: {
                ...(typeof fresh.providerMetaJson === 'object' && fresh.providerMetaJson ? (fresh.providerMetaJson as any) : {}),
                webhook: {
                  ...webhookMetaWithPayoutId,
                  error: null,
                },
              },
            },
          });
        } else {
          // Even if we're already SENT (e.g., webhook retry), persist webhook meta for auditability.
          // Keep this behavior-neutral: no status/confirmedAt changes, just providerMetaJson.
          await tx.payout.update({
            where: { id: fresh.id },
            data: {
              providerMetaJson: {
                ...(typeof fresh.providerMetaJson === 'object' && fresh.providerMetaJson ? (fresh.providerMetaJson as any) : {}),
                webhook: {
                  ...webhookMetaWithPayoutId,
                  error: null,
                },
              },
            },
          });
        }

        const existing = await tx.ledgerEntry.findFirst({ where: { purchaseId: fresh.purchaseId, type: 'PAYOUT_SENT' } });
        if (!existing) {
          try {
            await tx.ledgerEntry.create({
              data: {
                purchaseId: fresh.purchaseId,
                type: 'PAYOUT_SENT',
                amountMsat: fresh.amountMsat,
                dedupeKey: `payout_sent:${fresh.purchaseId}`,
                metaJson: {
                  payoutId: fresh.id,
                  provider: fresh.provider,
                  providerWithdrawalId: fresh.providerWithdrawalId,
                },
              },
            });
          } catch (e) {
            const code = (e as any)?.code;
            if (code !== 'P2002') throw e;
          }
        }
      });

      return reply.code(200).send(ok({}));
    }

    if (status === 'error' || status === 'failed') {
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          lastError: error ?? `opennode withdrawal ${withdrawalId} status=${status}`,
          providerMetaJson: {
            ...(typeof payout.providerMetaJson === 'object' && payout.providerMetaJson ? (payout.providerMetaJson as any) : {}),
            webhook: webhookMetaWithPayoutId,
          },
        },
      });

      return reply.code(200).send(ok({}));
    }

    // Unknown status; keep payout in SUBMITTED, but record receipt.
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        providerMetaJson: {
          ...(typeof payout.providerMetaJson === 'object' && payout.providerMetaJson ? (payout.providerMetaJson as any) : {}),
          webhook: webhookMetaWithPayoutId,
        },
      },
    });

    return reply.code(200).send(ok({}));
  });
}
