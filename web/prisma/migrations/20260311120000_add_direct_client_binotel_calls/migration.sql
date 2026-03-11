-- CreateTable
CREATE TABLE "direct_client_binotel_calls" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "externalNumber" TEXT NOT NULL,
    "generalCallID" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "durationSec" INTEGER,
    "startTime" TIMESTAMP(3) NOT NULL,
    "lineNumber" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_client_binotel_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direct_client_binotel_calls_generalCallID_key" ON "direct_client_binotel_calls"("generalCallID");
CREATE INDEX "direct_client_binotel_calls_clientId_idx" ON "direct_client_binotel_calls"("clientId");
CREATE INDEX "direct_client_binotel_calls_externalNumber_idx" ON "direct_client_binotel_calls"("externalNumber");
CREATE INDEX "direct_client_binotel_calls_startTime_idx" ON "direct_client_binotel_calls"("startTime");

-- AddForeignKey
ALTER TABLE "direct_client_binotel_calls" ADD CONSTRAINT "direct_client_binotel_calls_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "direct_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
