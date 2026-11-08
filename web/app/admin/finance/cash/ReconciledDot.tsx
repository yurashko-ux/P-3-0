export type ReconcileStatus = "full" | "partial" | "none";

const STATUS_CLASS: Record<ReconcileStatus, string> = {
  full: "bg-emerald-500",
  partial: "bg-amber-400",
  none: "bg-gray-300",
};

/** Кружечок стану: зелений — зведено, жовтий — частково, сірий — ні (у касі — чи була касовка). */
export function ReconciledDot({
  done,
  status,
  doneTitle,
  openTitle,
  partialTitle = "Зведено частково",
  onClick,
  expanded,
}: {
  done?: boolean;
  status?: ReconcileStatus;
  doneTitle: string;
  openTitle: string;
  partialTitle?: string;
  /** Кружечок-кнопка: розгортає документи платежу */
  onClick?: () => void;
  expanded?: boolean;
}) {
  const state: ReconcileStatus = status ?? (done ? "full" : "none");
  const title = state === "full" ? doneTitle : state === "partial" ? partialTitle : openTitle;
  const dot = <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_CLASS[state]}`} />;
  if (!onClick) {
    return (
      <span className="inline-flex" title={title} aria-label={title}>
        {dot}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full transition hover:ring-2 hover:ring-gray-200 ${
        expanded ? "ring-2 ring-gray-300" : ""
      }`}
      title={`${title} — показати документи`}
      aria-label={title}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {dot}
    </button>
  );
}
