import 'dotenv/config';

import { prisma } from '../prisma.js';

type Args = {
  limit: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 25, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') {
      const v = argv[i + 1];
      if (!v) throw new Error('Missing value for --limit');
      args.limit = Number(v);
      if (!Number.isFinite(args.limit) || args.limit <= 0) {
        throw new Error(`Invalid --limit: ${v}`);
      }
      i++;
    } else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log('Usage: tsx src/workers/payoutWorker.ts [--limit N] [--dry-run]');
      process.exit(0);
    }
  }

  return args;
}

async function main() {
  const { limit, dryRun } = parseArgs(process.argv.slice(2));

  const payouts = await prisma.payout.findMany({
    where: { status: { in: ['SCHEDULED', 'RETRYING'] } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let sent = 0;
  let skippedAlreadySent = 0;
  let errored = 0;

  for (const p of payouts) {
    try {
      // Mock provider: we treat every payout as successful.
      // Idempotency strategy:
      // - Payout is unique per purchase.
      // - We only create a single ledger entry of type PAYOUT_SENT per purchase.
      // - If the payout is already SENT, we skip.
      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log(`[dry-run] would send payout ${p.id} purchaseId=${p.purchaseId} amountMsat=${p.amountMsat}`);
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const fresh = await tx.payout.findUnique({ where: { id: p.id } });
        if (!fresh) return;
        if (fresh.status === 'SENT') {
          skippedAlreadySent++;
          return;
        }

        const existingLedger = await tx.ledgerEntry.findFirst({
          where: { purchaseId: fresh.purchaseId, type: 'PAYOUT_SENT' },
        });

        await tx.payout.update({
          where: { id: fresh.id },
          data: {
            status: 'SENT',
            attemptCount: { increment: 1 },
            lastError: null,
          },
        });

        if (!existingLedger) {
          await tx.ledgerEntry.create({
            data: {
              purchaseId: fresh.purchaseId,
              type: 'PAYOUT_SENT',
              amountMsat: fresh.amountMsat,
              metaJson: {
                payoutId: fresh.id,
                payoutIdempotencyKey: fresh.idempotencyKey,
                destinationLnAddress: fresh.destinationLnAddress,
                provider: 'mock',
              },
            },
          });
        }
      });

      sent++;
    } catch (e) {
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
      } catch {
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
