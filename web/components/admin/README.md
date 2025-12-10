# Admin Components

Ця директорія містить перевикористовувані компоненти для адмін-панелей.

## CustomGridLayout

Універсальний компонент для створення переміщуваних та змінюваних блоків в адмін-панелях.

📖 **Повна документація:** [../../docs/admin-grid-layout.md](../../docs/admin-grid-layout.md)

### Швидкий старт

```tsx
import { CustomGridLayout, LayoutItem } from "@/components/admin/CustomGridLayout";

const defaultLayout: LayoutItem[] = [
  { i: "block-1", x: 0, y: 0, w: 6, h: 100 },
  { i: "block-2", x: 6, y: 0, w: 6, h: 100 },
];

<CustomGridLayout
  storageKey="my-dashboard-layout"
  layoutVersion="1"
  defaultLayout={defaultLayout}
>
  {{
    "block-1": <div>Content 1</div>,
    "block-2": <div>Content 2</div>,
  }}
</CustomGridLayout>
```

### Особливості

- ✅ Drag & Drop з кроком 1px
- ✅ Resize по висоті, ширині або обох напрямках
- ✅ Автоматичне зміщення нижніх блоків
- ✅ Автоматичне оновлення висоти при зміні контенту
- ✅ Збереження позицій в localStorage

### Приклади використання

- `web/app/admin/finance-report/` - Фінансовий звіт
- `web/app/admin/photo-reports/` - Фото-звіти

