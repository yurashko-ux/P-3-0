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
}

export function PlayRecordingButton({
  recordingUrl,
  generalCallID,
  title = "Прослухати запис",
  className = "text-blue-600 hover:text-blue-800",
  onPlayRequest,
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

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      title={title}
    >
      ▶
    </button>
  );
}
