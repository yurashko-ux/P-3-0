// БЕЗ "use client" — це серверний layout, тут можна export const metadata
import type { ReactNode } from 'react';
import NavClient from './nav-client';

export const metadata = { title: 'Campaigns Admin' };

const links = [
  { href: '/admin', label: 'Адмінка' },
  { href: '/admin/logs', label: 'Логи' },
  { href: '/admin/payloads', label: 'Payloads' },
  { href: '/admin/playground', label: 'Playground' },
  { href: '/admin/mappings', label: 'Mappings' },
  { href: '/admin/dedupe', label: 'Dedupe' },
  { href: '/campaigns', label: 'Campaigns' },
];

export default function CampaignsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-root">
      <nav className="admin-nav">
        <div className="admin-nav__inner">
          <div className="admin-nav__links">
            <NavClient links={links} />
          </div>
          <div className="admin-nav__brand"><code>Proect_2_0</code></div>
        </div>
      </nav>
      <main data-admin className="admin-shell">{children}</main>
      <footer className="admin-footer">© {new Date().getFullYear()} Admin</footer>
    </div>
  );
}
