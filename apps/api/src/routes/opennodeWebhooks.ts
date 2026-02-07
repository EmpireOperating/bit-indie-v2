import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../prisma.js';

function hmacHex(key: string, msg: string): string {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

// OpenNode withdrawals webhook:
// POST callback_url | application/x-www-form-urlencoded
// { id, type, amount, reference, processed_at, address, fee, status, error, hashed_order }
export async function registerOpenNodeWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/opennode/withdrawals', async (req, reply) => {
    const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
    if (!apiKey) {
      req.log.warn({ route: 'opennode.withdrawals' }, 'OPENNODE_API_KEY not set; rejecting webhook');
      return reply.code(500).send({ ok: false });
    }

    const body = (req.body ?? {}) as Record<string, any>;

    const withdrawalId = String(body.id ?? '').trim();
    const status = String(body.status ?? '').trim();
    const received = String(body.hashed_order ?? '').trim();
    const error = body.error ? String(body.error).slice(0, 500) : null;

    // Persist a subset of the webhook payload for auditability.
    // NOTE: keep this strictly additive / behavior-neutral.
    const webhookMeta = {
      receivedAt: new Date().toISOString(),
      status,
      processed_at: body.processed_at ?? null,
      fee: body.fee ?? null,
      error,
    };

    if (!withdrawalId || !received) {
      return reply.code(400).send({ ok: false, error: 'missing id/hashed_order' });
    }

    const calculated = hmacHex(apiKey, withdrawalId);
    if (calculated !== received) {
      req.log.warn({ withdrawalId }, 'opennode withdrawals webhook: invalid hashed_order');
      return reply.code(401).send({ ok: false });
    }

    const payout = await prisma.payout.findFirst({ where: { provider: 'opennode', providerWithdrawalId: withdrawalId } });
    if (!payout) {
      req.log.warn({ withdrawalId }, 'opennode withdrawals webhook: payout not found');
      // 200 to prevent webhook retries from hammering us forever.
      return reply.code(200).send({ ok: true });
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

      return reply.code(200).send({ ok: true });
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

      return reply.code(200).send({ ok: true });
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

    return reply.code(200).send({ ok: true });
  });
}
