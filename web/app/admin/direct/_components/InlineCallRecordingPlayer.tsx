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
    console.log("[InlineCallRecordingPlayer] url:", url.substring(0, 80) + "...");
    a.src = url;
    a.load();
    const playPromise = a.play();
    if (playPromise?.catch) {
      playPromise
        .then(() => console.log("[InlineCallRecordingPlayer] play() успіх"))
        .catch((err) => console.warn("[InlineCallRecordingPlayer] play() autoplay блок:", err?.message || err));
    }
    return () => {
      a.pause();
      a.src = "";
    };
  }, [url]);

  const handleAudioError = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    const target = e.currentTarget;
    const err = target.error;
    const codeMap: Record<number, string> = { 1: "ABORTED", 2: "NETWORK", 3: "DECODE", 4: "SRC_NOT_SUPPORTED" };
    const codeStr = err ? codeMap[err.code] || `code=${err.code}` : "?";
    console.warn("[InlineCallRecordingPlayer] audio onError:", codeStr, err?.message, "src:", url.substring(0, 60) + "...");
  };

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
        onError={handleAudioError}
      />
    </div>
  );
}
