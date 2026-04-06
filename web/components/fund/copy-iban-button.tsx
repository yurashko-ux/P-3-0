'use client';

import { useState } from 'react';
import { FUND_IBAN } from '@/lib/fund-requisites';

const olive = '#4d5b43';
const oliveDark = '#404c38';

export function CopyIbanButton() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(FUND_IBAN);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = FUND_IBAN;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
      } catch {
        // ignore
      }
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '14px 22px',
        borderRadius: 16,
        border: 'none',
        cursor: 'pointer',
        fontWeight: 800,
        fontSize: 15,
        background: copied ? oliveDark : olive,
        color: '#f8f7f2',
        boxShadow: '0 10px 28px rgba(77,91,67,0.35)',
      }}
    >
      {copied ? 'Скопійовано' : 'Скопіювати IBAN'}
    </button>
  );
}
