"use client";

// Компонент для згортання/розгортання груп у блоці "Розходи"
import { useState } from "react";

interface CollapsibleGroupProps {
  title: string;
  totalFormatted: string; // Вже відформатована сума (без "грн.")
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export function CollapsibleGroup({
  title,
  totalFormatted,
  children,
  defaultCollapsed = true,
}: CollapsibleGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className="p-3 bg-gray-50 rounded border">
      <div
        className="flex justify-between items-center mb-2 cursor-pointer hover:bg-gray-100 p-1 rounded transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{totalFormatted} грн.</span>
          <span className="text-xs text-gray-500">{isCollapsed ? "▼" : "▲"}</span>
        </div>
      </div>
      {!isCollapsed && <div className="space-y-1 ml-2">{children}</div>}
    </div>
  );
}
