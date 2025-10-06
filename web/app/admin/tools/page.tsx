// web/app/admin/tools/page.tsx
export const dynamic = 'force-dynamic';

export default function ToolsIndex() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold">Admin Tools</h1>
      <ul className="list-disc space-y-2 pl-6">
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
        <li>
          <a href="/admin/tools/find" className="text-blue-700 hover:underline">
            Find tester (/api/keycrm/find)
          </a>
        </li>
        <li>
          <a href="/admin/tools/sync-flow" className="text-blue-700 hover:underline">
            Sync flow tester (ManyChat → Campaign → Find → Move)
          </a>
        </li>
      </ul>
      <p className="mt-4 text-sm text-gray-500">Переконайся, що ти увійшов через /admin/login.</p>
    </div>
  );
}
