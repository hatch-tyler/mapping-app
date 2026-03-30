import { useRef } from 'react';
import type { LayoutElement } from '@/api/templates';
import { ELEMENT_LABELS, ELEMENT_ICONS } from './canvasUtils';

interface Props {
  elements: LayoutElement[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDelete: (index: number) => void;
}

export function ElementList({ elements, selectedIndex, onSelect, onReorder, onDelete }: Props) {
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
