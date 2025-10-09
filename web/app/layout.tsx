// web/app/layout.tsx
import "./globals.css";
import { Inter } from "next/font/google";
import Script from "next/script";

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
        <Script
          id="p30-lockdown-guard"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                try {
                  const g = typeof globalThis !== 'undefined'
                    ? globalThis
                    : typeof self !== 'undefined'
                      ? self
                      : typeof window !== 'undefined'
                        ? window
                        : undefined;
                  if (!g) return;

                  const copyDescriptor = (descriptor, makeConfigurable = false) => {
                    if (!descriptor) return descriptor;
                    if (!makeConfigurable) return descriptor;
                    if ('get' in descriptor || 'set' in descriptor) {
                      return {
                        configurable: true,
                        enumerable: descriptor.enumerable ?? false,
                        get: descriptor.get,
                        set: descriptor.set,
                      };
                    }
                    return {
                      configurable: true,
                      enumerable: descriptor.enumerable ?? false,
                      writable: descriptor.writable ?? false,
                      value: descriptor.value,
                    };
                  };

                  if (typeof g.Symbol === 'function' && !g.Symbol.__p30Patched) {
                    const originalSymbol = g.Symbol;

                    const SymbolShim = function SymbolShim(...args) {
                      if (new.target) {
                        throw new TypeError('Symbol is not a constructor');
                      }
                      return originalSymbol(...args);
                    };

                    try { Object.setPrototypeOf(SymbolShim, originalSymbol); } catch (_) {}
                    try { SymbolShim.prototype = originalSymbol.prototype; } catch (_) {}

                    const ownKeys = [
                      ...Object.getOwnPropertyNames(originalSymbol),
                      ...Object.getOwnPropertySymbols(originalSymbol),
                    ];

                    for (const key of ownKeys) {
                      if (key === 'arguments' || key === 'caller') continue;
                      const desc = Object.getOwnPropertyDescriptor(originalSymbol, key);
                      if (!desc) continue;
                      const makeConfigurable = key === 'dispose' || key === 'asyncDispose';
                      try {
                        Object.defineProperty(SymbolShim, key, copyDescriptor(desc, makeConfigurable));
                      } catch (_) {}
                    }

                    try {
                      Object.defineProperty(SymbolShim, '__p30Patched', {
                        value: true,
                        enumerable: false,
                      });
                    } catch (_) {}

                    try {
                      Object.defineProperty(g, 'Symbol', {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value: SymbolShim,
                      });
                    } catch (_) {
                      g.Symbol = SymbolShim;
                    }
                  }

                  const stub = function () {};
                  const ensureStub = (target, key) => {
                    if (!target) return;
                    try {
                      target[key] = stub;
                    } catch (_) {
                      try {
                        Object.defineProperty(target, key, {
                          configurable: true,
                          enumerable: false,
                          writable: true,
                          value: stub,
                        });
                      } catch (_) {}
                    }
                  };

                  ensureStub(g, 'lockdown');
                  if (g.ses) ensureStub(g.ses, 'lockdown');

                  if (typeof g.harden !== 'function') {
                    g.harden = (value) => value;
                  }
                } catch (_) {}
              })();
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
