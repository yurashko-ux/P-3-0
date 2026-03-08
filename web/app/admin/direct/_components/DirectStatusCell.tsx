'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { DirectClient, DirectStatus } from '@/lib/direct-types';

const DEFAULT_STATUS_COLOR = '#fbbf24';

interface DirectStatusCellProps {
  client: DirectClient;
  statuses: DirectStatus[];
  onStatusChange: (update: { clientId: string; statusId: string }) => Promise<void>;
  /** Prefetch: warm-up перед PATCH при відкритті меню */
  onMenuOpen?: (clientId: string) => void;
}

export function DirectStatusCell({ client, statuses, onStatusChange, onMenuOpen }: DirectStatusCellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (isOpen && dropdownRef.current && typeof document !== 'undefined') {
      const rect = dropdownRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPanelPosition(null);
    }
  }, [isOpen]);

  const statusId = (client.statusId || '').toString().trim();
  const status = statuses.find((s) => s.id === statusId);
  const isClientType = Boolean(client.altegioClientId);

  const displayName = status
    ? status.name
    : isClientType
      ? 'Клієнт'
      : 'Лід';
  const displayColor = status ? status.color : DEFAULT_STATUS_COLOR;

  const fg =
    displayColor === DEFAULT_STATUS_COLOR
      ? '#111827'
      : (() => {
          const hex = displayColor.replace(/^#/, '');
          if (hex.length !== 6) return '#ffffff';
          const r = parseInt(hex.slice(0, 2), 16) / 255;
          const g = parseInt(hex.slice(2, 4), 16) / 255;
          const b = parseInt(hex.slice(4, 6), 16) / 255;
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          return luminance > 0.5 ? '#111827' : '#ffffff';
        })();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const setStatus = async (newStatusId: string) => {
    if (!client?.id) {
      alert('Помилка: клієнт не знайдено (відсутній ID)');
      return;
    }
    setLoading(true);
    try {
      await onStatusChange({ clientId: client.id, statusId: newStatusId });
      setIsOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка мережі');
    } finally {
      setLoading(false);
    }
  };

  const portalTarget =
    typeof document !== 'undefined'
      ? document.getElementById('direct-filter-dropdown-root') ?? document.body
      : null;

  const panelContent =
    isOpen &&
    panelPosition &&
    portalTarget &&
    createPortal(
      <div
        ref={panelRef}
        className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[160px] max-h-64 overflow-y-auto py-1 pointer-events-auto"
        style={{
          position: 'fixed',
          top: panelPosition.top,
          left: panelPosition.left,
          zIndex: 999999,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {statuses.map((s) => (
          <button
            key={s.id}
            type="button"
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-base-200 flex items-center gap-2"
            onClick={() => void setStatus(s.id)}
            disabled={loading}
          >
            <span
              className="w-3 h-3 rounded shrink-0"
              style={{ backgroundColor: s.color }}
            />
            {s.name}
          </button>
        ))}
      </div>,
      portalTarget
    );

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-[11px] font-normal min-w-[60px] h-6 hover:opacity-80 transition-opacity"
        style={{ backgroundColor: displayColor, color: fg }}
        onClick={() => {
          if (!isOpen) onMenuOpen?.(client.id);
          setIsOpen(!isOpen);
        }}
        disabled={loading}
      >
        {displayName}
      </button>
      {panelContent}
    </div>
  );
}
