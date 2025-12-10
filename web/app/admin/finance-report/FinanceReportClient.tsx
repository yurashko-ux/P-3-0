"use client";

import { ReactNode } from "react";
import { FinanceReportGrid } from "./FinanceReportGrid";

type FinanceReportClientProps = {
  children: {
    block1: ReactNode;
    block2: ReactNode;
    block3: ReactNode;
    block4: ReactNode;
    block5: ReactNode;
  };
};

export function FinanceReportClient({ children }: FinanceReportClientProps) {
  return <FinanceReportGrid>{children}</FinanceReportGrid>;
}

