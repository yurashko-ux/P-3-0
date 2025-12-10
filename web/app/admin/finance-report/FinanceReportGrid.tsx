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
  minW?: number;
  minH?: number;
};

const STORAGE_KEY = "finance-report-dashboard-layout";

// Дефолтні позиції блоків
const defaultLayout: LayoutItem[] = [
  { i: "block-1", x: 0, y: 0, w: 6, h: 15, minW: 4, minH: 10 },
  { i: "block-2", x: 6, y: 0, w: 6, h: 15, minW: 4, minH: 10 },
  { i: "block-3", x: 0, y: 15, w: 6, h: 12, minW: 4, minH: 8 },
  { i: "block-4", x: 6, y: 15, w: 6, h: 12, minW: 4, minH: 8 },
  { i: "block-5", x: 0, y: 27, w: 12, h: 8, minW: 8, minH: 6 },
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
    // Завантажуємо збережені позиції блоків
    const savedLayout = localStorage.getItem(STORAGE_KEY);
    if (savedLayout) {
      try {
        const parsed = JSON.parse(savedLayout);
        setLayout(parsed);
      } catch (e) {
        console.error("Failed to parse saved layout:", e);
      }
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

  return (
    <GridLayout
      className="layout"
      layout={layout}
      onLayoutChange={handleLayoutChange}
      cols={12}
      rowHeight={30}
      width={containerWidth}
      isDraggable={true}
      isResizable={true}
      draggableHandle=".drag-handle"
      margin={[16, 16]}
    >
      <div key="block-1">{children.block1}</div>
      <div key="block-2">{children.block2}</div>
      <div key="block-3">{children.block3}</div>
      <div key="block-4">{children.block4}</div>
      <div key="block-5">{children.block5}</div>
    </GridLayout>
  );
}

