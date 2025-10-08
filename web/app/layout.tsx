// web/app/layout.tsx
import Script from "next/script";
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
        <Script id="disable-ses-lockdown" strategy="beforeInteractive">
          {`
(function(){
  try {
    var root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : undefined));
    if (!root) return;

    var noop = function lockdownDisabled() { return undefined; };

    var protect = function(target) {
      if (!target) return;
      try { target.lockdown = noop; } catch (_) {}
      try {
        Object.defineProperty(target, 'lockdown', {
          configurable: true,
          writable: true,
          value: noop,
        });
      } catch (_) {}
    };

    protect(root);
    if (typeof window !== 'undefined') protect(window);
    if (typeof self !== 'undefined') protect(self);
    if (typeof global !== 'undefined') protect(global);
  } catch (_) {}
})();
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
