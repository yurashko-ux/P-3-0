import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Proect 2.0 Ready' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
