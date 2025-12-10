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
  const [resizeDirection, setResizeDirection] = useState<'height' | 'width' | 'both' | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<Record<string, HTMLDivElement>>({});

  const COL_WIDTH = containerWidth / 12; // Ширина однієї колонки

  const updateLayoutPositions = useCallback((updatedLayout: LayoutItem[]) => {
    // Сортуємо блоки по y позиції
    const sorted = [...updatedLayout].sort((a, b) => a.y - b.y);
    const newLayout: LayoutItem[] = [];
    
    sorted.forEach((block, index) => {
      if (index === 0) {
        newLayout.push(block);
      } else {
        // Знаходимо найбільшу нижню точку попередніх блоків в цьому стовпці
        const prevBlocks = newLayout.filter(b => {
          // Перевіряємо чи блоки перекриваються по x
          const blockRight = block.x + block.w;
          const prevRight = b.x + b.w;
          return !(blockRight <= b.x || block.x >= prevRight);
        });
        
        if (prevBlocks.length > 0) {
          const maxBottom = Math.max(...prevBlocks.map(b => b.y + b.h));
          const newY = Math.max(block.y, maxBottom);
          newLayout.push({ ...block, y: newY });
        } else {
          newLayout.push(block);
        }
      }
    });
    
    return newLayout;
  }, []);

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

  const handleMouseDown = (e: React.MouseEvent, blockId: string, type: 'drag' | 'resize-height' | 'resize-width' | 'resize-both') => {
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
      setResizeDirection(type === 'resize-height' ? 'height' : type === 'resize-width' ? 'width' : 'both');
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

  // Відстежуємо зміни висоти блоків через ResizeObserver
  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      setLayout(currentLayout => {
        let updated = [...currentLayout];
        let hasChanges = false;
        
        entries.forEach(entry => {
          const blockId = Object.keys(blockRefs.current).find(
            id => blockRefs.current[id] === entry.target
          );
          if (!blockId) return;
          
          const block = updated.find(b => b.i === blockId);
          if (!block) return;
          
          // Отримуємо реальну висоту контенту (без padding)
          const contentHeight = entry.contentRect.height;
          const minHeight = 20;
          const newHeight = Math.max(minHeight, contentHeight + 24); // +24 для padding
          
          if (Math.abs(block.h - newHeight) > 5) { // Поріг 5px щоб уникнути постійних оновлень
            const blockIndex = updated.findIndex(b => b.i === blockId);
            updated[blockIndex] = { ...block, h: newHeight };
            hasChanges = true;
          }
        });
        
        if (hasChanges) {
          // Оновлюємо позиції нижніх блоків
          updated = updateLayoutPositions(updated);
          // Зберігаємо новий layout
          setTimeout(() => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          }, 100);
          return updated;
        }
        
        return currentLayout;
      });
    });
    
    // Спостерігаємо за всіма блоками
    const observeBlocks = () => {
      Object.values(blockRefs.current).forEach(el => {
        if (el) resizeObserver.observe(el);
      });
    };
    
    // Спостереження після рендеру
    const timeoutId = setTimeout(observeBlocks, 100);
    
    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [layout, updateLayoutPositions]);

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
        
        let newLayout = currentLayout.map(b => 
          b.i === isDragging 
            ? { ...b, x: Math.min(newX, 12 - b.w), y: newY }
            : b
        );
        // Оновлюємо позиції нижніх блоків
        newLayout = updateLayoutPositions(newLayout);
        setLayout(newLayout);
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;
        
        let newLayout = currentLayout.map(b => {
          if (b.i !== isResizing) return b;
          
          const updated = { ...b };
          
          if (resizeDirection === 'height' || resizeDirection === 'both') {
            updated.h = Math.max(20, resizeStart.h + deltaY);
          }
          
          if (resizeDirection === 'width' || resizeDirection === 'both') {
            const deltaW = Math.floor(deltaX / COL_WIDTH);
            updated.w = Math.max(1, Math.min(12 - updated.x, resizeStart.w + deltaW));
          }
          
          return updated;
        });
        
        // Оновлюємо позиції нижніх блоків при зміні висоти
        if (resizeDirection === 'height' || resizeDirection === 'both') {
          newLayout = updateLayoutPositions(newLayout);
        }
        
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
      setResizeDirection(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, resizeDirection, dragStart, resizeStart, COL_WIDTH, saveLayout, updateLayoutPositions]);

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

            {/* Resize handles */}
            {/* Bottom-right (both) */}
            <div
              className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-10"
              onMouseDown={(e) => handleMouseDown(e, block.i, 'resize-both')}
              style={{
                background: 'linear-gradient(-45deg, transparent 30%, rgba(59, 130, 246, 0.3) 30%, rgba(59, 130, 246, 0.3) 50%, transparent 50%)',
              }}
            />
            {/* Bottom (height only) */}
            <div
              className="absolute bottom-0 left-0 right-0 h-3 cursor-s-resize z-10"
              onMouseDown={(e) => handleMouseDown(e, block.i, 'resize-height')}
              style={{
                background: 'linear-gradient(to bottom, transparent, rgba(59, 130, 246, 0.2))',
              }}
            />
            {/* Right (width only) */}
            <div
              className="absolute top-0 bottom-0 right-0 w-3 cursor-e-resize z-10"
              onMouseDown={(e) => handleMouseDown(e, block.i, 'resize-width')}
              style={{
                background: 'linear-gradient(to right, transparent, rgba(59, 130, 246, 0.2))',
              }}
            />

            {/* Content */}
            <div 
              ref={(el) => {
                if (el) blockRefs.current[block.i] = el;
              }}
              className="h-full pt-6 overflow-auto"
              style={{ minHeight: '100%' }}
            >
              {child}
            </div>
          </div>
        );
      })}
    </div>
  );
}

