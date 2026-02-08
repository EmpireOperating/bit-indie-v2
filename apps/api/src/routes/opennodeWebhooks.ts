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
    const hashedOrder = normalizeHashedOrder(body.hashed_order);
    const received = hashedOrder.digest;
    const { error, error_truncated } = normalizeError(body.error);
    const processedAtMeta = normalizeProcessedAt(body.processed_at);
    const feeMeta = normalizeNumericAudit(body.fee);
    const amountMeta = normalizeNumericAudit(body.amount);

    // Persist a subset of the webhook payload for auditability.
    // NOTE: keep this strictly additive / behavior-neutral.
    const webhookMeta = {
      receivedAt: new Date().toISOString(),
      status,
      ...processedAtMeta,
      fee: body.fee ?? null,
      fee_number: feeMeta.number,
      fee_valid: feeMeta.valid,
      amount: amountMeta.raw,
      amount_number: amountMeta.number,
      amount_valid: amountMeta.valid,
      hashed_order_prefixed: hashedOrder.hadPrefix,
      hashed_order_valid_hex: hashedOrder.validHex,
      error,
      error_truncated,
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
                  ...webhookMeta,
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
                  ...webhookMeta,
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
            webhook: webhookMeta,
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
          webhook: webhookMeta,
        },
      },
    });

    return reply.code(200).send(ok({}));
  });
}
