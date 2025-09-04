import "./globals.css";
import Link from "next/link";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {/* Top bar */}
        <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4">
            <div className="h-14 flex items-center justify-between">
              <nav className="flex items-center gap-6 text-sm font-medium text-slate-700">
                <Link href="/admin" className="hover:text-black">Адмінка</Link>
                <Link href="/admin/logs" className="hover:text-black">Логи</Link>
                <Link href="/admin/payloads" className="hover:text-black">Payloads</Link>
                <Link href="/admin/playground" className="hover:text-black">Playground</Link>
                <Link href="/admin/mappings" className="hover:text-black">Mappings</Link>
                <Link href="/admin/dedupe" className="hover:text-black">Dedupe</Link>
                <Link href="/campaigns" className="hover:text-black">Campaigns</Link>
              </nav>
              <code className="text-xs text-slate-500">Proect_2_0</code>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
