-- CreateTable
CREATE TABLE "direct_active_base_snapshots" (
    "id" TEXT NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "activeBaseCount" INTEGER NOT NULL,
    "inactiveBaseCount" INTEGER NOT NULL,
    "totalClientsCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_active_base_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direct_active_base_snapshots_kyivDay_key" ON "direct_active_base_snapshots"("kyivDay");

-- CreateIndex
CREATE INDEX "direct_active_base_snapshots_kyivDay_idx" ON "direct_active_base_snapshots"("kyivDay");
