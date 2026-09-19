-- Instagram нік для людей Команди (аватарки через ManyChat/KV)
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "instagramUsername" TEXT;
CREATE INDEX IF NOT EXISTS "team_members_instagramUsername_idx" ON "team_members"("instagramUsername");
