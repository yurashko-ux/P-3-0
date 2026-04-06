import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { FundFooter, FundHeader } from '@/components/fund/fund-site';

export const metadata: Metadata = {
  title: {
    default: 'Благодійний фонд "Всіх Святих"',
    template: '%s | Благодійний фонд "Всіх Святих"',
  },
  description:
    'Благодійний фонд, що допомагає українським військовим через закупівлю та передачу протимінного захисного взуття на базі військових берців.',
};

export default function FundLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f3f0e8' }}>
      <FundHeader />
      {children}
      <FundFooter />
    </div>
  );
}
