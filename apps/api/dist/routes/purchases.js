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
export async function registerPurchaseRoutes(app) {
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
                return { kind: 'not_found' };
            }
            if (purchase.status !== 'PAID') {
                return {
                    kind: 'not_paid',
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
                    return { kind: 'claimed_by_other', purchaseId: purchase.id };
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
                    kind: 'ok',
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
                kind: 'ok',
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
