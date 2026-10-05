-- Кілька схем ЗП на одну людину. paySchemeId лишається першою схемою.

CREATE TABLE IF NOT EXISTS "team_member_schemes" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_member_schemes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_member_schemes_memberId_schemeId_key"
    ON "team_member_schemes"("memberId", "schemeId");
CREATE INDEX IF NOT EXISTS "team_member_schemes_schemeId_idx" ON "team_member_schemes"("schemeId");
CREATE INDEX IF NOT EXISTS "team_member_schemes_memberId_idx" ON "team_member_schemes"("memberId");

ALTER TABLE "team_member_schemes"
    ADD CONSTRAINT "team_member_schemes_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "team_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_member_schemes"
    ADD CONSTRAINT "team_member_schemes_schemeId_fkey"
    FOREIGN KEY ("schemeId") REFERENCES "team_pay_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "team_member_schemes" ("id", "memberId", "schemeId", "sortOrder", "createdAt")
SELECT md5("id" || "paySchemeId"), "id", "paySchemeId", 0, CURRENT_TIMESTAMP
FROM "team_members"
WHERE "paySchemeId" IS NOT NULL
ON CONFLICT ("memberId", "schemeId") DO NOTHING;
