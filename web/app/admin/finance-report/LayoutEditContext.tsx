"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type LayoutEditContextType = {
  editMode: boolean;
  setEditMode: (enabled: boolean) => void;
};

const LayoutEditContext = createContext<LayoutEditContextType | undefined>(undefined);

export function LayoutEditProvider({ children }: { children: ReactNode }) {
  const [editMode, setEditMode] = useState(false);

  return (
    <LayoutEditContext.Provider value={{ editMode, setEditMode }}>
      {children}
    </LayoutEditContext.Provider>
  );
}

export function useLayoutEdit() {
  const context = useContext(LayoutEditContext);
  if (!context) {
    throw new Error("useLayoutEdit must be used within LayoutEditProvider");
  }
  return context;
}


