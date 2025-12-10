"use client";

import { ReactNode } from "react";
import { LayoutEditProvider } from "./LayoutEditContext";
import { EditLayoutButtonWrapper } from "./EditLayoutButtonWrapper";
import { FinanceReportClient } from "./FinanceReportClient";

type FinanceReportPageClientProps = {
  children: ReactNode;
  summaryContent: ReactNode;
};

export function FinanceReportPageClient({ children, summaryContent }: FinanceReportPageClientProps) {
  return (
    <LayoutEditProvider>
      {children}
      {summaryContent && (
        <>
          <EditLayoutButtonWrapper />
          {summaryContent}
        </>
      )}
    </LayoutEditProvider>
  );
}

