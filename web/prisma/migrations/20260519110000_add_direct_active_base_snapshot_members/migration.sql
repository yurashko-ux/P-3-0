-- CreateTable
CREATE TABLE "direct_active_base_snapshot_members" (
    "id" TEXT NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_active_base_snapshot_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direct_active_base_snapshot_members_kyivDay_clientId_key" ON "direct_active_base_snapshot_members"("kyivDay", "clientId");

-- CreateIndex
CREATE INDEX "direct_active_base_snapshot_members_kyivDay_idx" ON "direct_active_base_snapshot_members"("kyivDay");

-- CreateIndex
CREATE INDEX "direct_active_base_snapshot_members_clientId_idx" ON "direct_active_base_snapshot_members"("clientId");
