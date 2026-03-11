// web/app/admin/direct/_components/InlineCallRecordingPlayer.tsx
// Невелике вікно для прослуховування запису дзвінка безпосередньо в таблиці Direct

"use client";

import { useRef, useEffect } from "react";

interface InlineCallRecordingPlayerProps {
  url: string;
  onClose: () => void;
}

export function InlineCallRecordingPlayer({ url, onClose }: InlineCallRecordingPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.src = url;
    a.load();
    return () => {
      a.pause();
      a.src = "";
    };
  }, [url]);

  return (
    <div
      className="fixed z-[60] bottom-6 right-6 w-72 bg-white rounded-lg shadow-xl border border-gray-200 p-3 flex flex-col gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium text-gray-700">Запис дзвінка</span>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 p-0.5"
          title="Закрити"
        >
          ✕
        </button>
      </div>
      <audio
        ref={audioRef}
        controls
        className="w-full h-8"
        style={{ maxHeight: "32px" }}
        preload="metadata"
      />
    </div>
  );
}
