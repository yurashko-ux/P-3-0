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
        <script
          id="disable-ses-lockdown"
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  try {
    var g = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : undefined));
    if (!g) return;

    var noop = function lockdownDisabled() { return undefined; };

    var ensure = function(target) {
      if (!target) return;
      try {
        if (typeof target.lockdown === 'function') {
          target.lockdown = noop;
          return;
        }
      } catch (_) {}
      try {
        Object.defineProperty(target, 'lockdown', {
          configurable: true,
          writable: true,
          value: noop,
        });
      } catch (_) {
        try { target.lockdown = noop; } catch (_) {}
      }
    };

    ensure(g);
    if (typeof window !== 'undefined') ensure(window);
    if (typeof self !== 'undefined') ensure(self);
    if (typeof global !== 'undefined') ensure(global);

    if (typeof Symbol === 'function' && Symbol) {
      try {
        var desc = Object.getOwnPropertyDescriptor(Symbol, 'dispose');
        if (desc && !desc.configurable) {
          Object.defineProperty(Symbol, 'dispose', {
            configurable: true,
            enumerable: desc.enumerable === true,
            writable: true,
            value: desc.value,
          });
        }
      } catch (_) {}
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
