# CustomGridLayout - Шаблон блочного позиціонування для адмін-панелей

Універсальний React компонент для створення переміщуваних та змінюваних блоків в адмін-панелях з автоматичним позиціонуванням та збереженням стану.

## Особливості

- ✅ **Drag & Drop** з кроком 1px для точного позиціонування
- ✅ **Resize** по висоті, ширині або обох напрямках одночасно
- ✅ **Автоматичне зміщення** нижніх блоків при зміні висоти верхніх
- ✅ **Автоматичне оновлення** висоти при розгортанні/скриванні контенту (ResizeObserver)
- ✅ **Збереження позицій** в localStorage з версіонуванням
- ✅ **Адаптивність** до зміни розміру вікна

## Встановлення

Компонент знаходиться в `web/components/admin/CustomGridLayout.tsx` і готовий до використання без додаткових залежностей.

## Базовий приклад використання

```tsx
"use client";

import { CustomGridLayout, LayoutItem } from "@/components/admin/CustomGridLayout";

export default function MyDashboardPage() {
  // Дефолтні позиції блоків
  const defaultLayout: LayoutItem[] = [
    { i: "block-1", x: 0, y: 0, w: 6, h: 100 },   // x, y в пікселях, w в колонках (1-12), h в пікселях
    { i: "block-2", x: 6, y: 0, w: 6, h: 100 },
    { i: "block-3", x: 0, y: 100, w: 12, h: 80 },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1>Мій дашборд</h1>
      
      <CustomGridLayout
        storageKey="my-dashboard-layout"
        layoutVersion="1"
        defaultLayout={defaultLayout}
      >
        {{
          "block-1": (
            <div className="card bg-white p-6">
              <h2>Блок 1</h2>
              <p>Контент першого блоку</p>
            </div>
          ),
          "block-2": (
            <div className="card bg-white p-6">
              <h2>Блок 2</h2>
              <p>Контент другого блоку</p>
            </div>
          ),
          "block-3": (
            <div className="card bg-white p-6">
              <h2>Блок 3</h2>
              <p>Контент третього блоку</p>
            </div>
          ),
        }}
      </CustomGridLayout>
    </div>
  );
}
```

## API

### Props

| Prop | Тип | Обов'язковий | Опис |
|------|-----|--------------|------|
| `storageKey` | `string` | ✅ | Ключ для збереження layout в localStorage |
| `layoutVersion` | `string` | ✅ | Версія layout (при зміні версії localStorage очищається) |
| `defaultLayout` | `LayoutItem[]` | ✅ | Масив дефолтних позицій блоків |
| `children` | `Record<string, ReactNode>` | ✅ | Об'єкт з ключами як id блоків та ReactNode як контентом |
| `cols` | `number` | ❌ | Кількість колонок (за замовчуванням 12) |
| `minHeight` | `number` | ❌ | Мінімальна висота блоку в пікселях (за замовчуванням 20) |
| `containerPadding` | `number` | ❌ | Padding контейнера в пікселях (за замовчуванням 48) |

### LayoutItem

```typescript
type LayoutItem = {
  i: string;      // Унікальний ID блоку (має співпадати з ключем в children)
  x: number;      // Позиція по X в пікселях (0 = лівий край)
  y: number;      // Позиція по Y в пікселях (0 = верхній край)
  w: number;      // Ширина в колонках (1-12 для стандартної сітки)
  h: number;      // Висота в пікселях
};
```

## Приклади використання

### Приклад з динамічним контентом

