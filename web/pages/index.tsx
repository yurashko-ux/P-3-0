import { useEffect, useState } from "react";

export default function Home() {
  const [ping, setPing] = useState<any>(null);

  useEffect(() => {
    fetch("/api/public/mc/ingest-proxy")
      .then((r) => r.json())
      .then(setPing)
      .catch((e) => setPing({ error: String(e) }));
  }, []);

  return (
    <main style={{ minHeight: "100vh", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 8 }}>P-3-0: головна</h1>
      <p style={{ color: "#666", marginBottom: 16 }}>
        Ця сторінка існує, щоб не було 404 і щоб швидко перевірити публічний
        ендпоінт.
      </p>

      <div style={{ marginTop: 24 }}>
        <h3>/api/public/mc/ingest-proxy → GET</h3>
        <pre
          style={{
            background: "#111",
            color: "#0f0",
            padding: 12,
            borderRadius: 8,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(ping, null, 2)}
        </pre>
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          onClick={async () => {
            const res = await fetch("/api/public/mc/ingest-proxy", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                lead_id: 486,
                instagram_username: "mykolayyurashko",
                text: "hello from homepage",
              }),
            });
            const data = await res.json().catch(() => ({}));
            alert("POST result:\n" + JSON.stringify(data, null, 2));
          }}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "#222",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Тестовий POST на /api/public/mc/ingest-proxy
        </button>
      </div>
    </main>
  );
}
