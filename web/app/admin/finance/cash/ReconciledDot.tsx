/** Кружечок стану: зелений — зведено (або пройшла касовка), сірий — ще ні. */
export function ReconciledDot({ done, doneTitle, openTitle }: { done: boolean; doneTitle: string; openTitle: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${done ? "bg-emerald-500" : "bg-gray-300"}`}
      title={done ? doneTitle : openTitle}
      aria-label={done ? doneTitle : openTitle}
    />
  );
}
