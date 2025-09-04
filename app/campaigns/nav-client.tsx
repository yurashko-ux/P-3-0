'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type LinkItem = { href: string; label: string };

export default function NavClient({ links }: { links: LinkItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = pathname?.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={`a-nav${active ? ' is-active' : ''}`}>
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
