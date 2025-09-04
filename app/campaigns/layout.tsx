import type { ReactNode } from "react";
import NavClient from "./nav-client";

export default function CampaignsLayout({ children }: { children: ReactNode }) {
  const links = [
    { href: "/campaigns",       label: "Кампанії" },
    { href: "/campaigns/saved", label: "Збережені" },
  ];

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <NavClient links={links} />
          <code className="text-xs text-slate-500">Campaigns</code>
        </div>
      </div>
      {children}
    </section>
  );
}
