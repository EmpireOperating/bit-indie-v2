import 'dotenv/config';

import fs from 'node:fs/promises';
import { constants as FS_CONSTANTS } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { prisma } from '../prisma.js';
import { opennodeSendToLnAddress } from '../payouts/opennode.js';

type Args = {
  limit: number;
  dryRun: boolean;
};

type WorkerResult = {
  scanned: number;
  sent: number;
  skippedAlreadySent: number;
  skippedMaxAttempts: number;
  errored: number;
  dryRun: boolean;
  providerMode: ProviderMode;
  maxAttempts: number;
};

type ProviderMode = 'mock' | 'opennode';

const PAYOUT_WORKER_MAX_LIMIT = 500;

function isInvalidPositiveInteger(value: number): boolean {
  return !Number.isFinite(value) || !Number.isInteger(value) || value <= 0;
}

export function resolveMaxAttemptsFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = (env.PAYOUT_MAX_ATTEMPTS ?? '').trim();
  if (!raw) return 3;

  const parsed = Number(raw);
  if (isInvalidPositiveInteger(parsed)) return 3;
  return parsed;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 25, dryRun: false };

  const parsePositiveInt = (label: string, raw: string): number => {
    const parsed = Number(raw);
    if (isInvalidPositiveInteger(parsed)) {
      throw new Error(`Invalid ${label}: ${raw}`);
    }
    return parsed;
  };

  const MAX_LIMIT = PAYOUT_WORKER_MAX_LIMIT;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';

    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (a === '--limit') {
      const v = argv[i + 1];
      if (!v) throw new Error('Missing value for --limit');
      args.limit = parsePositiveInt('--limit', v);
      if (args.limit > MAX_LIMIT) throw new Error(`Invalid --limit: ${v} (max ${MAX_LIMIT})`);
      i++;
      continue;
    }

    if (a.startsWith('--limit=')) {
      const v = a.slice('--limit='.length);
      if (!v) throw new Error('Missing value for --limit');
      args.limit = parsePositiveInt('--limit', v);
      if (args.limit > MAX_LIMIT) throw new Error(`Invalid --limit: ${v} (max ${MAX_LIMIT})`);
      continue;
    }

    if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log('Usage: tsx src/workers/payoutWorker.ts [--limit N|--limit=N] [--dry-run]   # limit: 1..500');
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${a}`);
  }

  return args;
}

export async function acquireLock(opts: {
  staleMs: number;
}): Promise<null | { lockPath: string; release: () => Promise<void> }> {
  const lockPath = path.join(os.tmpdir(), 'marketplace-payout-worker.lock');

  // Best-effort stale lock cleanup.
  try {
    const st = await fs.stat(lockPath);
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs > opts.staleMs) {
      await fs.unlink(lockPath);
    }
  } catch {
    // ignore
  }

  try {
    const fh = await fs.open(lockPath, FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_WRONLY, 0o644);
    await fh.writeFile(
      JSON.stringify({
        startedAt: new Date().toISOString(),
        pid: process.pid,
      })
    );
    await fh.close();

    return {
      lockPath,
      release: async () => {
        await fs.unlink(lockPath).catch(() => undefined);
      },
    };
  } catch {
    return null;
  }
}

export function resolvePayoutProviderFromEnv(env: NodeJS.ProcessEnv): {
  mode: ProviderMode;
  opennodeApiKey: string;
  opennodeBaseUrl: string;
  opennodeCallbackUrl: string;
} {
  const opennodeApiKey = (env.OPENNODE_API_KEY ?? '').trim();
  const opennodeBaseUrl = (env.OPENNODE_BASE_URL ?? '').trim();
  const opennodeCallbackUrl = (env.OPENNODE_WITHDRAWAL_CALLBACK_URL ?? '').trim();

  return {
    mode: opennodeApiKey ? 'opennode' : 'mock',
    opennodeApiKey,
    opennodeBaseUrl,
    opennodeCallbackUrl,
  };
}

export async function runPayoutWorker(
  args: Args,
  deps: {
    prismaClient: any;
    sendToLnAddress: typeof opennodeSendToLnAddress;
    env: NodeJS.ProcessEnv;
  } = {
    prismaClient: prisma,
    sendToLnAddress: opennodeSendToLnAddress,
    env: process.env,
  }
): Promise<WorkerResult> {
  const { limit, dryRun } = args;
  const providerConfig = resolvePayoutProviderFromEnv(deps.env);
  const maxAttempts = resolveMaxAttemptsFromEnv(deps.env);
  const runId = `payout-run-${Date.now()}`;

  const lock = await acquireLock({ staleMs: 10 * 60 * 1000 });
  if (!lock) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        worker: 'payout',
        msg: 'lock-busy',
        at: new Date().toISOString(),
        dryRun,
      })
    );
    return {
      scanned: 0,
      sent: 0,
      skippedAlreadySent: 0,
      skippedMaxAttempts: 0,
      errored: 0,
      dryRun,
      providerMode: providerConfig.mode,
      maxAttempts,
    };
  }

  try {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        worker: 'payout',
        msg: 'tick',
        runId,
        at: new Date().toISOString(),
        lockPath: lock.lockPath,
        limit,
        dryRun,
        providerMode: providerConfig.mode,
        maxAttempts,
      })
    );

    const payouts = await deps.prismaClient.payout.findMany({
      where: { status: { in: ['SCHEDULED', 'RETRYING'] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let sent = 0;
    let skippedAlreadySent = 0;
    let skippedMaxAttempts = 0;
    let errored = 0;

    for (const p of payouts) {
      try {
        if (p.attemptCount >= maxAttempts) {
          skippedMaxAttempts++;
          await deps.prismaClient.payout.update({
            where: { id: p.id },
            data: {
              status: 'FAILED',
              lastError: `Exceeded retry budget (${maxAttempts})`,
            },
          });

          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              worker: 'payout',
              msg: 'marked-failed-max-attempts',
              runId,
              payoutId: p.id,
              purchaseId: p.purchaseId,
              attemptCount: p.attemptCount,
              maxAttempts,
            })
          );
          continue;
        }

        // Provider strategy:
        // - If OPENNODE_API_KEY is set, submit via OpenNode.
        // - Otherwise use mock mode for non-secret local/test runs.
        //
        // Idempotency strategy:
        // - Payout is unique per purchase.
        // - We only create a single ledger entry of type PAYOUT_SUBMITTED per purchase (dedupeKey).
        // - If payout status is already SENT, we do not write duplicate ledger entries.

        if (dryRun) {
          // eslint-disable-next-line no-console
          console.log(
            `[dry-run] would send payout ${p.id} purchaseId=${p.purchaseId} amountMsat=${p.amountMsat} provider=${providerConfig.mode}`
          );
          continue;
        }

        // Execute provider call outside DB transaction. If it succeeds,
        // persist submission metadata atomically.
        let providerMeta: Record<string, any> = { provider: providerConfig.mode };

        if (providerConfig.mode === 'opennode') {
          const result = await deps.sendToLnAddress({
            config: { apiKey: providerConfig.opennodeApiKey, baseUrl: providerConfig.opennodeBaseUrl || undefined },
            destinationLnAddress: p.destinationLnAddress,
            amountMsat: p.amountMsat,
            idempotencyKey: p.idempotencyKey,
            comment: `marketplace payout ${p.id}`,
            callbackUrl: providerConfig.opennodeCallbackUrl || undefined,
          });

          providerMeta = {
            provider: 'opennode',
            withdrawalId: result.withdrawal.id,
            withdrawalStatus: result.withdrawal.status,
            withdrawalFeeSats: result.withdrawal.fee,
            callbackUrlConfigured: Boolean(providerConfig.opennodeCallbackUrl),
          };
        }

        await deps.prismaClient.$transaction(async (tx: any) => {
          const fresh = await tx.payout.findUnique({ where: { id: p.id } });
          if (!fresh) return;
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
            } catch (e) {
              // If we race (or a prior attempt wrote it), treat unique violation as already done.
              const code = (e as any)?.code;
              if (code !== 'P2002') throw e;

              // eslint-disable-next-line no-console
              console.log(
                JSON.stringify({
                  worker: 'payout',
                  msg: 'duplicate-payout-submitted-ledger-ignored',
                  runId,
                  payoutId: fresh.id,
                  purchaseId: fresh.purchaseId,
                })
              );
            }
          }
        });

        sent++;
      } catch (e) {
        errored++;
        const msg = e instanceof Error ? e.message : String(e);

        // Best-effort mark as RETRYING.
        try {
          await deps.prismaClient.payout.update({
            where: { id: p.id },
            data: {
              status: 'RETRYING',
              attemptCount: { increment: 1 },
              lastError: msg.slice(0, 500),
            },
          });
        } catch {
          // ignore
        }

        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            worker: 'payout',
            msg: 'payout-processing-error',
            runId,
            payoutId: p.id,
            purchaseId: p.purchaseId,
            providerMode: providerConfig.mode,
            error: msg,
          })
        );
      }
    }

    const summary = {
      scanned: payouts.length,
      sent,
      skippedAlreadySent,
      skippedMaxAttempts,
      errored,
      dryRun,
      providerMode: providerConfig.mode,
      maxAttempts,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ worker: 'payout', msg: 'summary', runId, ...summary }));

    return summary;
  } finally {
    await lock.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPayoutWorker(args);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main()
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => undefined);
    });
}
