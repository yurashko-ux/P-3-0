import "./globals.css";
import Link from "next/link";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        {/* Головна навігація у стилі проекту (класи без Tailwind) */}
        <header className="admin-nav">
          <div className="admin-nav__inner">
            <nav className="admin-nav__links">
              <Link href="/admin">Адмінка</Link>
              <Link href="/admin/logs">Логи</Link>
              <Link href="/admin/payloads">Payloads</Link>
              <Link href="/admin/playground">Playground</Link>
              <Link href="/admin/mappings">Mappings</Link>
              <Link href="/admin/dedupe">Dedupe</Link>
              <Link href="/campaigns">Campaigns</Link>
            </nav>
            <div className="admin-nav__brand">
              <code>Proect_2_0</code>
            </div>
          </div>
        </header>

        {/* Контейнер сторінки */}
        <main className="page-container">{children}</main>
      </body>
    </html>
  );
}
