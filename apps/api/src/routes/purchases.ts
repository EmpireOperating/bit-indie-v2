import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../prisma.js';

const receiptCodeSchema = z
  .string()
  .min(6)
  .max(128)
  .regex(/^[A-Z0-9-]+$/i, 'receiptCode must be alphanumeric (plus hyphen)');

// Marketplace v1 identity spine is pubkey.
// For now this route accepts pubkey directly (no session/auth yet).
const pubkeySchema = z.string().min(32).max(128);

const claimBodySchema = z.object({
  receiptCode: receiptCodeSchema,
  buyerPubkey: pubkeySchema,
});

const uuidSchema = z.string().uuid();

const createPurchaseBodySchema = z.object({
  gameId: uuidSchema,
  amountMsat: z.union([z.string(), z.number(), z.bigint()]),
  buyerPubkey: pubkeySchema.optional(),
});

const webhookPaidBodySchema = z.object({
  invoiceId: z.string().min(1).max(256),
  paidAt: z.string().datetime().optional(),
});

function parseAmountMsat(v: string | number | bigint): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
      throw new Error('amountMsat must be a non-negative integer');
    }
    return BigInt(v);
  }

  // string
  if (!/^[0-9]+$/.test(v)) throw new Error('amountMsat must be an integer string');
  return BigInt(v);
}

function makeGuestReceiptCode(): string {
  // Human-typable, case-insensitive, with hyphens.
  // Use base64url, strip non-alphanumerics, uppercase.
  const raw = randomBytes(12)
    .toString('base64url')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
  return raw.slice(0, 5) + '-' + raw.slice(5, 10) + '-' + raw.slice(10, 15);
}

function fee10pct(amountMsat: bigint): { platformFeeMsat: bigint; developerNetMsat: bigint } {
  const platformFeeMsat = (amountMsat * 10n) / 100n;
  return { platformFeeMsat, developerNetMsat: amountMsat - platformFeeMsat };
}

function serializePurchase(p: any) {
  return {
    ...p,
    amountMsat: typeof p.amountMsat === 'bigint' ? p.amountMsat.toString() : p.amountMsat,
  };
}

async function ensurePaidArtifacts(tx: any, purchase: any, paidAt: Date) {
  const game = purchase.game;
  const devProfile = await tx.developerProfile.findUnique({ where: { userId: game.developerUserId } });
  if (!devProfile) {
    return { kind: 'missing_dev_profile' as const, purchaseId: purchase.id };
  }

  const entitlement = await tx.entitlement.upsert({
    where: { purchaseId: purchase.id },
    create: {
      purchaseId: purchase.id,
      buyerUserId: purchase.buyerUserId,
      guestReceiptCode: purchase.guestReceiptCode,
      gameId: purchase.gameId,
    },
    update: {
      buyerUserId: purchase.buyerUserId,
      guestReceiptCode: purchase.guestReceiptCode,
      gameId: purchase.gameId,
      revokedAt: null,
    },
  });

  const { platformFeeMsat, developerNetMsat } = fee10pct(purchase.amountMsat);

  const existingLedger = await tx.ledgerEntry.findMany({
    where: {
      purchaseId: purchase.id,
      type: { in: ['INVOICE_PAID', 'PLATFORM_FEE', 'DEVELOPER_NET'] },
    },
    select: { type: true },
  });
  const existingTypes = new Set(existingLedger.map((l: any) => l.type));

  if (!existingTypes.has('INVOICE_PAID')) {
    await tx.ledgerEntry.create({
      data: {
        purchaseId: purchase.id,
        type: 'INVOICE_PAID',
        amountMsat: purchase.amountMsat,
        metaJson: { paidAt: paidAt.toISOString(), invoiceId: purchase.invoiceId },
      },
    });
  }
  if (!existingTypes.has('PLATFORM_FEE')) {
    await tx.ledgerEntry.create({
      data: {
        purchaseId: purchase.id,
        type: 'PLATFORM_FEE',
        amountMsat: platformFeeMsat,
        metaJson: { feeBps: 1000 },
      },
    });
  }
  if (!existingTypes.has('DEVELOPER_NET')) {
    await tx.ledgerEntry.create({
      data: {
        purchaseId: purchase.id,
        type: 'DEVELOPER_NET',
        amountMsat: developerNetMsat,
        metaJson: { feeBps: 1000 },
      },
    });
  }

  await tx.payout.upsert({
    where: { purchaseId: purchase.id },
    create: {
      purchaseId: purchase.id,
      developerUserId: game.developerUserId,
      destinationLnAddress: devProfile.payoutLnAddress,
      amountMsat: developerNetMsat,
      status: 'SCHEDULED',
      idempotencyKey: `purchase:${purchase.id}`,
    },
    update: {
      destinationLnAddress: devProfile.payoutLnAddress,
      amountMsat: developerNetMsat,
      status: 'SCHEDULED',
    },
  });

  return {
    kind: 'ok' as const,
    purchaseId: purchase.id,
    entitlementId: entitlement.id,
  };
}

