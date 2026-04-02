import { useRef } from 'react';
import type { LayoutElement } from '@/api/templates';
import { ELEMENT_LABELS, ELEMENT_ICONS } from './canvasUtils';

interface Props {
  elements: LayoutElement[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDelete: (index: number) => void;
  onDuplicate?: (index: number) => void;
}

export function ElementList({ elements, selectedIndex, onSelect, onReorder, onDelete, onDuplicate }: Props) {
  const dragIndex = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragIndex.current !== null && dragIndex.current !== targetIndex) {
      onReorder(dragIndex.current, targetIndex);
    }
    dragIndex.current = null;
  };

  if (elements.length === 0) {
    return (
      <div className="px-3 py-4 text-center">
        <p className="text-[10px] text-gray-400 italic">No elements added</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {elements.map((elem, idx) => (
        <div
          key={idx}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, idx)}
          onClick={() => onSelect(idx)}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs group ${
            selectedIndex === idx
              ? 'bg-blue-50 border border-blue-200 text-blue-700'
              : 'hover:bg-gray-50 text-gray-700'
          }`}
        >
          <svg className="w-3.5 h-3.5 text-gray-400 cursor-grab shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
          </svg>
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d={ELEMENT_ICONS[elem.type]} />
          </svg>
          <span className="flex-1 truncate text-[11px]">
            {elem.type === 'title' || elem.type === 'subtitle' || elem.type === 'text'
              ? (elem.text || ELEMENT_LABELS[elem.type])
              : ELEMENT_LABELS[elem.type]}
          </span>
          {elem.locked && (
            <svg className="w-2.5 h-2.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          )}
          {/* Z-order controls */}
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
            {idx > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); onReorder(idx, idx - 1); }}
                className="text-gray-400 hover:text-blue-600"
                title="Move up (bring forward)"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M5 15l7-7 7 7" />
                </svg>
              </button>
            )}
            {idx < elements.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); onReorder(idx, idx + 1); }}
                className="text-gray-400 hover:text-blue-600"
                title="Move down (send backward)"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
            {onDuplicate && (
              <button
                onClick={(e) => { e.stopPropagation(); onDuplicate(idx); }}
                className="text-gray-400 hover:text-green-600"
                title="Duplicate element"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(idx); }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 shrink-0"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
