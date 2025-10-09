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
            (function () {
              try {
                var g = typeof globalThis !== 'undefined'
                  ? globalThis
                  : typeof self !== 'undefined'
                    ? self
                    : typeof window !== 'undefined'
                      ? window
                      : undefined;
                if (!g) return;

                var stub = function () {};
                var setStub = function (target, key) {
                  if (!target) return;
                  try {
                    target[key] = stub;
                  } catch (_) {
                    try {
                      Object.defineProperty(target, key, {
                        value: stub,
                        configurable: true,
                        writable: true,
                      });
                    } catch (_) {}
                  }
                };

                var ensureSymbolDeleteFriendly = function (symbolKey) {
                  try {
                    if (typeof Symbol !== 'function') return;
                    var hasOwn = Object.prototype.hasOwnProperty.call(Symbol, symbolKey);
                    if (!hasOwn) {
                      Object.defineProperty(Symbol, symbolKey, {
                        configurable: true,
                        writable: true,
                        value: undefined,
                      });
                      return;
                    }
                    var desc = Object.getOwnPropertyDescriptor(Symbol, symbolKey);
                    if (desc && !desc.configurable) {
                      Object.defineProperty(Symbol, symbolKey, {
                        configurable: true,
                        enumerable: desc.enumerable,
                        writable: true,
                        value: desc.value,
                      });
                    }
                  } catch (_) {}
                };

                ensureSymbolDeleteFriendly('dispose');
                ensureSymbolDeleteFriendly('asyncDispose');

                setStub(g, 'lockdown');
                if (g.ses) setStub(g.ses, 'lockdown');

                if (typeof g.harden !== 'function') {
                  g.harden = function (value) {
                    return value;
                  };
                }
              } catch (_) {}
            })();
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