export async function registerPurchaseRoutes(app: FastifyInstance) {
  // Creates a purchase invoice for a game.
  // This is a minimal v1 implementation (invoice provider mocked).
  app.post('/purchases', async (req, reply) => {
    const parsed = createPurchaseBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    const { gameId, buyerPubkey } = parsed.data;
    let amountMsat: bigint;
    try {
      amountMsat = parseAmountMsat(parsed.data.amountMsat);
    } catch (e) {
      return reply.status(400).send({ ok: false, error: (e as Error).message });
    }

    // TODO: once pricing is implemented, amount should be derived server-side from the game/sku.
    if (amountMsat <= 0n) {
      return reply.status(400).send({ ok: false, error: 'amountMsat must be > 0' });
    }

    const invoiceProvider = 'mock';
    const invoiceId = `mock_${randomUUID()}`;

    const created = await prisma.$transaction(async (tx) => {
      const game = await tx.game.findUnique({ where: { id: gameId } });
      if (!game) return { kind: 'game_not_found' as const };

      const buyerUser = buyerPubkey
        ? await tx.user.upsert({
            where: { pubkey: buyerPubkey },
            create: { pubkey: buyerPubkey },
            update: {},
          })
        : null;

      const guestReceiptCode = buyerUser ? null : makeGuestReceiptCode();

      const purchase = await tx.purchase.create({
        data: {
          buyerUserId: buyerUser?.id ?? null,
          guestReceiptCode,
          gameId,
          invoiceProvider,
          invoiceId,
          status: 'PENDING',
          amountMsat,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          purchaseId: purchase.id,
          type: 'INVOICE_CREATED',
          amountMsat,
          metaJson: {
            invoiceProvider,
            invoiceId,
          },
        },
      });

      return { kind: 'ok' as const, purchase, guestReceiptCode };
    });

    if (created.kind === 'game_not_found') {
      return reply.status(404).send({ ok: false, error: 'Game not found' });
    }

    return reply.status(201).send({
      ok: true,
      purchase: serializePurchase(created.purchase),
      invoice: {
        provider: invoiceProvider,
        id: invoiceId,
        // Placeholder. Real provider will return a BOLT11 invoice + expiry.
        bolt11: null,
      },
      guestReceiptCode: created.guestReceiptCode,
    });
  });

  // Mock webhook for invoice paid.
  // Idempotent by invoiceId and self-healing for partially finalized purchases.
  app.post('/webhooks/mock/invoice-paid', async (req, reply) => {
    const secret = process.env.MOCK_WEBHOOK_SECRET;
    if (secret) {
      const got = String((req.headers['x-mock-webhook-secret'] ?? '')).trim();
      if (got !== secret) {
        return reply.status(401).send({ ok: false, error: 'Unauthorized' });
      }
    }

    const parsed = webhookPaidBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    const paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { invoiceId: parsed.data.invoiceId },
        include: { entitlement: true, game: true },
      });

      if (!purchase) return { kind: 'not_found' as const };

      // Already marked paid: still ensure all idempotent downstream artifacts exist.
      if (purchase.status === 'PAID') {
        const ensured = await ensurePaidArtifacts(tx, purchase, purchase.paidAt ?? paidAt);
        if (ensured.kind !== 'ok') return ensured;
        return { ...ensured, already: true, repaired: true };
      }

      if (purchase.status !== 'PENDING') {
        return {
          kind: 'invalid_status' as const,
          purchaseId: purchase.id,
          status: purchase.status,
        };
      }

      const updatedPurchase = await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          status: 'PAID',
          paidAt,
        },
      });

      const paidPurchase = { ...purchase, ...updatedPurchase };
      const ensured = await ensurePaidArtifacts(tx, paidPurchase, paidAt);
      if (ensured.kind !== 'ok') return ensured;

      return {
        ...ensured,
        already: false,
        repaired: false,
      };
    });

    switch (result.kind) {
      case 'not_found':
        return reply.status(404).send({ ok: false, error: 'Purchase not found' });
      case 'invalid_status':
        return reply.status(409).send({
          ok: false,
          error: 'Purchase not in PENDING state',
          purchaseId: result.purchaseId,
          status: result.status,
        });
      case 'missing_dev_profile':
        return reply.status(409).send({
          ok: false,
          error: 'Developer profile missing (payout LN address not set)',
          purchaseId: result.purchaseId,
        });
      case 'ok':
        return reply.status(200).send({ ok: true, ...result });
      default:
        return reply.status(500).send({ ok: false, error: 'Unexpected result' });
    }
  });

  // Claims a guest receipt code into a user account.
  // Idempotent:
  // - If already claimed by the same user → returns ok.
  // - If claimed by a different user → 409.
  app.post('/purchases/claim', async (req, reply) => {
    const parsed = claimBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    const { receiptCode, buyerPubkey } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { guestReceiptCode: receiptCode },
        include: { entitlement: true },
      });

      if (!purchase) {
        return { kind: 'not_found' as const };
      }

      if (purchase.status !== 'PAID') {
        return {
          kind: 'not_paid' as const,
          purchaseId: purchase.id,
          status: purchase.status,
        };
      }

      const user = await tx.user.upsert({
        where: { pubkey: buyerPubkey },
        create: { pubkey: buyerPubkey },
        update: {},
      });

      // Already claimed?
      if (purchase.buyerUserId != null) {
        if (purchase.buyerUserId !== user.id) {
          return { kind: 'claimed_by_other' as const, purchaseId: purchase.id };
        }

        // Ensure entitlement is linked too (best-effort repair).
        const entitlement = purchase.entitlement
          ? await tx.entitlement.update({
              where: { purchaseId: purchase.id },
              data: { buyerUserId: user.id },
            })
          : await tx.entitlement.create({
              data: {
                purchaseId: purchase.id,
                buyerUserId: user.id,
                guestReceiptCode: purchase.guestReceiptCode,
                gameId: purchase.gameId,
              },
            });

        return {
          kind: 'ok' as const,
          purchaseId: purchase.id,
          entitlementId: entitlement.id,
          gameId: purchase.gameId,
          buyerUserId: user.id,
        };
      }

      // Claim it.
      const updatedPurchase = await tx.purchase.update({
        where: { id: purchase.id },
        data: { buyerUserId: user.id },
      });

      const entitlement = purchase.entitlement
        ? await tx.entitlement.update({
            where: { purchaseId: purchase.id },
            data: { buyerUserId: user.id },
          })
        : await tx.entitlement.create({
            data: {
              purchaseId: updatedPurchase.id,
              buyerUserId: user.id,
              guestReceiptCode: updatedPurchase.guestReceiptCode,
              gameId: updatedPurchase.gameId,
            },
          });

      return {
        kind: 'ok' as const,
        purchaseId: updatedPurchase.id,
        entitlementId: entitlement.id,
        gameId: updatedPurchase.gameId,
        buyerUserId: user.id,
      };
    });

    switch (result.kind) {
      case 'not_found':
        return reply.status(404).send({ ok: false, error: 'Receipt code not found' });
      case 'not_paid':
        return reply.status(409).send({
          ok: false,
          error: 'Purchase is not paid yet',
          purchaseId: result.purchaseId,
          status: result.status,
        });
      case 'claimed_by_other':
        return reply.status(409).send({ ok: false, error: 'Receipt code already claimed' });
      case 'ok':
        return reply.status(200).send({ ok: true, ...result });
      default:
        return reply.status(500).send({ ok: false, error: 'Unexpected result' });
    }
  });
}
