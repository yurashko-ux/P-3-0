"use client";

import { useState, useEffect, ReactNode } from "react";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const STORAGE_KEY = "finance-report-dashboard-layout";
const LAYOUT_VERSION = "5"; // Збільшуємо версію для скидання старих layout

// Дефолтні позиції блоків (h тепер в одиницях по 2px - мінімальні висоти)
// Висоти встановлені мінімальними для компактного відображення
// h=50 означає 50*2px = 100px висоти
const defaultLayout: LayoutItem[] = [
  { i: "block-1", x: 0, y: 0, w: 6, h: 50 },   // 100px
  { i: "block-2", x: 6, y: 0, w: 6, h: 50 },   // 100px
  { i: "block-3", x: 0, y: 50, w: 6, h: 40 },  // 80px
  { i: "block-4", x: 6, y: 50, w: 6, h: 40 },  // 80px
  { i: "block-5", x: 0, y: 90, w: 12, h: 30 },  // 60px
];

type FinanceReportGridProps = {
  children: {
    block1: ReactNode;
    block2: ReactNode;
    block3: ReactNode;
    block4: ReactNode;
    block5: ReactNode;
  };
};

export function FinanceReportGrid({ children }: FinanceReportGridProps) {
  const [layout, setLayout] = useState<LayoutItem[]>(defaultLayout);
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    // Перевіряємо версію layout і очищаємо якщо стара
    const savedVersion = localStorage.getItem(`${STORAGE_KEY}-version`);
    if (savedVersion !== LAYOUT_VERSION) {
      // Очищаємо всі старі дані
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(`${STORAGE_KEY}-version`, LAYOUT_VERSION);
      console.log('[FinanceReportGrid] Layout version changed, resetting to defaults');
      setLayout(defaultLayout);
      return;
    }

    // Завантажуємо збережені позиції блоків
    const savedLayout = localStorage.getItem(STORAGE_KEY);
    if (savedLayout) {
      try {
        const parsed = JSON.parse(savedLayout);
        // Перевіряємо чи layout має правильну структуру
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLayout(parsed);
        } else {
          console.log('[FinanceReportGrid] Invalid layout structure, using defaults');
          setLayout(defaultLayout);
        }
      } catch (e) {
        console.error("Failed to parse saved layout:", e);
        setLayout(defaultLayout);
      }
    } else {
      setLayout(defaultLayout);
    }

    // Встановлюємо ширину контейнера
    const updateWidth = () => {
      const container = document.querySelector('main, .finance-report-container');
      if (container) {
        setContainerWidth(container.clientWidth - 48); // віднімаємо padding
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const handleLayoutChange = (layout: any) => {
    setLayout(layout);
    // Зберігаємо позиції в localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  };

  const handleResize = (layout: any) => {
    // Під час зміни розміру оновлюємо layout для плавного пересування
    setLayout(layout);
  };

  const handleResizeStop = (layout: any) => {
    // Після завершення зміни розміру зберігаємо точні значення
    setLayout(layout);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  };

  return (
    <GridLayout
      className="layout"
      layout={layout}
      onLayoutChange={handleLayoutChange}
      onResize={handleResize}
      onResizeStop={handleResizeStop}
      {...({ 
        cols: 12, 
        rowHeight: 2, // Мінімальний крок 2px для плавного пересування 
        width: containerWidth, 
        isDraggable: true, 
        isResizable: true, 
        draggableHandle: ".drag-handle", 
        margin: [16, 16], 
        compactType: null, 
        preventCollision: false,
        resizeHandles: ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne'],
        transformScale: 1
      } as any)}
    >
      <div key="block-1">{children.block1}</div>
      <div key="block-2">{children.block2}</div>
      <div key="block-3">{children.block3}</div>
      <div key="block-4">{children.block4}</div>
      <div key="block-5">{children.block5}</div>
    </GridLayout>
  );
}