```tsx
"use client";

import { useState } from "react";
import { CustomGridLayout, LayoutItem } from "@/components/admin/CustomGridLayout";

export default function AnalyticsPage() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const defaultLayout: LayoutItem[] = [
    { i: "stats", x: 0, y: 0, w: 12, h: 150 },
    { i: "chart", x: 0, y: 150, w: 8, h: 300 },
    { i: "table", x: 8, y: 150, w: 4, h: 300 },
  ];

  return (
    <CustomGridLayout
      storageKey="analytics-dashboard-layout"
      layoutVersion="1"
      defaultLayout={defaultLayout}
    >
      {{
        "stats": (
          <div className="card p-6">
            <h2>Статистика</h2>
            <button onClick={() => setExpanded({ ...expanded, stats: !expanded.stats })}>
              {expanded.stats ? "Згорнути" : "Розгорнути"}
            </button>
            {expanded.stats && (
              <div className="mt-4">
                <p>Детальна статистика...</p>
              </div>
            )}
          </div>
        ),
        "chart": (
          <div className="card p-6">
            <h2>Графік</h2>
            {/* Графік буде автоматично збільшувати висоту блоку */}
          </div>
        ),
        "table": (
          <div className="card p-6">
            <h2>Таблиця</h2>
            {/* Таблиця буде автоматично збільшувати висоту блоку */}
          </div>
        ),
      }}
    </CustomGridLayout>
  );
}
```

### Приклад з кастомними налаштуваннями

```tsx
<CustomGridLayout
  storageKey="custom-dashboard"
  layoutVersion="2"
  defaultLayout={defaultLayout}
  cols={16}              // 16 колонок замість 12
  minHeight={50}         // Мінімальна висота 50px
  containerPadding={24}  // Менший padding
>
  {/* children */}
</CustomGridLayout>
```

## Як це працює

### Drag & Drop
- Перетягування за верхню панель (drag handle)
- Крок переміщення: 1px по вертикалі, 1 колонка по горизонталі
- Автоматичне оновлення позицій нижніх блоків

### Resize
- **Нижній край** - зміна тільки висоти
- **Правий край** - зміна тільки ширини
- **Нижній правий кут** - зміна висоти і ширини одночасно
- Мінімальна висота: 20px (або значення `minHeight`)
- Мінімальна ширина: 1 колонка

### Автоматичне позиціонування
- При зміні висоти блоку нижні блоки автоматично зміщуються вниз
- При зменшенні висоти блоки повертаються на попередні позиції
- Працює для блоків, що перекриваються по горизонталі

### ResizeObserver
- Автоматично відстежує зміни висоти контенту
- Оновлює висоту блоку при розгортанні/скриванні списків
- Поріг зміни: 5px (щоб уникнути постійних оновлень)

### Збереження стану
- Позиції зберігаються в `localStorage` під ключем `storageKey`
- Версія зберігається під ключем `${storageKey}-version`
- При зміні `layoutVersion` старий layout автоматично очищається

## Версіонування layout

При зміні структури layout (додавання/видалення блоків, зміна дефолтних розмірів) збільште `layoutVersion`:

```tsx
// Було
layoutVersion="1"

// Стало (після змін)
layoutVersion="2"
```

Це автоматично очистить старий layout з localStorage і застосує нові дефолтні значення.

## Скидання layout вручну

Якщо потрібно скинути layout вручну:

1. Відкрийте консоль браузера (F12)
2. Виконайте:
```javascript
localStorage.removeItem('your-storage-key');
localStorage.removeItem('your-storage-key-version');
location.reload();
```

## Приклади з реальних проектів

### Finance Report Dashboard
- Файл: `web/app/admin/finance-report/CustomGridLayout.tsx`
- Storage key: `finance-report-dashboard-layout`
- 5 блоків з фінансовою інформацією

### Photo Reports Dashboard
- Файл: `web/app/admin/photo-reports/CustomGridLayout.tsx`
- Storage key: `photo-reports-dashboard-layout`
- 3 блоки з аналітикою та тестуванням

## Міграція з локальних компонентів

Якщо у вас вже є локальний `CustomGridLayout`, замініть його на імпорт:

```tsx
// Було
import { CustomGridLayout } from "./CustomGridLayout";

// Стало
import { CustomGridLayout, LayoutItem } from "@/components/admin/CustomGridLayout";
```

## Обмеження

- Компонент використовує `position: absolute`, тому контейнер має мати `position: relative`
- ResizeObserver може не працювати в старих браузерах (потрібен поліфіл)
- При дуже швидких змінах може бути невелика затримка оновлення позицій

## Підтримка

При виникненні проблем або питань створіть issue в репозиторії або зверніться до команди розробки.

