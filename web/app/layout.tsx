// web/app/layout.tsx
import "./globals.css";
import Script from "next/script";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata = {
  title: "P-3-0",
  description: "Admin console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={inter.className}>
      <head>
        {/* Тимчасовий захист від third-party SES/lockdown у браузері.
           Виконується ПЕРЕД усіма іншими скриптами. */}
        <Script id="disable-ses-lockdown" strategy="beforeInteractive">
          {`
            try {
              var g = (typeof globalThis !== 'undefined' ? globalThis : window);
              if (g && typeof g.lockdown === 'function') {
                try { delete g.lockdown; } catch (_) { try { g.lockdown = undefined; } catch (_) {} }
              }
            } catch (_) {}
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
