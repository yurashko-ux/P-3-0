// web/app/admin/direct/_components/PlayRecordingButton.tsx
// Кнопка ▶ прослуховування запису Binotel.
// Завжди використовувати proxy URL з generalCallID (не recordingUrl з БД — може бути протермінованим).

"use client";

interface PlayRecordingButtonProps {
  recordingUrl?: string | null;
  generalCallID?: string | null;
  title?: string;
  className?: string;
  /** Якщо задано — відкривати плеєр внутрішньо замість нової вкладки */
  onPlayRequest?: (url: string) => void;
  /** Заборона прослуховування (право callsListen = none): клік нічого не робить, тултип «Прослуховування не доступне» */
  listenDisabled?: boolean;
}

export function PlayRecordingButton({
  recordingUrl,
  generalCallID,
  title = "Прослухати запис",
  className = "text-blue-600 hover:text-blue-800",
  onPlayRequest,
  listenDisabled = false,
}: PlayRecordingButtonProps) {
  const openUrl = (u: string) => {
    if (onPlayRequest) {
      onPlayRequest(u);
    } else {
      window.open(u, "_blank", "noopener,noreferrer");
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (listenDisabled) return;
    if (recordingUrl) {
      openUrl(recordingUrl);
      return;
    }
    if (generalCallID) {
      // Проксі: сервер завантажує MP3 з Binotel S3 і стримить — обхід CORS, завжди свіжий URL
      const proxyUrl = `/api/admin/binotel/call-record-proxy?generalCallID=${encodeURIComponent(generalCallID)}&_t=${Date.now()}`;
      openUrl(proxyUrl);
    }
  };

  const effectiveTitle = listenDisabled ? "Прослуховування не доступне" : title;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      title={effectiveTitle}
    >
      ▶
    </button>
  );
}
