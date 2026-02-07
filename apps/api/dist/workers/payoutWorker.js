import 'dotenv/config';
import fs from 'node:fs/promises';
import { constants as FS_CONSTANTS } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../prisma.js';
import { opennodeSendToLnAddress } from '../payouts/opennode.js';
function parseArgs(argv) {
    const args = { limit: 25, dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run')
            args.dryRun = true;
        else if (a === '--limit') {
            const v = argv[i + 1];
            if (!v)
                throw new Error('Missing value for --limit');
            args.limit = Number(v);
            if (!Number.isFinite(args.limit) || args.limit <= 0) {
                throw new Error(`Invalid --limit: ${v}`);
            }
            i++;
        }
        else if (a === '--help' || a === '-h') {
            // eslint-disable-next-line no-console
            console.log('Usage: tsx src/workers/payoutWorker.ts [--limit N] [--dry-run]');
            process.exit(0);
        }
    }
    return args;
}
async function acquireLock(opts) {
    const lockPath = path.join(os.tmpdir(), 'marketplace-payout-worker.lock');
    // Best-effort stale lock cleanup.
    try {
        const st = await fs.stat(lockPath);
        const ageMs = Date.now() - st.mtimeMs;
        if (ageMs > opts.staleMs) {
            await fs.unlink(lockPath);
        }
    }
    catch {
        // ignore
    }
    try {
        const fh = await fs.open(lockPath, FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_WRONLY, 0o644);
        await fh.writeFile(JSON.stringify({
            startedAt: new Date().toISOString(),
            pid: process.pid,
        }));
        await fh.close();
        return {
            lockPath,
            release: async () => {
                await fs.unlink(lockPath).catch(() => undefined);
            },
        };
    }
    catch {
        return null;
    }
}
async function main() {
    const { limit, dryRun } = parseArgs(process.argv.slice(2));
    const lock = await acquireLock({ staleMs: 10 * 60 * 1000 });
    if (!lock) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({
            worker: 'payout',
            msg: 'lock-busy',
            at: new Date().toISOString(),
            dryRun,
        }));
        return;
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
        worker: 'payout',
        msg: 'tick',
        at: new Date().toISOString(),
        lockPath: lock.lockPath,
        limit,
        dryRun,
    }));
    const payouts = await prisma.payout.findMany({
        where: { status: { in: ['SCHEDULED', 'RETRYING'] } },
        orderBy: { createdAt: 'asc' },
        take: limit,
    });
    const opennodeApiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
    const opennodeBaseUrl = (process.env.OPENNODE_BASE_URL ?? '').trim();
    const opennodeCallbackUrl = (process.env.OPENNODE_WITHDRAWAL_CALLBACK_URL ?? '').trim();
    const payoutProvider = opennodeApiKey ? 'opennode' : 'mock';
    let sent = 0;
    let skippedAlreadySent = 0;
    let errored = 0;
    for (const p of payouts) {
        try {
            // Provider strategy:
            // - If OPENNODE_API_KEY is set, we submit a Lightning withdrawal via OpenNode.
            // - Otherwise we fall back to a mock provider.
            //
            // Idempotency strategy (still ledger-backed):
            // - Payout is unique per purchase.
            // - We only create a single ledger entry of type PAYOUT_SENT per purchase (dedupeKey).
            // - If the payout is already SENT, we skip.
            if (dryRun) {
                // eslint-disable-next-line no-console
                console.log(`[dry-run] would send payout ${p.id} purchaseId=${p.purchaseId} amountMsat=${p.amountMsat} provider=${payoutProvider}`);
                continue;
            }
            // Execute provider call outside the DB transaction.
            // If it succeeds, we record it in an atomic transaction.
            let providerMeta = { provider: payoutProvider };
            if (payoutProvider === 'opennode') {
                const result = await opennodeSendToLnAddress({
                    config: { apiKey: opennodeApiKey, baseUrl: opennodeBaseUrl || undefined },
                    destinationLnAddress: p.destinationLnAddress,
                    amountMsat: p.amountMsat,
                    idempotencyKey: p.idempotencyKey,
                    comment: `marketplace payout ${p.id}`,
                    callbackUrl: opennodeCallbackUrl || undefined,
                });
                providerMeta = {
                    provider: 'opennode',
                    withdrawalId: result.withdrawal.id,
                    withdrawalStatus: result.withdrawal.status,
                    withdrawalFeeSats: result.withdrawal.fee,
                    callbackUrlConfigured: Boolean(opennodeCallbackUrl),
                };
            }
            else {
                // mock provider: pretend we submitted it successfully
                providerMeta = { provider: 'mock' };
            }
            await prisma.$transaction(async (tx) => {
                const fresh = await tx.payout.findUnique({ where: { id: p.id } });
                if (!fresh)
                    return;
                if (fresh.status === 'SENT') {
                    skippedAlreadySent++;
                    return;
                }
                const existingLedger = await tx.ledgerEntry.findFirst({
                    where: { purchaseId: fresh.purchaseId, type: 'PAYOUT_SUBMITTED' },
                });
                await tx.payout.update({
                    where: { id: fresh.id },
                    data: {
                        status: 'SUBMITTED',
                        provider: providerMeta.provider,
                        providerWithdrawalId: providerMeta.withdrawalId ?? null,
                        providerMetaJson: providerMeta,
                        submittedAt: new Date(),
                        attemptCount: { increment: 1 },
                        lastError: null,
                    },
                });
                if (!existingLedger) {
                    try {
                        await tx.ledgerEntry.create({
                            data: {
                                purchaseId: fresh.purchaseId,
                                type: 'PAYOUT_SUBMITTED',
                                amountMsat: fresh.amountMsat,
                                dedupeKey: `payout_submitted:${fresh.purchaseId}`,
                                metaJson: {
                                    payoutId: fresh.id,
                                    payoutIdempotencyKey: fresh.idempotencyKey,
                                    destinationLnAddress: fresh.destinationLnAddress,
                                    ...providerMeta,
                                },
                            },
                        });
                    }
                    catch (e) {
                        // If we race (or a prior attempt wrote it), treat unique-violation as already done.
                        // Prisma unique constraint error code: P2002
                        const code = e?.code;
                        if (code !== 'P2002')
                            throw e;
                    }
                }
            });
            sent++;
        }
        catch (e) {
            errored++;
            const msg = e instanceof Error ? e.message : String(e);
            // Best-effort mark as RETRYING.
            try {
                await prisma.payout.update({
                    where: { id: p.id },
                    data: {
                        status: 'RETRYING',
                        attemptCount: { increment: 1 },
                        lastError: msg.slice(0, 500),
                    },
                });
            }
            catch {
                // ignore
            }
            // eslint-disable-next-line no-console
            console.error(`payoutWorker: error processing payout ${p.id}: ${msg}`);
        }
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
        scanned: payouts.length,
        sent,
        skippedAlreadySent,
        errored,
        dryRun,
    }));
    await lock.release();
}
main()
    .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
});
