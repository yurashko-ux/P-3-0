// web/app/layout.tsx
import "./globals.css";
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
        <script
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

                  const toConfigurableDescriptor = (descriptor) => {
                    if (!descriptor) return descriptor;
                    return {
                      configurable: true,
                      enumerable: descriptor.enumerable ?? false,
                      writable: descriptor.writable ?? false,
                      value: descriptor.value,
                      get: descriptor.get,
                      set: descriptor.set,
                    };
                  };

                  if (typeof g.Symbol === 'function' && !g.Symbol.__p30Patched) {
                    const originalSymbol = g.Symbol;

                    const proxiedSymbol = new Proxy(originalSymbol, {
                      apply(target, thisArg, args) {
                        return Reflect.apply(target, thisArg, args);
                      },
                      get(target, prop, receiver) {
                        if (prop === '__p30Original') return originalSymbol;
                        const value = Reflect.get(target, prop, receiver);
                        return typeof value === 'function' ? value.bind(target) : value;
                      },
                      getOwnPropertyDescriptor(target, prop) {
                        if (prop === 'dispose' || prop === 'asyncDispose') {
                          const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
                          return toConfigurableDescriptor(descriptor);
                        }
                        return Reflect.getOwnPropertyDescriptor(target, prop);
                      },
                      deleteProperty(target, prop) {
                        if (prop === 'dispose' || prop === 'asyncDispose') {
                          return true;
                        }
                        try {
                          return Reflect.deleteProperty(target, prop);
                        } catch (_) {
                          return false;
                        }
                      },
                    });

                    try {
                      Object.defineProperty(proxiedSymbol, '__p30Patched', {
                        value: true,
                        enumerable: false,
                      });
                    } catch (_) {}

                    try {
                      Object.defineProperty(g, 'Symbol', {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value: proxiedSymbol,
                      });
                    } catch (_) {
                      g.Symbol = proxiedSymbol;
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
