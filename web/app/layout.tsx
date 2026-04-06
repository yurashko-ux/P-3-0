// web/app/layout.tsx
import "./globals.css";
import { Inter } from "next/font/google";
import Script from "next/script";

import { LOCKDOWN_GUARD_SNIPPET } from "@/lib/ses-lockdown-guard";
// applyLockdownGuard не викликаємо тут: це Server Component (Node globalThis) і дубль із beforeInteractive.

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata = {
  title: "P-3-0",
  description: "Admin console",
  icons: { icon: "/icon.svg", type: "image/svg+xml" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={inter.className}>
      <head>
        {/* Тимчасовий захист від third-party SES/lockdown у браузері.
           Виконується ПЕРЕД усіма іншими скриптами. */}
        <Script
          id="p30-lockdown-guard"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: LOCKDOWN_GUARD_SNIPPET,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
