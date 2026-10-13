// Ізольований shell для Telegram Mini App «Мій журнал».
// Жодних посилань на /admin — лише журнал одного майстра.

import Script from "next/script";

export const metadata = {
  title: "Мій журнал",
};

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      {children}
    </div>
  );
}
