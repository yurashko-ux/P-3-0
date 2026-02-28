'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { DirectClient, DirectCallStatus } from '@/lib/direct-types';
import { getChatBadgeStyle, CHAT_BADGE_KEYS } from './ChatBadgeIcon';
import { ChatBadgeIcon } from './ChatBadgeIcon';

const NEW_STATUS_NAME_MAX_LEN = 24;

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return iso;
  }
}

interface CallStatusCellProps {
  client: DirectClient;
  callStatuses: DirectCallStatus[];
  onStatusChange: (update: {
    clientId: string;
    callStatusId: string | null;
    callStatusName?: string;
    callStatusBadgeKey?: string;
    callStatusSetAt?: string | null;
    callStatusLogs?: Array<{ statusName: string; changedAt: string }>;
  }) => void;
  onCallStatusCreated?: (status: DirectCallStatus) => void;
}

export function CallStatusCell({ client, callStatuses, onStatusChange, onCallStatusCreated }: CallStatusCellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusBadgeKey, setNewStatusBadgeKey] = useState<string>('badge_1');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const statusName = ((client as any).callStatusName || '').toString().trim();
  const badgeKey = ((client as any).callStatusBadgeKey || '').toString().trim() || 'badge_1';
  const setAt = (client as any).callStatusSetAt;
  const callLogs = ((client as any).callStatusLogs || []) as Array<{ statusName: string; changedAt: string }>;
  const badgeCfg = getChatBadgeStyle(badgeKey);

  useLayoutEffect(() => {
    if (isOpen && dropdownRef.current && typeof document !== 'undefined') {
      const rect = dropdownRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPanelPosition(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
      setCreateMode(false);
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const setCallStatus = async (statusId: string | null) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/direct/clients/${encodeURIComponent(client.id)}/call-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusId }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || 'Помилка зміни статусу');
        return;
      }
      const st = statusId ? callStatuses.find((s) => s.id === statusId) : null;
      onStatusChange({
        clientId: client.id,
        callStatusId: statusId,
        callStatusName: st?.name,
        callStatusBadgeKey: st?.badgeKey,
        callStatusSetAt: data.client?.callStatusSetAt ? new Date(data.client.callStatusSetAt).toISOString() : null,
        callStatusLogs: undefined,
      });
      setIsOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка мережі');
    } finally {
      setLoading(false);
    }
  };

  const createCallStatus = async () => {
    const name = newStatusName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/direct/call-statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, badgeKey: newStatusBadgeKey, order: callStatuses.length }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || 'Помилка створення статусу');
        return;
      }
      const created = data.status as DirectCallStatus;
      onCallStatusCreated?.(created);
      onStatusChange({
        clientId: client.id,
        callStatusId: created.id,
        callStatusName: created.name,
        callStatusBadgeKey: created.badgeKey || 'badge_1',
        callStatusSetAt: new Date().toISOString(),
        callStatusLogs: undefined,
      });
      setCreateMode(false);
      setNewStatusName('');
      setNewStatusBadgeKey('badge_1');
      setIsOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка мережі');
    } finally {
      setLoading(false);
    }
  };

  const portalTarget =
    typeof document !== 'undefined' ? document.getElementById('direct-filter-dropdown-root') ?? document.body : null;

  const panelContent = panelPosition && (
    <div
      ref={panelRef}
      className="absolute z-[100] min-w-[220px] max-w-[320px] rounded-lg border border-gray-200 bg-white shadow-lg"
      style={{ top: panelPosition.top, left: panelPosition.left }}
    >
      <div className="p-3 max-h-[400px] overflow-y-auto">
        <div className="text-xs font-semibold text-gray-700 mb-3">Статус дзвінків</div>

        {/* Історія */}
        <div className="mb-3">
          <div className="text-[10px] font-semibold text-gray-500 mb-1.5">Історія</div>
          {callLogs.length === 0 ? (
            <div className="text-xs text-gray-400">Немає змін</div>
          ) : (
            <div className="space-y-1 text-xs">
              {callLogs.map((log, i) => (
                <div key={i} className="text-gray-600">
                  {log.statusName} — {formatDateShort(log.changedAt)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Створити статус */}
        {createMode ? (
          <div className="mb-4 p-2 rounded border bg-gray-50">
            <div className="text-xs font-semibold mb-2">Новий статус</div>
            <label className="form-control w-full mb-2">
              <input
                className="input input-xs input-bordered w-full"
                value={newStatusName}
                onChange={(e) => setNewStatusName(e.target.value)}
                maxLength={NEW_STATUS_NAME_MAX_LEN}
                placeholder="Назва (напр. Недодзвон)"
              />
            </label>
            <div className="mb-2">
              <div className="text-[10px] mb-1">Бейдж</div>
              <div className="flex flex-wrap gap-1">
                {CHAT_BADGE_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`btn btn-xs ${newStatusBadgeKey === k ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setNewStatusBadgeKey(k)}
                    title={`Обрати ${k}`}
                  >
                    <ChatBadgeIcon badgeKey={k} size={14} />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-xs btn-primary" onClick={createCallStatus} disabled={loading || !newStatusName.trim()}>
                Створити
              </button>
              <button className="btn btn-xs" onClick={() => { setCreateMode(false); setNewStatusName(''); }}>
                Скасувати
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-xs btn-ghost mb-4"
            onClick={() => setCreateMode(true)}
            type="button"
          >
            + Створити статус
          </button>
        )}

        {/* Вибір статусу */}
        <div className="mb-2">
          <div className="text-[10px] font-semibold text-gray-500 mb-1.5">Обрати</div>
          <div className="flex flex-col gap-1">
            <button
              className="btn btn-xs justify-start"
              onClick={() => void setCallStatus(null)}
              disabled={loading}
              type="button"
            >
              Без статусу
            </button>
            {callStatuses.map((s) => (
              <button
                key={s.id}
                className={`btn btn-xs justify-start ${client.callStatusId === s.id ? 'btn-primary' : ''}`}
                onClick={() => void setCallStatus(s.id)}
                disabled={loading}
                type="button"
              >
                <ChatBadgeIcon badgeKey={(s as any).badgeKey} size={14} />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        className="w-full text-left min-w-0 rounded px-1 py-0.5 hover:bg-gray-100 transition-colors"
        onClick={() => setIsOpen((o) => !o)}
        title="Статус дзвінків — клік для зміни"
      >
        {statusName ? (
          <div className="flex flex-col items-start gap-0.5 min-w-0">
            <span
              className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-normal leading-none"
              style={{ backgroundColor: badgeCfg.bg, color: badgeCfg.fg }}
            >
              {statusName}
            </span>
            {setAt && (
              <span className="text-[10px] text-gray-500">{formatDateShort(setAt)}</span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gray-400">—</span>
        )}
      </button>
      {isOpen && portalTarget && createPortal(panelContent, portalTarget)}
    </div>
  );
}
