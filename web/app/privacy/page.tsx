export const metadata = {
  title: "Політика конфіденційності — Kresco",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-sm leading-6 text-neutral-800">
      <h1 className="mb-4 text-2xl font-semibold text-neutral-950">Політика конфіденційності</h1>
      <p className="mb-3">
        Застосунок Kresco належить салону Home of Beauty Lviv і використовується лише для роботи салону.
        Він читає повідомлення Direct Instagram-акаунта @homebeauty.lviv, щоб зберігати переписку з клієнтами
        в картці клієнта.
      </p>
      <p className="mb-3">
        Повідомлення не продаються і не передаються стороннім рекламним сервісам. Доступ до них мають
        працівники салону, яким це потрібно для запису та відповіді клієнту.
      </p>
      <p className="mb-6">
        Контакт: <a className="underline" href="mailto:yurashko@gmail.com">yurashko@gmail.com</a>
      </p>
      <h2 id="vydalennya" className="mb-3 text-xl font-semibold text-neutral-950">Видалення даних</h2>
      <p>
        Щоб видалити свої повідомлення або дані з Kresco, напишіть на{" "}
        <a className="underline" href="mailto:yurashko@gmail.com">yurashko@gmail.com</a>
        {" "}з темою «Видалення даних» і вкажіть нік Instagram. Запит виконаємо і підтвердимо відповіддю на цей лист.
      </p>
    </main>
  );
}
