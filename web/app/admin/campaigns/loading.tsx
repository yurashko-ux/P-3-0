// web/app/admin/campaigns/loading.tsx
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="h-8 w-40 rounded-xl bg-gray-100" />
      <div className="grid grid-cols-1 gap-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border p-5">
            <div className="h-5 w-64 rounded bg-gray-100 mb-3" />
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              {Array.from({ length: 8 }).map((_, j) => (
                <div key={j} className="rounded-xl border p-3">
                  <div className="h-3 w-16 rounded bg-gray-100 mb-2" />
                  <div className="h-5 w-10 rounded bg-gray-100" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
