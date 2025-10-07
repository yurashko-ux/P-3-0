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
            (function(){
              try {
                var g = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : undefined);
                if (!g) return;
                var noop = function lockdownDisabled() { return undefined; };
                var install = function(target) {
                  if (!target) return;
                  try {
                    var desc = Object.getOwnPropertyDescriptor(target, 'lockdown');
                    if (!desc || desc.configurable || desc.writable) {
                      Object.defineProperty(target, 'lockdown', {
                        configurable: true,
                        writable: true,
                        value: noop,
                      });
                    }
                  } catch (_) {
                    try {
                      target.lockdown = noop;
                    } catch (_) {}
                  }
                };
                install(g);
                if (typeof window !== 'undefined') install(window);
              } catch (_) {}
            })();
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
