-- Джерела лідів: назва, знак у першому повідомленні, тип (реклама, органіка, сайт).
CREATE TABLE "lead_sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mark" TEXT,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_sources_code_key" ON "lead_sources"("code");
CREATE INDEX "lead_sources_kind_idx" ON "lead_sources"("kind");
