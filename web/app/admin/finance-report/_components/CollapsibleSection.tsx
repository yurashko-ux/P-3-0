"use client";

// web/app/admin/finance-report/_components/CollapsibleSection.tsx
// Компонент для згортання/розгортання секцій

import { useState } from "react";

interface CollapsibleSectionProps {
  title: string;
  summary?: React.ReactNode;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  summary,
  defaultCollapsed = true,
  children,
}: CollapsibleSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div>
      <div
        className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h2 className="card-title text-base">{title}</h2>
        <div className="flex items-center gap-2">
          {summary}
          <button className="btn btn-sm btn-ghost">
            {isCollapsed ? "▼" : "▲"}
          </button>
        </div>
      </div>
      {!isCollapsed && <div className="mt-2">{children}</div>}
    </div>
  );
}
