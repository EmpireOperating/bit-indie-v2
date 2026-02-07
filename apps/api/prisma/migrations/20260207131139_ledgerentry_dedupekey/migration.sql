-- Add optional de-dupe key for idempotent ledger entry writes.
ALTER TABLE "LedgerEntry" ADD COLUMN "dedupeKey" TEXT;

-- Postgres allows multiple NULLs in a UNIQUE index.
CREATE UNIQUE INDEX "LedgerEntry_dedupeKey_key" ON "LedgerEntry"("dedupeKey");
