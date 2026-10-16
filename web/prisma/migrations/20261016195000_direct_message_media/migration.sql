-- Голосові, фото і відео з Instagram Direct. Посилання Meta протухає, тому файл лежить у базі.
CREATE TABLE "direct_message_media" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_message_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "direct_message_media_messageId_idx" ON "direct_message_media"("messageId");
CREATE INDEX "direct_message_media_clientId_idx" ON "direct_message_media"("clientId");
CREATE INDEX "direct_message_media_kind_idx" ON "direct_message_media"("kind");

ALTER TABLE "direct_message_media"
ADD CONSTRAINT "direct_message_media_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
