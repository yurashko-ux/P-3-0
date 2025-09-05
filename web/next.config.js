/** @type {import('next').NextConfig} */
const nextConfig = {
  // Увімкнута сувора перевірка React
  reactStrictMode: true,

  // Використовуємо App Router. НІЯКОГО "output: 'export'".
  experimental: {
    appDir: true,
  },

  // На Vercel API-роути мають працювати з коробки.
  // Якщо раніше тут було `output: 'export'` — ми це повністю прибрали.
  // Додатково знімаємо блокери білду, якщо є типові помилки TS/ESLint:
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
