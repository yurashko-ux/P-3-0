-- CreateTable
CREATE TABLE "functions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "telegramUserId" BIGINT,
    "telegramChatId" BIGINT,
    "functionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_client_audit_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_client_audit_logs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN "lastModifiedByUserId" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN "lastModifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_login_key" ON "app_users"("login");

-- CreateIndex
CREATE INDEX "app_users_telegramUserId_idx" ON "app_users"("telegramUserId");

-- CreateIndex
CREATE INDEX "app_users_functionId_idx" ON "app_users"("functionId");

-- CreateIndex
CREATE INDEX "app_users_isActive_idx" ON "app_users"("isActive");

-- CreateIndex
CREATE INDEX "direct_client_audit_logs_clientId_idx" ON "direct_client_audit_logs"("clientId");

-- CreateIndex
CREATE INDEX "direct_client_audit_logs_userId_idx" ON "direct_client_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "direct_client_audit_logs_createdAt_idx" ON "direct_client_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "direct_clients_lastModifiedByUserId_idx" ON "direct_clients"("lastModifiedByUserId");

-- CreateIndex
CREATE INDEX "direct_clients_lastModifiedAt_idx" ON "direct_clients"("lastModifiedAt");

-- AddForeignKey
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_client_audit_logs" ADD CONSTRAINT "direct_client_audit_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "direct_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_client_audit_logs" ADD CONSTRAINT "direct_client_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_clients" ADD CONSTRAINT "direct_clients_lastModifiedByUserId_fkey" FOREIGN KEY ("lastModifiedByUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
