-- CreateTable
CREATE TABLE "BuildUploadIntent" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildUploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuildUploadIntent_releaseId_key" ON "BuildUploadIntent"("releaseId");

-- CreateIndex
CREATE INDEX "BuildUploadIntent_createdAt_idx" ON "BuildUploadIntent"("createdAt");

-- AddForeignKey
ALTER TABLE "BuildUploadIntent" ADD CONSTRAINT "BuildUploadIntent_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;
