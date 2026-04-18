/* eslint-disable no-console */
/**
 * Підставляє DATABASE_URL_UNPOOLED для prisma generate / migrate deploy (schema: directUrl).
 * Викликати в тому ж Node-процесі, що й npx prisma … — інакше змінні не потраплять у дочірній процес.
 */
function ensureDatabaseUrlUnpooled() {
  if (process.env.DATABASE_URL_UNPOOLED) {
    return;
  }
  const fallback =
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.NEON_DATABASE_URL ||
    (typeof process.env.PRISMA_DATABASE_URL === "string" &&
    process.env.PRISMA_DATABASE_URL.startsWith("postgres")
      ? process.env.PRISMA_DATABASE_URL
      : undefined);
  if (fallback) {
    process.env.DATABASE_URL_UNPOOLED = fallback;
    console.log("[build] DATABASE_URL_UNPOOLED взято з fallback (unpooled / прямий postgresql).");
  } else {
    console.warn(
      "[build] DATABASE_URL_UNPOOLED не задано — додайте в Vercel (Neon → Direct) або POSTGRES_URL_NON_POOLING / NEON_DATABASE_URL."
    );
  }
}

ensureDatabaseUrlUnpooled();

module.exports = { ensureDatabaseUrlUnpooled };
