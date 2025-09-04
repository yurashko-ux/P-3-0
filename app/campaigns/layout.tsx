import type { ReactNode } from "react";
import NavClient from "./nav-client";

export default function CampaignsLayout({ children }: { children: ReactNode }) {
  const links = [
    { href: "/campaigns",       label: "Кампанії" },
    { href: "/campaigns/saved", label: "Збережені" },
  ];

  return (
    <section className="space-y-16">
      <div className="card">
        <div className="admin-nav__inner" style={{ padding: 0 }}>
          <NavClient links={links} />
          <code className="muted">Campaigns</code>
        </div>
      </div>
      {children}
    </section>
  );
}
