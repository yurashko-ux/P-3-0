'use client';

import { useState } from 'react';
import { getFundRequisitesPlainText } from '@/lib/fund-requisites';

export function CopyAllRequisitesButton() {
  const [copied, setCopied] = useState(false);
  const text = getFundRequisitesPlainText();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
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
        cursor: 'pointer',
        fontWeight: 800,
        fontSize: 15,
        border: copied ? '2px solid rgba(248,247,242,0.85)' : '2px solid rgba(248,247,242,0.45)',
        background: copied ? 'rgba(248,247,242,0.18)' : 'transparent',
        color: '#f8f7f2',
      }}
    >
      {copied ? 'Скопійовано' : 'Скопіювати всі реквізити'}
    </button>
  );
}
