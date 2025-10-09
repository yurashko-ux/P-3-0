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

                  const defineConfigurable = (target, key, value) => {
                    if (!target) return;
                    try {
                      Object.defineProperty(target, key, {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value,
                      });
                    } catch (err) {
                      try {
                        target[key] = value;
                      } catch (_) {}
                    }
                  };

                  if (typeof Symbol === 'function') {
                    try {
                      const descDispose = Object.getOwnPropertyDescriptor(Symbol, 'dispose');
                      if (!descDispose || !descDispose.configurable) {
                        defineConfigurable(Symbol, 'dispose', descDispose ? descDispose.value : undefined);
                      }

                      const descAsyncDispose = Object.getOwnPropertyDescriptor(Symbol, 'asyncDispose');
                      if (!descAsyncDispose || !descAsyncDispose.configurable) {
                        defineConfigurable(Symbol, 'asyncDispose', descAsyncDispose ? descAsyncDispose.value : undefined);
                      }
                    } catch (_) {}
                  }

                  const stub = function () {};
                  const ensureStub = (target, key) => {
                    if (!target) return;
                    try {
                      target[key] = stub;
                    } catch (_) {
                      defineConfigurable(target, key, stub);
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
