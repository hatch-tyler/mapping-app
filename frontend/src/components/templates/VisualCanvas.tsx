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
  const [autoScale, setAutoScale] = useState(1);
  const [userZoom, setUserZoom] = useState<number | null>(null);

  const scale = userZoom ?? autoScale;

  // Compute auto-fit scale
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
      setAutoScale(Math.max(0.1, s));
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [pageWidth, pageHeight]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.canvas) {
      onSelectElement(null);
    }
  }, [onSelectElement]);

  const zoomIn = () => setUserZoom(Math.min((userZoom ?? autoScale) + 0.15, 4));
  const zoomOut = () => setUserZoom(Math.max((userZoom ?? autoScale) - 0.15, 0.2));
  const zoomFit = () => setUserZoom(null);

  const paperW = pageWidth * scale;
  const paperH = pageHeight * scale;
  const zoomPct = Math.round(scale * 100);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 bg-gray-200 overflow-auto flex items-center justify-center p-5"
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

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white rounded-lg shadow border border-gray-200 px-1 py-0.5 z-20">
        <button
          onClick={zoomOut}
          className="p-1 text-gray-600 hover:bg-gray-100 rounded"
          title="Zoom out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <span className="text-xs text-gray-600 w-10 text-center font-mono">{zoomPct}%</span>
        <button
          onClick={zoomIn}
          className="p-1 text-gray-600 hover:bg-gray-100 rounded"
          title="Zoom in"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={zoomFit}
          className="px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-100 rounded font-medium"
          title="Fit to window"
        >
          Fit
        </button>
      </div>
    </div>
  );
}
