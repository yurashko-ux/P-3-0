"use client";

import { useState } from "react";

/**
 * Демонстраційна сторінка для тестування Web Scraper
 * Доступна за адресою: /admin/web-scraper-demo
 */

interface ScraperResult {
  success: boolean;
  contentType?: string;
  data?: any;
  html?: string;
  text?: string;
  error?: string;
  url?: string;
  timestamp?: string;
  [key: string]: any;
}

export default function WebScraperDemoPage() {
  const [url, setUrl] = useState("https://api.github.com/users/github");
  const [method, setMethod] = useState<"fetch" | "parse">("fetch");
  const [selector, setSelector] = useState("h1");
  const [customHeaders, setCustomHeaders] = useState("");
  const [result, setResult] = useState<ScraperResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Підготовка тіла запиту
      const body: any = {
        url,
        method,
      };

      // Додаємо опції якщо потрібно
      const options: any = {};

      if (method === "parse" && selector) {
        options.selector = selector;
      }

      if (customHeaders.trim()) {
        try {
          options.headers = JSON.parse(customHeaders);
        } catch {
          setError("Невірний JSON у полі Custom Headers");
          setLoading(false);
          return;
        }
      }

      if (Object.keys(options).length > 0) {
        body.options = options;
      }

      // credentials: cookie admin_token з адмін-логіну
      const response = await fetch("/api/admin/web-scraper", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (response.status === 401) {
        setError(data?.hint || data?.error || "Потрібен вхід в адмінку");
        setResult(data);
        return;
      }
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Невідома помилка");
    } finally {
      setLoading(false);
    }
  };

  const exampleUrls = [
    {
      name: "GitHub API",
      url: "https://api.github.com/users/github",
      method: "fetch" as const,
      selector: "",
    },
    {
      name: "Exchange Rates",
      url: "https://api.exchangerate-api.com/v4/latest/USD",
      method: "fetch" as const,
      selector: "",
    },
    {
      name: "Example.com HTML",
      url: "https://example.com",
      method: "parse" as const,
      selector: "h1",
    },
    {
      name: "JSON Placeholder",
      url: "https://jsonplaceholder.typicode.com/posts/1",
      method: "fetch" as const,
      selector: "",
    },
  ];

  const setExample = (example: typeof exampleUrls[0]) => {
    setUrl(example.url);
    setMethod(example.method);
    setSelector(example.selector);
    setCustomHeaders("");
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Заголовок */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              🌐 Web Scraper Demo
            </h1>
            <p className="text-gray-600">
              Тестова панель для читання інформації з веб-сайтів
            </p>
          </div>

          {/* Приклади */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Швидкі приклади:
            </h2>
            <div className="flex flex-wrap gap-2">
              {exampleUrls.map((example, idx) => (
                <button
                  key={idx}
                  onClick={() => setExample(example)}
                  className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                  type="button"
                >
                  {example.name}
                </button>
              ))}
            </div>
          </div>

          {/* Форма */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                URL
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://example.com"
                required
              />
            </div>

            {/* Метод */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Метод
              </label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="fetch"
                    checked={method === "fetch"}
                    onChange={(e) =>
                      setMethod(e.target.value as "fetch" | "parse")
                    }
                    className="mr-2"
                  />
                  <span className="text-sm">
                    Fetch (API / JSON)
                  </span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="parse"
                    checked={method === "parse"}
                    onChange={(e) =>
                      setMethod(e.target.value as "fetch" | "parse")
                    }
                    className="mr-2"
                  />
                  <span className="text-sm">
                    Parse (HTML парсинг)
                  </span>
                </label>
              </div>
            </div>

            {/* Селектор (тільки для parse) */}
            {method === "parse" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CSS Селектор
                </label>
                <input
                  type="text"
                  value={selector}
                  onChange={(e) => setSelector(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="h1, .class, #id"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Приклади: h1, .product-price, #main-title
                </p>
              </div>
            )}

            {/* Custom Headers */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Custom Headers (JSON, опціонально)
              </label>
              <textarea
                value={customHeaders}
                onChange={(e) => setCustomHeaders(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                placeholder='{"Authorization": "Bearer token", "X-Custom": "value"}'
                rows={3}
              />
            </div>

            {/* Кнопка */}
            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? "Завантаження..." : "🚀 Виконати запит"}
              </button>
            </div>
          </form>

          {/* Помилка */}
          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 font-medium">❌ Помилка</p>
              <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
          )}

          {/* Результат */}
          {result && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                {result.success ? "✅ Результат" : "❌ Помилка"}
              </h2>

              {result.success ? (
                <div className="space-y-4">
                  {/* Метадані */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">URL:</span>
                      <span className="ml-2 text-gray-900 break-all">
                        {result.url}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Content Type:</span>
                      <span className="ml-2 text-gray-900">
                        {result.contentType}
                      </span>
                    </div>
                    {result.timestamp && (
                      <div>
                        <span className="text-gray-600">Timestamp:</span>
                        <span className="ml-2 text-gray-900">
                          {new Date(result.timestamp).toLocaleString("uk-UA")}
                        </span>
                      </div>
                    )}
                    {result.method && (
                      <div>
                        <span className="text-gray-600">Method:</span>
                        <span className="ml-2 text-gray-900">
                          {result.method}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Дані */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-medium text-gray-700">
                        Дані:
                      </h3>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            JSON.stringify(result, null, 2)
                          );
                          alert("Скопійовано в буфер обміну!");
                        }}
                        className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                        type="button"
                      >
                        📋 Копіювати
                      </button>
                    </div>
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
                      {JSON.stringify(result.data || result, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700">{result.error}</p>
                </div>
              )}
            </div>
          )}

          {/* Довідка */}
          <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">
              💡 Довідка
            </h3>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>
                • <strong>Fetch:</strong> для API та JSON даних
              </li>
              <li>
                • <strong>Parse:</strong> для HTML сторінок з можливістю вибору
                елементів
              </li>
              <li>
                • Таймаут: 10 секунд на запит
              </li>
              <li>
                • Детальна документація: WEB_SCRAPER_GUIDE.md
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
