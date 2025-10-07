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
                var g = typeof globalThis !== 'undefined' ? globalThis : window;
                if (!g) return;
                var w = typeof window !== 'undefined' ? window : g;
                var noop = function lockdownDisabled() { return undefined; };
                var install = function(target) {
                  try {
                    Object.defineProperty(target, 'lockdown', {
                      configurable: true,
                      writable: true,
                      value: noop,
                    });
                  } catch (_) {
                    try {
                      target.lockdown = noop;
                    } catch (_) {}
                  }
                };
                install(g);
                try {
                  var originalDefineProperty = Object.defineProperty;
                  Object.defineProperty = function(target, property, descriptor) {
                    if ((target === g || target === w) && property === 'lockdown') {
                      return originalDefineProperty(target, property, {
                        configurable: true,
                        writable: true,
                        value: noop,
                      });
                    }
                    return originalDefineProperty(target, property, descriptor);
                  };
                } catch (_) {}
                try {
                  var originalReflectDefine = Reflect.defineProperty;
                  Reflect.defineProperty = function(target, property, descriptor) {
                    if ((target === g || target === w) && property === 'lockdown') {
                      return originalReflectDefine(target, property, {
                        configurable: true,
                        writable: true,
                        value: noop,
                      });
                    }
                    return originalReflectDefine(target, property, descriptor);
                  };
                } catch (_) {}
              } catch (_) {}
            })();
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
