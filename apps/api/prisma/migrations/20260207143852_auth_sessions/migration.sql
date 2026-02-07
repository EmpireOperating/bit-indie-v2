-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiSession" (
    "id" UUID NOT NULL,
    "pubkey" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "scopesJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_origin_nonce_key" ON "AuthChallenge"("origin", "nonce");

-- CreateIndex
CREATE INDEX "ApiSession_pubkey_idx" ON "ApiSession"("pubkey");

-- CreateIndex
CREATE INDEX "ApiSession_expiresAt_idx" ON "ApiSession"("expiresAt");
