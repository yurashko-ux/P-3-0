// web/app/admin/photo-reports/page.tsx
// Сторінка для тестування та аналітики фото-звітів
// Updated: 2025-12-02

"use client";

import { useState, useEffect } from "react";

type MasterProfile = {
  id: string;
  name: string;
  telegramUsername?: string;
  role: string;
  altegioStaffId?: number;
};

type TestReminderResult = {
  ok: boolean;
  message?: string;
  error?: string;
  chatId?: number;
  appointment?: any;
};

type PhotoReport = {
  id: string;
  appointmentId: string;
  masterId: string;
  masterName: string;
  clientName: string;
  serviceName: string;
  createdAt: string;
  telegramFileIds: string[];
};

type Analytics = {
  totalReports: number;
  reportsByMaster: Record<string, number>;
  recentReports: PhotoReport[];
};

type ServicesStats = {
  statsByMaster: Array<{
    masterId: string;
    masterName: string;
    count: number;
  }>;
  hairExtensionAppointments: number;
  completedAppointments: number;
  totalAppointments: number;
  period: {
    daysBack: number;
    dateFrom: string;
    dateTo: string;
  };
};

export default function PhotoReportsPage() {
  const [testResult, setTestResult] = useState<TestReminderResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState("Mykolay007");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [servicesStats, setServicesStats] = useState<ServicesStats | null>(null);
  const [isLoadingServicesStats, setIsLoadingServicesStats] = useState(false);
  const [servicesStatsError, setServicesStatsError] = useState<string | null>(null);
  const [masters, setMasters] = useState<MasterProfile[]>([]);

  useEffect(() => {
    // Завантажуємо майстрів при завантаженні сторінки
    fetch("/api/photo-reports/masters")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.masters) {
          setMasters(data.masters);
        }
      })
      .catch((err) => console.error("Failed to load masters:", err));
  }, []);

  const handleTestReminder = async () => {
    setIsLoading(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/telegram/test-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramUsername,
          clientName: "Тестовий клієнт",
          serviceName: "Тестова послуга",
          minutesUntilEnd: 15,
        }),
      });

      const data = await response.json();
      setTestResult(data);
    } catch (error) {
      setTestResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setIsLoadingAnalytics(true);
    try {
      const response = await fetch("/api/telegram/debug");
      const data = await response.json();

      if (data.ok && data.recentReports) {
        const reportsByMaster: Record<string, number> = {};
        data.recentReports.forEach((report: PhotoReport) => {
          reportsByMaster[report.masterId] =
            (reportsByMaster[report.masterId] || 0) + 1;
        });

        setAnalytics({
          totalReports: data.recentReports.length,
          reportsByMaster,
          recentReports: data.recentReports.slice(0, 20),
        });
      }
    } catch (error) {
      console.error("Failed to load analytics:", error);
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  const loadServicesStats = async () => {
    setIsLoadingServicesStats(true);
    setServicesStatsError(null);
    try {
      const response = await fetch(
        "/api/photo-reports/services-stats?daysBack=30&includeFuture=true"
      );
      const data = await response.json();

      console.log("[photo-reports] Services stats response:", data);

      if (data.ok && data.statsByMaster) {
        setServicesStats(data);
        setServicesStatsError(null);
      } else {
        const errorMsg = data.error || "Невідома помилка";
        setServicesStatsError(errorMsg);
        console.error("Failed to load services stats:", data);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setServicesStatsError(errorMsg);
      console.error("Failed to load services stats:", error);
    } finally {
      setIsLoadingServicesStats(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Фото-звіти</h1>
        <p className="mt-2 text-sm text-slate-500">
          Тестування нагадувань та аналітика по майстрах
        </p>
      </header>

      {/* Тестова секція */}
      <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-800">
          🧪 Тестове нагадування
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          Відправ тестове нагадування про фото-звіт в Telegram. Користувач має
          бути зареєстрований (надіслати /start боту).
        </p>

        <div className="mb-4 flex gap-4">
          <div className="flex-1">
            <label
              htmlFor="username"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Telegram Username
            </label>
            <input
              id="username"
              type="text"
              value={telegramUsername}
              onChange={(e) => setTelegramUsername(e.target.value)}
              placeholder="Mykolay007"
              className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleTestReminder}
              disabled={isLoading || !telegramUsername}
              className="rounded-lg bg-blue-600 px-6 py-2 font-semibold text-white shadow-md transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Відправка..." : "Відправити тест"}
            </button>
          </div>
        </div>

        {testResult && (
          <div
            className={`rounded-lg border p-4 ${
              testResult.ok
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            {testResult.ok ? (
              <div>
                <p className="font-semibold text-green-800">✅ Успішно!</p>
                <p className="mt-1 text-sm text-green-700">
                  {testResult.message}
                </p>
                {testResult.chatId && (
                  <p className="mt-1 text-xs text-green-600">
                    Chat ID: {testResult.chatId}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="font-semibold text-red-800">❌ Помилка</p>
                <p className="mt-1 text-sm text-red-700">
                  {testResult.error || "Невідома помилка"}
                </p>
                {testResult.error?.includes("chatId not found") && (
                  <p className="mt-2 text-xs text-red-600">
                    💡 Підказка: Надішли /start боту в Telegram, щоб
                    зареєструватися
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Аналітика */}
      <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-800">
            📊 Аналітика по майстрах
          </h2>
          <div className="flex gap-2">
            <button
              onClick={loadServicesStats}
              disabled={isLoadingServicesStats}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingServicesStats ? "Завантаження..." : "Завантажити послуги"}
            </button>
            <button
              onClick={loadAnalytics}
              disabled={isLoadingAnalytics}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingAnalytics ? "Завантаження..." : "Оновити звіти"}
            </button>
          </div>
        </div>

        {servicesStatsError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-800">❌ Помилка завантаження послуг</p>
            <p className="mt-1 text-sm text-red-700">{servicesStatsError}</p>
            <p className="mt-2 text-xs text-red-600">
              Перевір логи в консолі браузера (F12) або логи Vercel для деталей.
            </p>
          </div>
        )}

        {analytics ? (
          <div className="space-y-6">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-600">
                Всього фото-звітів
              </p>
              <p className="mt-1 text-3xl font-bold text-slate-900">
                {analytics.totalReports}
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-semibold text-slate-800">
                По майстрах
              </h3>
              {servicesStats && (
                <p className="mb-3 text-sm text-slate-600">
                  Період: останні {servicesStats.period.daysBack} днів (
                  {servicesStats.period.dateFrom} - {servicesStats.period.dateTo})
                  • Всього послуг "Нарощування волосся": {servicesStats.hairExtensionAppointments}
                  {servicesStats.completedAppointments > 0 && (
                    <span className="ml-2 text-slate-400">
                      (з {servicesStats.completedAppointments} завершених записів)
                    </span>
                  )}
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {masters
                  .filter((m) => m.role === "master")
                  .map((master) => {
                    const reportsCount =
                      analytics.reportsByMaster[master.id] || 0;
                    
                    // Знаходимо статистику послуг для цього майстра
                    const servicesCount =
                      servicesStats?.statsByMaster.find(
                        (s) => s.masterId === master.id
                      )?.count || 0;

                    // Обчислюємо відсоток покриття
                    const coveragePercent =
                      servicesCount > 0
                        ? Math.round((reportsCount / servicesCount) * 100)
                        : 0;

                    return (
                      <div
                        key={master.id}
                        className="rounded-lg border border-slate-200 bg-white p-4"
                      >
                        <div className="mb-3">
                          <p className="font-semibold text-slate-800">
                            {master.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {master.telegramUsername || "—"}
                          </p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          {/* Фото-звіти */}
                          <div className="text-center">
                            <p className="text-2xl font-bold text-blue-600">
                              {reportsCount}
                            </p>
                            <p className="text-xs text-slate-500">фото-звітів</p>
                          </div>
                          
                          {/* Послуги надано */}
                          <div className="text-center">
                            <p className="text-2xl font-bold text-green-600">
                              {servicesCount}
                            </p>
                            <p className="text-xs text-slate-500">
                              послуг надано
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              (Нарощування)
                            </p>
                          </div>
                        </div>

                        {/* Покриття */}
                        {servicesCount > 0 && (
                          <div className="mt-3 border-t border-slate-200 pt-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-600">
                                Покриття:
                              </span>
                              <span
                                className={`text-sm font-semibold ${
                                  coveragePercent >= 80
                                    ? "text-green-600"
                                    : coveragePercent >= 50
                                    ? "text-yellow-600"
                                    : "text-red-600"
                                }`}
                              >
                                {coveragePercent}%
                              </span>
                            </div>
                            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={`h-full transition-all ${
                                  coveragePercent >= 80
                                    ? "bg-green-500"
                                    : coveragePercent >= 50
                                    ? "bg-yellow-500"
                                    : "bg-red-500"
                                }`}
                                style={{ width: `${coveragePercent}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>

            {analytics.recentReports.length > 0 && (
              <div>
                <h3 className="mb-3 text-lg font-semibold text-slate-800">
                  Останні звіти
                </h3>
                <div className="space-y-2">
                  {analytics.recentReports.map((report) => (
                    <div
                      key={report.id}
                      className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-800">
                            {report.clientName} • {report.serviceName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {report.masterName} •{" "}
                            {new Date(report.createdAt).toLocaleString("uk-UA")}
                          </p>
                        </div>
                        <div className="text-xs text-slate-500">
                          {report.telegramFileIds?.length || 0} фото
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
            <p className="text-slate-500">
              Натисни "Оновити", щоб завантажити аналітику
            </p>
          </div>
        )}
      </section>

      {/* Інформація про майстрів */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-800">
          👥 Зареєстровані майстри
        </h2>
        <div className="space-y-2">
          {masters.map((master) => (
            <div
              key={master.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <div>
                <p className="font-medium text-slate-800">{master.name}</p>
                <p className="text-xs text-slate-500">
                  {master.telegramUsername || "—"} • {master.role}
                  {master.altegioStaffId && (
                    <span> • Altegio ID: {master.altegioStaffId}</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

