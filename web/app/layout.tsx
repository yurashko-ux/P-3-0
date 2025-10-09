// web/app/layout.tsx
import "./globals.css";
import { Inter } from "next/font/google";
import Script from "next/script";

type AnyGlobal = typeof globalThis & {
  __p30SymbolGuarded?: boolean;
};

const applyLockdownGuard = () => {
  const globalRef = globalThis as AnyGlobal;
  if (!globalRef) return;

  const hasProxy = Boolean((globalRef.Symbol as any)?.__p30ProxyGuard);
  if (globalRef.__p30SymbolGuarded && hasProxy) {
    return;
  }

  const targetSymbol = globalRef.Symbol as typeof Symbol & { __p30ProxyGuard?: boolean };
  if (typeof targetSymbol !== "function") {
    return;
  }

  const blockedKeys = new Set<PropertyKey>(["dispose", "asyncDispose"]);

  const stub = function () {};
  const ensureStub = (target: Record<string, unknown> | undefined | null, key: string) => {
    if (!target) return;
    try {
      target[key] = stub;
    } catch {
      try {
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: false,
          writable: true,
          value: stub,
        });
      } catch {
        // ignore
      }
    }
  };

  const proxiedSymbol: typeof Symbol & { __p30ProxyGuard?: boolean } = new Proxy(targetSymbol, {
    apply(target, thisArg, argArray) {
      return Reflect.apply(target, thisArg, argArray);
    },
    construct() {
      throw new TypeError("Symbol is not a constructor");
    },
    get(target, prop, receiver) {
      if (prop === "__p30ProxyGuard") return true;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        try {
          return value.bind(target);
        } catch {
          return value;
        }
      }
      return value;
    },
    set(target, prop, value, receiver) {
      return Reflect.set(target, prop, value, receiver);
    },
    deleteProperty(target, prop) {
      if (blockedKeys.has(prop)) {
        try {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
          if (descriptor && !descriptor.configurable) {
            try {
              const updated = "get" in descriptor || "set" in descriptor
                ? { ...descriptor, configurable: true }
                : {
                    configurable: true,
                    enumerable: descriptor.enumerable ?? false,
                    writable: true,
                    value: descriptor.value,
                  };
              Reflect.defineProperty(target, prop, updated);
            } catch {
              // ignore inability to flip configurability
            }
          }

          if (Reflect.getOwnPropertyDescriptor(target, prop)?.configurable) {
            Reflect.deleteProperty(target, prop);
          } else {
            try {
              (target as any)[prop] = undefined;
            } catch {
              // ignore inability to overwrite value
            }
          }
        } catch {
          // swallow deletion issues for guarded properties
        }
        return true;
      }
      try {
        return Reflect.deleteProperty(target, prop);
      } catch {
        return false;
      }
    },
    defineProperty(target, prop, attributes) {
      return Reflect.defineProperty(target, prop, attributes);
    },
    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    has(target, prop) {
      return Reflect.has(target, prop);
    },
  });

  try {
    Object.setPrototypeOf(proxiedSymbol, targetSymbol);
  } catch {
    // ignore inability to mutate prototype
  }

  Object.defineProperty(proxiedSymbol, "__p30ProxyGuard", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  try {
    Object.defineProperty(globalRef, "Symbol", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: proxiedSymbol,
    });
  } catch {
    (globalRef as Record<string, unknown>).Symbol = proxiedSymbol;
  }

  ensureStub(globalRef as Record<string, unknown>, "lockdown");
  if ((globalRef as Record<string, unknown>).ses) {
    ensureStub(((globalRef as Record<string, unknown>).ses as Record<string, unknown>), "lockdown");
  }

  if (typeof (globalRef as Record<string, unknown>).harden !== "function") {
    (globalRef as Record<string, unknown>).harden = (value: unknown) => value;
  }

  globalRef.__p30SymbolGuarded = true;
};

applyLockdownGuard();

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

                  if (typeof g.Symbol === 'function' && !g.Symbol.__p30ProxyGuard) {
                    const blockedKeys = new Set(['dispose', 'asyncDispose']);
                    const originalSymbol = g.Symbol;

                    const proxiedSymbol = new Proxy(originalSymbol, {
                      apply(target, thisArg, argArray) {
                        return Reflect.apply(target, thisArg, argArray);
                      },
                      construct() {
                        throw new TypeError('Symbol is not a constructor');
                      },
                      get(target, prop, receiver) {
                        if (prop === '__p30ProxyGuard') return true;
                        const value = Reflect.get(target, prop, receiver);
                        if (typeof value === 'function') {
                          try {
                            return value.bind(target);
                          } catch (_) {
                            return value;
                          }
                        }
                        return value;
                      },
                      set(target, prop, value, receiver) {
                        return Reflect.set(target, prop, value, receiver);
                      },
                      deleteProperty(target, prop) {
                        if (blockedKeys.has(prop)) {
                          try {
                            const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
                            if (descriptor && !descriptor.configurable) {
                              try {
                                const updated = 'get' in descriptor || 'set' in descriptor
                                  ? { ...descriptor, configurable: true }
                                  : {
                                      configurable: true,
                                      enumerable: descriptor.enumerable ?? false,
                                      writable: true,
                                      value: descriptor.value,
                                    };
                                Reflect.defineProperty(target, prop, updated);
                              } catch (_) {}
                            }

                            if (Reflect.getOwnPropertyDescriptor(target, prop)?.configurable) {
                              Reflect.deleteProperty(target, prop);
                            } else {
                              try {
                                target[prop] = undefined;
                              } catch (_) {}
                            }
                          } catch (_) {}
                          return true;
                        }
                        try {
                          return Reflect.deleteProperty(target, prop);
                        } catch (_) {
                          return false;
                        }
                      },
                      defineProperty(target, prop, descriptor) {
                        return Reflect.defineProperty(target, prop, descriptor);
                      },
                      getOwnPropertyDescriptor(target, prop) {
                        return Reflect.getOwnPropertyDescriptor(target, prop);
                      },
                      ownKeys(target) {
                        return Reflect.ownKeys(target);
                      },
                      has(target, prop) {
                        return Reflect.has(target, prop);
                      },
                    });

                    try { Object.setPrototypeOf(proxiedSymbol, originalSymbol); } catch (_) {}
                    try {
                      Object.defineProperty(proxiedSymbol, '__p30ProxyGuard', {
                        value: true,
                        configurable: false,
                        enumerable: false,
                        writable: false,
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
