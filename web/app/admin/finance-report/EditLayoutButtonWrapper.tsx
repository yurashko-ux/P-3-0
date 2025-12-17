"use client";

import { EditLayoutButton } from "@/components/admin/EditLayoutButton";
import { useLayoutEdit } from "./LayoutEditContext";

const STORAGE_KEY = "finance-report-dashboard-layout";

export function EditLayoutButtonWrapper() {
  const { editMode, setEditMode } = useLayoutEdit();

  const handleSave = (layout: any[]) => {
    // Layout буде збережено через EditLayoutButton
  };

  return (
    <div className="p-3 bg-blue-50 border-2 border-blue-300 rounded-lg shadow-md">
      <EditLayoutButton
        storageKey={STORAGE_KEY}
        onEditModeChange={setEditMode}
        onSave={handleSave}
      />
    </div>
  );
}

