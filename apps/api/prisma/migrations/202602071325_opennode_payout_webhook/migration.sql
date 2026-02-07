-- Add SUBMITTED state so we only mark SENT when confirmed via webhook
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';

-- Provider tracking fields for webhook reconciliation
ALTER TABLE "Payout"
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "providerWithdrawalId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerMetaJson" JSONB,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);

-- Unique provider withdrawal id (idempotency + lookup from webhook)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Payout_providerWithdrawalId_key'
  ) THEN
    CREATE UNIQUE INDEX "Payout_providerWithdrawalId_key" ON "Payout"("providerWithdrawalId");
  END IF;
END $$;
