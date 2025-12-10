"use client";

import { useState } from "react";
import { EditLayoutButton } from "@/components/admin/EditLayoutButton";

const STORAGE_KEY = "finance-report-dashboard-layout";

export function EditLayoutButtonWrapper() {
  const [editMode, setEditMode] = useState(false);

  const handleSave = (layout: any[]) => {
    // Layout буде збережено через EditLayoutButton
  };

  return (
    <div className="mb-4 p-3 bg-blue-50 border-2 border-blue-300 rounded-lg shadow-md">
      <EditLayoutButton
        storageKey={STORAGE_KEY}
        onEditModeChange={setEditMode}
        onSave={handleSave}
      />
    </div>
  );
}

