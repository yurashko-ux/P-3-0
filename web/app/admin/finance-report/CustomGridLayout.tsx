"use client";

import { useState, useEffect, ReactNode, useRef, useCallback } from "react";

type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const STORAGE_KEY = "finance-report-dashboard-layout";
const LAYOUT_VERSION = "6";

// Дефолтні позиції блоків (в пікселях)
const defaultLayout: LayoutItem[] = [
  { i: "block-1", x: 0, y: 0, w: 6, h: 100 },
  { i: "block-2", x: 6, y: 0, w: 6, h: 100 },
  { i: "block-3", x: 0, y: 100, w: 6, h: 80 },
  { i: "block-4", x: 6, y: 100, w: 6, h: 80 },
  { i: "block-5", x: 0, y: 180, w: 12, h: 60 },
];

type CustomGridLayoutProps = {
  children: {
    block1: ReactNode;
    block2: ReactNode;
    block3: ReactNode;
    block4: ReactNode;
    block5: ReactNode;
  };
};

export function CustomGridLayout({ children }: CustomGridLayoutProps) {
  const [layout, setLayout] = useState<LayoutItem[]>(defaultLayout);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const COL_WIDTH = containerWidth / 12; // Ширина однієї колонки

  useEffect(() => {
    // Перевіряємо версію layout
    const savedVersion = localStorage.getItem(`${STORAGE_KEY}-version`);
    if (savedVersion !== LAYOUT_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(`${STORAGE_KEY}-version`, LAYOUT_VERSION);
      setLayout(defaultLayout);
      return;
    }

    const savedLayout = localStorage.getItem(STORAGE_KEY);
    if (savedLayout) {
      try {
        const parsed = JSON.parse(savedLayout);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLayout(parsed);
        } else {
          setLayout(defaultLayout);
        }
      } catch (e) {
        setLayout(defaultLayout);
      }
    } else {
      setLayout(defaultLayout);
    }

    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth - 48);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const saveLayout = useCallback((newLayout: LayoutItem[]) => {
    setLayout(newLayout);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout));
  }, []);

  const handleMouseDown = (e: React.MouseEvent, blockId: string, type: 'drag' | 'resize') => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const block = layoutRef.current.find(b => b.i === blockId);
    if (!block) return;

    if (type === 'drag') {
      setIsDragging(blockId);
      const blockRect = {
        left: block.x * COL_WIDTH,
        top: block.y
      };
      setDragStart({
        x: e.clientX - rect.left - blockRect.left,
        y: e.clientY - rect.top - blockRect.top
      });
    } else {
      setIsResizing(blockId);
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        w: block.w,
        h: block.h
      });
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const currentLayout = layoutRef.current;
      const block = currentLayout.find(b => b.i === (isDragging || isResizing)!);
      if (!block) return;

      if (isDragging) {
        const newX = Math.max(0, Math.floor((e.clientX - rect.left - dragStart.x) / COL_WIDTH));
        const newY = Math.max(0, e.clientY - rect.top - dragStart.y); // Прямо в пікселях, крок 1px
        
        const newLayout = currentLayout.map(b => 
          b.i === isDragging 
            ? { ...b, x: Math.min(newX, 12 - b.w), y: newY }
            : b
        );
        setLayout(newLayout);
      } else if (isResizing) {
        const deltaY = e.clientY - resizeStart.y;
        const newH = Math.max(20, resizeStart.h + deltaY); // Прямо в пікселях, крок 1px
        
        const newLayout = currentLayout.map(b => 
          b.i === isResizing 
            ? { ...b, h: newH }
            : b
        );
        setLayout(newLayout);
      }
    };

    const handleMouseUp = () => {
      const currentLayout = layoutRef.current;
      if (isDragging || isResizing) {
        saveLayout(currentLayout);
      }
      setIsDragging(null);
      setIsResizing(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragStart, resizeStart, COL_WIDTH, saveLayout]);

  return (
    <div 
      ref={containerRef}
      className="relative"
      style={{ width: '100%', minHeight: '100vh' }}
    >
      {layout.map((block) => {
        const child = {
          'block-1': children.block1,
          'block-2': children.block2,
          'block-3': children.block3,
          'block-4': children.block4,
          'block-5': children.block5,
        }[block.i];

        return (
          <div
            key={block.i}
            className="absolute"
            style={{
              left: `${block.x * COL_WIDTH}px`,
              top: `${block.y}px`,
              width: `${block.w * COL_WIDTH}px`,
              height: `${block.h}px`,
              zIndex: isDragging === block.i || isResizing === block.i ? 1000 : 1,
            }}
          >
            {/* Drag handle */}
            <div
              className="drag-handle absolute top-0 left-0 right-0 h-6 bg-blue-500 bg-opacity-10 cursor-move flex items-center justify-center text-xs text-gray-500 hover:bg-opacity-20 z-10"
              onMouseDown={(e) => handleMouseDown(e, block.i, 'drag')}
            >
              ⋮⋮ Перетягніть
            </div>

            {/* Resize handle */}
            <div
              className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-10"
              onMouseDown={(e) => handleMouseDown(e, block.i, 'resize')}
              style={{
                background: 'linear-gradient(-45deg, transparent 30%, rgba(59, 130, 246, 0.3) 30%, rgba(59, 130, 246, 0.3) 50%, transparent 50%)',
              }}
            />

            {/* Content */}
            <div className="h-full pt-6 overflow-auto">
              {child}
            </div>
          </div>
        );
      })}
    </div>
  );
}

