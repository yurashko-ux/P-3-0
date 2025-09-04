'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const metadata = { title: 'Campaigns Admin' };

export default function CampaignsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const links = [
    { href: '/admin', label: 'Адмінка' },
    { href: '/admin/logs', label: 'Логи' },
    { href: '/admin/payloads', label: 'Payloads' },
    { href: '/admin/playground', label: 'Playground' },
    { href: '/admin/mappings', label: 'Mappings' },
    { href: '/admin/dedupe', label: 'Dedupe' },
    { href: '/campaigns', label: 'Campaigns' },
  ];

  return (
    <div className="admin-root">
      <nav className="admin-nav">
        <div className="admin-nav__inner">
          <div className="admin-nav__links">
            {links.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href} className={`a-nav${active ? ' is-active' : ''}`}>
                  {l.label}
                </Link>
              );
            })}
          </div>
          <div className="admin-nav__brand"><code>Proect_2_0</code></div>
        </div>
      </nav>
      <main data-admin className="admin-shell">{children}</main>
      <footer className="admin-footer">© {new Date().getFullYear()} Admin</footer>
    </div>
  );
}
