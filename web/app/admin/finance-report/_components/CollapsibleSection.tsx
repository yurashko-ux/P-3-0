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
        className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h2 className="card-title text-xs font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {summary}
          <button className="btn btn-xs btn-ghost p-0.5">
            {isCollapsed ? "▼" : "▲"}
          </button>
        </div>
      </div>
      {!isCollapsed && <div className="mt-1">{children}</div>}
    </div>
  );
}
