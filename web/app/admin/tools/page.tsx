// web/app/admin/tools/page.tsx
import CronExpireButton from "./CronExpireButton";

export const dynamic = 'force-dynamic';

export default function ToolsIndex() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Tools</h1>
        <p className="mt-2 text-sm text-slate-600">
          Допоміжні утиліти для ManyChat → KeyCRM інтеграції. Памʼятай увійти через <code>/admin/login</code>,
          щоб встановити адмін-куку.
        </p>
      </div>

      <div className="grid gap-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Швидкі тести</h2>
          <ul className="list-disc space-y-2 pl-6 text-sm text-slate-700">
            <li>
              <a href="/admin/tools/ingest" className="text-blue-700 hover:underline">
                Ingest tester (/api/mc/ingest)
              </a>
            </li>
            <li>
              <a href="/admin/tools/move" className="text-blue-700 hover:underline">
                Move tester (/api/keycrm/card/move)
              </a>
            </li>
          </ul>
        </div>

        <CronExpireButton />
      </div>
    </div>
  );
}
