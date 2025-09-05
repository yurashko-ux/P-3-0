// web/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'P-3-0',
  description: 'Admin & integrations for P-3-0',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body className="min-h-screen bg-white antialiased">
        {children}
      </body>
    </html>
  );
}
