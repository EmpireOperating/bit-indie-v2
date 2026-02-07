-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('DRAFT', 'UNLISTED', 'LISTED', 'FEATURED', 'BANNED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('SCHEDULED', 'SENT', 'FAILED', 'RETRYING', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "pubkey" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeveloperProfile" (
    "userId" UUID NOT NULL,
    "payoutLnAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeveloperProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "developerUserId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "descriptionMd" TEXT,
    "status" "GameStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "releaseNotesMd" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildAsset" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" UUID NOT NULL,
    "buyerUserId" UUID,
    "guestReceiptCode" TEXT,
    "gameId" UUID NOT NULL,
    "invoiceProvider" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "amountMsat" BIGINT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "buyerUserId" UUID,
    "guestReceiptCode" TEXT,
    "gameId" UUID NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadEvent" (
    "id" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amountMsat" BIGINT NOT NULL,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "developerUserId" UUID NOT NULL,
    "destinationLnAddress" TEXT NOT NULL,
    "amountMsat" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_pubkey_key" ON "User"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "Game_slug_key" ON "Game"("slug");

-- CreateIndex
CREATE INDEX "Game_developerUserId_idx" ON "Game"("developerUserId");

-- CreateIndex
CREATE INDEX "Release_gameId_idx" ON "Release"("gameId");

-- CreateIndex
CREATE INDEX "Release_publishedAt_idx" ON "Release"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Release_gameId_version_key" ON "Release"("gameId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BuildAsset_releaseId_key" ON "BuildAsset"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_guestReceiptCode_key" ON "Purchase"("guestReceiptCode");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_invoiceId_key" ON "Purchase"("invoiceId");

-- CreateIndex
CREATE INDEX "Purchase_gameId_idx" ON "Purchase"("gameId");

-- CreateIndex
CREATE INDEX "Purchase_buyerUserId_idx" ON "Purchase"("buyerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_purchaseId_key" ON "Entitlement"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_guestReceiptCode_key" ON "Entitlement"("guestReceiptCode");

-- CreateIndex
CREATE INDEX "Entitlement_gameId_idx" ON "Entitlement"("gameId");

-- CreateIndex
CREATE INDEX "Entitlement_buyerUserId_idx" ON "Entitlement"("buyerUserId");

-- CreateIndex
CREATE INDEX "DownloadEvent_entitlementId_idx" ON "DownloadEvent"("entitlementId");

-- CreateIndex
CREATE INDEX "DownloadEvent_releaseId_idx" ON "DownloadEvent"("releaseId");

-- CreateIndex
CREATE INDEX "DownloadEvent_createdAt_idx" ON "DownloadEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_purchaseId_idx" ON "LedgerEntry"("purchaseId");

-- CreateIndex
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_purchaseId_key" ON "Payout"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payout_developerUserId_idx" ON "Payout"("developerUserId");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

-- AddForeignKey
ALTER TABLE "DeveloperProfile" ADD CONSTRAINT "DeveloperProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_developerUserId_fkey" FOREIGN KEY ("developerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildAsset" ADD CONSTRAINT "BuildAsset_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadEvent" ADD CONSTRAINT "DownloadEvent_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "Entitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadEvent" ADD CONSTRAINT "DownloadEvent_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
