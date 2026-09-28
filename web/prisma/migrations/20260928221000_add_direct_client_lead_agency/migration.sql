-- Агенція ліда з ManyChat: agency_1 (є *) або agency_2 (немає *)
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "leadAgency" TEXT;
