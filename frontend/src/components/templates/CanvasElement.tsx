import { useRef, useCallback } from 'react';
import type { LayoutElement } from '@/api/templates';
import { MIN_ELEMENT_SIZE, clampPosition, snapToGrid, ELEMENT_LABELS } from './canvasUtils';

interface Props {
  element: LayoutElement;
  index: number;
  scale: number;
  isSelected: boolean;
  pageW: number;
  pageH: number;
  enableSnap: boolean;
  gridSize: number;
  onSelect: () => void;
  onUpdate: (updates: Partial<LayoutElement>) => void;
}

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_CURSORS: Record<HandleDir, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

export function CanvasElement({ element, index, scale, isSelected, pageW, pageH, enableSnap, gridSize, onSelect, onUpdate }: Props) {
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; origX: number; origY: number; origW: number; origH: number; handle: HandleDir } | null>(null);

  const applySnap = useCallback((v: number) => enableSnap ? snapToGrid(v, gridSize) : v, [enableSnap, gridSize]);

  const isLocked = element.locked ?? false;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isLocked) return;
    if ((e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: element.x, origY: element.y };
  }, [element.x, element.y, onSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragState.current) {
      const dx = (e.clientX - dragState.current.startX) / scale;
      const dy = (e.clientY - dragState.current.startY) / scale;
      let newX = applySnap(dragState.current.origX + dx);
      let newY = applySnap(dragState.current.origY + dy);
      const clamped = clampPosition(newX, newY, element.w, element.h, pageW, pageH);
      newX = clamped.x;
      newY = clamped.y;
      onUpdate({ x: newX, y: newY });
    }
    if (resizeState.current) {
      const rs = resizeState.current;
      const dx = (e.clientX - rs.startX) / scale;
      const dy = (e.clientY - rs.startY) / scale;
      let { origX: x, origY: y, origW: w, origH: h } = rs;

      if (rs.handle.includes('e')) w = Math.max(MIN_ELEMENT_SIZE.w, applySnap(rs.origW + dx));
      if (rs.handle.includes('w')) { const nw = Math.max(MIN_ELEMENT_SIZE.w, applySnap(rs.origW - dx)); x = rs.origX + (rs.origW - nw); w = nw; }
      if (rs.handle.includes('s')) h = Math.max(MIN_ELEMENT_SIZE.h, applySnap(rs.origH + dy));
      if (rs.handle.includes('n')) { const nh = Math.max(MIN_ELEMENT_SIZE.h, applySnap(rs.origH - dy)); y = rs.origY + (rs.origH - nh); h = nh; }

      const clamped = clampPosition(x, y, w, h, pageW, pageH);
      onUpdate({ x: clamped.x, y: clamped.y, w, h });
    }
  }, [scale, applySnap, element.w, element.h, pageW, pageH, onUpdate]);

  const handlePointerUp = useCallback(() => {
    dragState.current = null;
    resizeState.current = null;
  }, []);

  const handleResizePointerDown = useCallback((e: React.PointerEvent, handle: HandleDir) => {
    if (isLocked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeState.current = {
      startX: e.clientX, startY: e.clientY,
      origX: element.x, origY: element.y, origW: element.w, origH: element.h,
      handle,
    };
  }, [element.x, element.y, element.w, element.h, onSelect]);

  const renderContent = () => {
    const { type } = element;

    if (type === 'map_frame') {
      const borderColor = element.strokeColor || '#9ca3af';
      const borderWidth = Math.max(1, (element.strokeWidth || 1) * scale);
      return (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center"
          style={{
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(0,0,0,0.03) 8px, rgba(0,0,0,0.03) 16px)',
            border: `${borderWidth}px solid ${borderColor}`,
            boxSizing: 'border-box',
          }}>
          <div className="text-center">
            <svg className="w-8 h-8 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span className="text-[10px] text-gray-400 font-medium">Map Frame</span>
          </div>
        </div>
      );
    }

    if (type === 'title' || type === 'subtitle' || type === 'text') {
      const defaultFontSize = type === 'title' ? 24 : type === 'subtitle' ? 16 : 12;
      const defaultFontWeight = type === 'title' ? 'bold' : 'normal';
      const defaultAlign = type === 'text' ? 'left' : 'center';
      const defaultText = type === 'title' ? 'Map Title' : type === 'subtitle' ? 'Subtitle' : 'Text';

      const fontSize = Math.max(6, Math.min(32, (element.fontSize || defaultFontSize) * scale * 0.6));
      const fontWeight = element.fontWeight || defaultFontWeight;
      const textAlign = element.textAlign || defaultAlign;
      const fontFamily = element.fontFamily || 'Arial, sans-serif';
      const textColor = element.textColor || '#1f2937';
      const justifyMap = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

      return (
        <div
          className="w-full h-full flex items-start px-1 overflow-hidden"
          style={{ justifyContent: justifyMap[textAlign], textAlign }}
        >
          <span
            className="w-full"
            style={{ fontSize: `${fontSize}px`, fontWeight, fontFamily, color: textColor, whiteSpace: 'pre-wrap', lineHeight: 1.3 }}
          >
            {element.text || defaultText}
          </span>
        </div>
      );
    }

    if (type === 'shape') {
      const fillColor = element.fillColor || 'transparent';
      const strokeColor = element.strokeColor || '#000000';
      const strokeWidth = (element.strokeWidth || 1) * scale;
      return (
        <div
          className="w-full h-full"
          style={{
            backgroundColor: fillColor,
            border: `${Math.max(1, strokeWidth)}px solid ${strokeColor}`,
            boxSizing: 'border-box',
          }}
        />
      );
    }

    if (type === 'legend') {
      return (
        <div className="w-full h-full bg-amber-50 border border-amber-200 p-1 flex flex-col">
          <span className="text-[8px] font-semibold text-gray-700 mb-0.5">Legend</span>
          <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
            {['#ef4444', '#3b82f6', '#22c55e'].map((c) => (
              <div key={c} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: c }} />
                <div className="h-1.5 bg-gray-200 rounded flex-1" />
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (type === 'scale_bar') {
      return (
        <div className="w-full h-full flex items-center justify-center p-1">
          <svg viewBox="0 0 120 30" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
            <rect x="10" y="8" width="20" height="8" fill="black" />
            <rect x="30" y="8" width="20" height="8" fill="white" stroke="black" strokeWidth="0.5" />
            <rect x="50" y="8" width="20" height="8" fill="black" />
            <rect x="70" y="8" width="20" height="8" fill="white" stroke="black" strokeWidth="0.5" />
            <text x="10" y="26" fontSize="7" fill="black">0</text>
            <text x="90" y="26" fontSize="7" fill="black" textAnchor="end">{element.units || 'ft'}</text>
          </svg>
        </div>
      );
    }

    if (type === 'north_arrow') {
      return (
        <div className="w-full h-full flex items-center justify-center p-1">
          <svg viewBox="0 0 40 60" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
            <polygon points="20,2 28,40 20,34 12,40" fill="black" />
            <polygon points="20,2 20,34 12,40" fill="black" />
            <polygon points="20,2 20,34 28,40" fill="white" stroke="black" strokeWidth="0.5" />
            <text x="20" y="56" textAnchor="middle" fontSize="12" fontWeight="bold" fill="black">N</text>
          </svg>
        </div>
      );
    }

    if (type === 'logo' || type === 'image') {
      if (element.imageData) {
        return (
          <img
            src={element.imageData}
            alt={element.text || 'Logo'}
            className="w-full h-full object-contain"
            draggable={false}
          />
        );
      }
      return (
        <div
          className="w-full h-full border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/svg+xml';
            input.onchange = (ev) => {
              const file = (ev.target as HTMLInputElement).files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                onUpdate({ imageData: reader.result as string });
              };
              reader.readAsDataURL(file);
            };
            input.click();
          }}
        >
          <div className="text-center">
            <svg className="w-5 h-5 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-[7px] text-gray-400">Click to add image</span>
          </div>
        </div>
      );
    }

    if (type === 'horizontal_rule') {
      return (
        <div className="w-full h-full flex items-center">
          <div className="w-full" style={{ height: `${Math.max(1, (element.thickness || 0.5) * scale)}px`, backgroundColor: element.color || '#000000' }} />
        </div>
      );
    }

    if (type === 'header_decorator' || type === 'footer_decorator') {
      return (
        <div className="w-full h-full" style={{ backgroundColor: element.color || '#1e40af' }}>
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[8px] text-white font-medium opacity-70">
              {type === 'header_decorator' ? 'Header' : 'Footer'}
            </span>
          </div>
        </div>
      );
    }

    if (type === 'graticule') {
      const gridColor = element.gridColor || '#666666';
      return (
        <div className="w-full h-full relative overflow-hidden" style={{ border: `1px solid ${gridColor}` }}>
          <svg className="absolute inset-0 w-full h-full">
            {[0.25, 0.5, 0.75].map((f) => (
              <g key={f}>
                <line x1={`${f * 100}%`} y1="0" x2={`${f * 100}%`} y2="100%" stroke={gridColor} strokeWidth="0.5" strokeDasharray="4 2" />
                <line x1="0" y1={`${f * 100}%`} x2="100%" y2={`${f * 100}%`} stroke={gridColor} strokeWidth="0.5" strokeDasharray="4 2" />
              </g>
            ))}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[8px] text-gray-500 bg-white/80 px-1 rounded">Grid</span>
          </div>
        </div>
      );
    }

    if (type === 'inset_map') {
      return (
        <div className="w-full h-full bg-gray-50 flex items-center justify-center"
          style={{ border: `${Math.max(1, (element.strokeWidth || 1) * scale)}px solid ${element.strokeColor || '#000'}` }}>
          <div className="text-center">
            <svg className="w-5 h-5 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
            <span className="text-[8px] text-gray-400 font-medium">Inset Map</span>
          </div>
        </div>
      );
    }

    if (type === 'table') {
      const rows = element.tableRows || 3;
      const cols = element.tableCols || 3;
      const tableColor = element.strokeColor || '#000000';
      const fs = Math.max(6, (element.fontSize || 9) * scale * 0.5);
      return (
        <div className="w-full h-full overflow-hidden" style={{ border: `1px solid ${tableColor}` }}>
          <table className="w-full h-full border-collapse" style={{ fontSize: `${fs}px` }}>
            <tbody>
              {Array.from({ length: Math.min(rows, 8) }).map((_, r) => (
                <tr key={r}>
                  {Array.from({ length: Math.min(cols, 6) }).map((_, c) => (
                    <td key={c} className="border px-0.5" style={{ borderColor: tableColor, color: '#374151', fontWeight: r === 0 ? 'bold' : 'normal', backgroundColor: r === 0 ? '#f3f4f6' : 'white' }}>
                      {element.tableData?.[r]?.[c] || (r === 0 ? `Col ${c + 1}` : '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return <div className="w-full h-full bg-gray-100 flex items-center justify-center text-[8px] text-gray-400">{ELEMENT_LABELS[type]}</div>;
  };

  const handles: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const handlePositions: Record<HandleDir, React.CSSProperties> = {
    nw: { top: -4, left: -4 },
    n: { top: -4, left: '50%', marginLeft: -4 },
    ne: { top: -4, right: -4 },
    e: { top: '50%', right: -4, marginTop: -4 },
    se: { bottom: -4, right: -4 },
    s: { bottom: -4, left: '50%', marginLeft: -4 },
    sw: { bottom: -4, left: -4 },
    w: { top: '50%', left: -4, marginTop: -4 },
  };

  return (
    <div
      data-element-index={index}
      className={`absolute select-none ${isSelected ? 'ring-2 ring-blue-500 z-20' : element.type === 'map_frame' ? 'z-0 hover:ring-1 hover:ring-blue-300' : 'z-10 hover:ring-1 hover:ring-blue-300'}`}
      style={{
        left: element.x * scale,
        top: element.y * scale,
        width: element.w * scale,
        height: element.h * scale,
        cursor: isLocked ? 'default' : 'move',
        opacity: (element.opacity ?? 100) / 100,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {renderContent()}

      {isLocked && isSelected && (
        <div className="absolute top-0 right-0 bg-gray-800 text-white rounded-bl px-1 py-0.5 text-[7px] font-medium">
          Locked
        </div>
      )}
      {isSelected && !isLocked && handles.map((dir) => (
        <div
          key={dir}
          data-handle={dir}
          className="absolute w-2 h-2 bg-white border-2 border-blue-500 rounded-sm"
          style={{ ...handlePositions[dir], cursor: HANDLE_CURSORS[dir] }}
          onPointerDown={(e) => handleResizePointerDown(e, dir)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      ))}
    </div>
  );
}
