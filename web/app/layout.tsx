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
              if (!g) { return; }

              var noop = function () { return { harden: function (value) { return value; } }; };

              var patchLockdown = function (target, key) {
                if (!target) { return; }
                try {
                  if (typeof target[key] === 'function') {
                    target[key] = noop;
                  } else if (target[key] === undefined) {
                    return;
                  }
                } catch (_) {
                  try {
                    Object.defineProperty(target, key, { value: noop, configurable: true, writable: true });
                  } catch (_) {
                    try { target[key] = undefined; } catch (_) {}
                  }
                }
              };

              patchLockdown(g, 'lockdown');
              if (g.ses) { patchLockdown(g.ses, 'lockdown'); }

              if (typeof g.harden !== 'function') {
                g.harden = function (value) { return value; };
              }
            } catch (_) {}
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
