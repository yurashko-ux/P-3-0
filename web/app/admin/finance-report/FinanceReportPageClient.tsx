"use client";

import { ReactNode } from "react";
import { LayoutEditProvider } from "./LayoutEditContext";
import { EditLayoutButtonWrapper } from "./EditLayoutButtonWrapper";

type FinanceReportPageClientProps = {
  children: ReactNode;
  summaryContent: ReactNode | null;
};

export default function FinanceReportPageClient({ children, summaryContent }: FinanceReportPageClientProps) {
  return (
    <LayoutEditProvider>
      <div className="mx-auto max-w-6xl px-2 py-2 space-y-2">
        {children}
        {summaryContent && (
          <>
            <EditLayoutButtonWrapper />
            {summaryContent}
          </>
        )}
      </div>
    </LayoutEditProvider>
  );
}

