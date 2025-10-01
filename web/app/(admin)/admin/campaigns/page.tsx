// web/app/(admin)/admin/campaigns/page.tsx
import ClientList from "./ClientList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <div className="p-4">
      <div className="rounded-md border">
        <table className="w-full table-auto text-left">
          <thead>
            <tr className="bg-gray-50 text-gray-700">
              <th className="px-4 py-3 w-48">Дата/ID</th>
              <th className="px-4 py-3">Назва</th>
              <th className="px-4 py-3">Сутність</th>
              <th className="px-4 py-3">Воронка</th>
              <th className="px-4 py-3">Лічильник</th>
              <th className="px-4 py-3 w-40">Дії</th>
            </tr>
          </thead>
          <tbody>
            <ClientList />
          </tbody>
        </table>
      </div>
    </div>
  );
}
