"use client";

import { useState, ReactNode, useRef } from "react";
import { CustomGridLayout, LayoutItem } from "@/components/admin/CustomGridLayout";
import { EditLayoutButton } from "@/components/admin/EditLayoutButton";

type FinanceReportClientProps = {
  children: {
    block1: ReactNode;
    block2: ReactNode;
    block3: ReactNode;
    block4: ReactNode;
    block5: ReactNode;
  };
};

const STORAGE_KEY = "finance-report-dashboard-layout";
const LAYOUT_VERSION = "7";

const defaultLayout: LayoutItem[] = [
  { i: "block-1", x: 0, y: 0, w: 6, h: 100 },
  { i: "block-2", x: 6, y: 0, w: 6, h: 100 },
  { i: "block-3", x: 0, y: 100, w: 6, h: 80 },
  { i: "block-4", x: 6, y: 100, w: 6, h: 80 },
  { i: "block-5", x: 0, y: 180, w: 12, h: 60 },
];

export function FinanceReportClient({ children }: FinanceReportClientProps) {
  const [editMode, setEditMode] = useState(false);
  const layoutRef = useRef<LayoutItem[]>(defaultLayout);

  const handleSave = (layout: LayoutItem[]) => {
    layoutRef.current = layout;
    // Layout буде збережено через EditLayoutButton
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end items-center gap-4 mb-4 p-2 bg-gray-50 rounded-lg border border-gray-200">
        <EditLayoutButton
          storageKey={STORAGE_KEY}
          onEditModeChange={setEditMode}
          onSave={handleSave}
        />
      </div>
      
      <CustomGridLayout
        storageKey={STORAGE_KEY}
        layoutVersion={LAYOUT_VERSION}
        defaultLayout={defaultLayout}
        editMode={editMode}
        onSave={handleSave}
      >
        {{
          "block-1": children.block1,
          "block-2": children.block2,
          "block-3": children.block3,
          "block-4": children.block4,
          "block-5": children.block5,
        }}
      </CustomGridLayout>
    </div>
  );
}

