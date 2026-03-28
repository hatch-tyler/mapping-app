import { useRef, useState, useEffect, useCallback } from 'react';
import type { LayoutElement } from '@/api/templates';
import { CanvasElement } from './CanvasElement';

interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Props {
  pageWidth: number;
  pageHeight: number;
  elements: LayoutElement[];
  selectedIndex: number | null;
  margins: Margins;
  enableSnap: boolean;
  gridSize: number;
  onSelectElement: (index: number | null) => void;
  onUpdateElement: (index: number, updates: Partial<LayoutElement>) => void;
}

export function VisualCanvas({
  pageWidth, pageHeight, elements, selectedIndex, margins,
  enableSnap, gridSize, onSelectElement, onUpdateElement,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Compute scale to fit page in container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: cw, height: ch } = entry.contentRect;
      const padding = 40;
      const availW = cw - padding;
      const availH = ch - padding;
      const s = Math.min(availW / pageWidth, availH / pageHeight, 3);
      setScale(Math.max(0.1, s));
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [pageWidth, pageHeight]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    // Deselect if clicking on the page background
    if ((e.target as HTMLElement).dataset.canvas) {
      onSelectElement(null);
    }
  }, [onSelectElement]);

  const paperW = pageWidth * scale;
  const paperH = pageHeight * scale;

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-gray-200 overflow-auto flex items-center justify-center p-5"
      style={{ minHeight: 0 }}
    >
      <div
        data-canvas="true"
        className="relative bg-white shadow-lg"
        style={{ width: paperW, height: paperH, flexShrink: 0 }}
        onClick={handleCanvasClick}
      >
        {/* Margin guides */}
        <div
          className="absolute border border-dashed border-blue-200 pointer-events-none"
          style={{
            left: margins.left * scale,
            top: margins.top * scale,
            width: (pageWidth - margins.left - margins.right) * scale,
            height: (pageHeight - margins.top - margins.bottom) * scale,
          }}
        />

        {/* Grid dots */}
        {enableSnap && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width={paperW}
            height={paperH}
          >
            <defs>
              <pattern
                id="grid-dots"
                width={gridSize * scale}
                height={gridSize * scale}
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="0.5" fill="rgba(0,0,0,0.1)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-dots)" />
          </svg>
        )}

        {/* Elements */}
        {elements.map((elem, idx) => (
          <CanvasElement
            key={idx}
            element={elem}
            index={idx}
            scale={scale}
            isSelected={selectedIndex === idx}
            pageW={pageWidth}
            pageH={pageHeight}
            enableSnap={enableSnap}
            gridSize={gridSize}
            onSelect={() => onSelectElement(idx)}
            onUpdate={(updates) => onUpdateElement(idx, updates)}
          />
        ))}
      </div>
    </div>
  );
}
