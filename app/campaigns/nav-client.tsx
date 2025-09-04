"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string };

const DEFAULT_TABS: Tab[] = [
  { href: "/campaigns",       label: "Кампанії" },
  { href: "/campaigns/saved", label: "Збережені" },
];

export default function NavClient({ links }: { links?: Tab[] }) {
  const tabs = links?.length ? links : DEFAULT_TABS;
  const pathname = usePathname();

  return (
    <nav className="flex gap-2 items-center">
      {tabs.map(({ href, label }) => {
        const active =
          pathname === href || (pathname?.startsWith(href + "/") ?? false);

        return (
          <Link
            key={href}
            href={href}
            prefetch
            className={[
              "rounded-xl border px-4 py-2 transition-colors",
              active
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-900 hover:bg-slate-50",
            ].join(" ")}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
