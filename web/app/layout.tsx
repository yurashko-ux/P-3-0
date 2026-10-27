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
  applicationName: "CreSco",
  appleWebApp: {
    capable: true,
    title: "CreSco",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={inter.className}>
      <body>{children}</body>
    </html>
  );
}
