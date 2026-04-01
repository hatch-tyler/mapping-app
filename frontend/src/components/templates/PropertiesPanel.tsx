import { useState, useEffect } from 'react';
import type { LayoutElement, DisplayUnit } from '@/api/templates';
import { ELEMENT_LABELS, toDisplayUnits, fromDisplayUnits, PAGE_PRESETS, formatPageLabel } from './canvasUtils';
import type { PagePresetKey } from './canvasUtils';

interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Props {
  selectedElement: LayoutElement | null;
  selectedIndex: number | null;
  displayUnit: DisplayUnit;
  pagePreset: PagePresetKey;
  margins: Margins;
  enableSnap: boolean;
  gridSize: number;
  onUpdateElement: (index: number, updates: Partial<LayoutElement>) => void;
  onDeleteElement: (index: number) => void;
  onChangePagePreset: (preset: PagePresetKey) => void;
  onChangeMargins: (margins: Margins) => void;
  onChangeSnap: (enabled: boolean) => void;
  onChangeGridSize: (size: number) => void;
  onChangeDisplayUnit: (unit: DisplayUnit) => void;
}

function DimensionInput({ label, valueMm, unit, onChange }: {
  label: string;
  valueMm: number;
  unit: DisplayUnit;
  onChange: (mm: number) => void;
}) {
  const displayVal = toDisplayUnits(valueMm, unit);
  const formatted = parseFloat(displayVal.toFixed(unit === 'in' ? 3 : 1));
  const [localVal, setLocalVal] = useState(String(formatted));
  const [focused, setFocused] = useState(false);

  // Sync from prop when not focused
  useEffect(() => {
    if (!focused) setLocalVal(String(formatted));
  }, [formatted, focused]);

  return (
    <div>
      <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={localVal}
          onFocus={() => setFocused(true)}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={() => {
            setFocused(false);
            const parsed = parseFloat(localVal);
            if (!isNaN(parsed)) {
              onChange(fromDisplayUnits(parsed, unit));
            } else {
              setLocalVal(String(formatted));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <span className="text-[10px] text-gray-400 shrink-0">{unit}</span>
      </div>
    </div>
  );
}

export function PropertiesPanel({
  selectedElement, selectedIndex, displayUnit, pagePreset, margins,
  enableSnap, gridSize,
  onUpdateElement, onDeleteElement, onChangePagePreset, onChangeMargins,
  onChangeSnap, onChangeGridSize, onChangeDisplayUnit,
}: Props) {

  if (selectedElement && selectedIndex !== null) {
    return (
      <div className="w-56 border-l border-gray-200 bg-white p-3 overflow-y-auto flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-700">{ELEMENT_LABELS[selectedElement.type]}</h3>
          <button
            onClick={() => onDeleteElement(selectedIndex)}
            className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 rounded hover:bg-red-100"
          >
            Delete
          </button>
        </div>

        {/* Position */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 mb-1">Position</p>
          <div className="grid grid-cols-2 gap-1.5">
            <DimensionInput label="X" valueMm={selectedElement.x} unit={displayUnit}
              onChange={(v) => onUpdateElement(selectedIndex, { x: v })} />
            <DimensionInput label="Y" valueMm={selectedElement.y} unit={displayUnit}
              onChange={(v) => onUpdateElement(selectedIndex, { y: v })} />
          </div>
        </div>

        {/* Size */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 mb-1">Size</p>
          <div className="grid grid-cols-2 gap-1.5">
            <DimensionInput label="W" valueMm={selectedElement.w} unit={displayUnit}
              onChange={(v) => onUpdateElement(selectedIndex, { w: v })} />
            <DimensionInput label="H" valueMm={selectedElement.h} unit={displayUnit}
              onChange={(v) => onUpdateElement(selectedIndex, { h: v })} />
          </div>
        </div>

        {/* Type-specific properties */}
        {(selectedElement.type === 'title' || selectedElement.type === 'subtitle' || selectedElement.type === 'text') && (
          <div>
            <p className="text-[10px] font-semibold text-gray-500 mb-1">Text</p>
            <textarea
              value={selectedElement.text || ''}
              onChange={(e) => onUpdateElement(selectedIndex, { text: e.target.value })}
              rows={2}
              className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
            <div className="mt-1">
              <label className="block text-[10px] font-medium text-gray-500">Font Size</label>
              <input
                type="number"
                value={selectedElement.fontSize || (selectedElement.type === 'title' ? 24 : selectedElement.type === 'subtitle' ? 16 : 12)}
                onChange={(e) => onUpdateElement(selectedIndex, { fontSize: parseInt(e.target.value) || 12 })}
                className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="mt-1">
              <label className="block text-[10px] font-medium text-gray-500">Alignment</label>
              <div className="flex rounded overflow-hidden border border-gray-300 mt-0.5">
                {(['left', 'center', 'right'] as const).map((align) => {
                  const defaultAlign = selectedElement.type === 'text' ? 'left' : 'center';
                  const isActive = (selectedElement.textAlign || defaultAlign) === align;
                  return (
                    <button
                      key={align}
                      onClick={() => onUpdateElement(selectedIndex, { textAlign: align })}
                      className={`flex-1 px-2 py-1 text-xs font-medium ${
                        isActive ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                      title={`Align ${align}`}
                    >
                      <svg className="w-3 h-3 mx-auto" viewBox="0 0 16 16" fill="currentColor">
                        {align === 'left' && <><rect x="1" y="2" width="14" height="1.5" /><rect x="1" y="6" width="10" height="1.5" /><rect x="1" y="10" width="12" height="1.5" /><rect x="1" y="14" width="8" height="1.5" /></>}
                        {align === 'center' && <><rect x="1" y="2" width="14" height="1.5" /><rect x="3" y="6" width="10" height="1.5" /><rect x="2" y="10" width="12" height="1.5" /><rect x="4" y="14" width="8" height="1.5" /></>}
                        {align === 'right' && <><rect x="1" y="2" width="14" height="1.5" /><rect x="5" y="6" width="10" height="1.5" /><rect x="3" y="10" width="12" height="1.5" /><rect x="7" y="14" width="8" height="1.5" /></>}
                      </svg>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-1">
              <label className="block text-[10px] font-medium text-gray-500">Bold</label>
              {(() => {
                const defaultWeight = selectedElement.type === 'title' ? 'bold' : 'normal';
                const currentWeight = selectedElement.fontWeight || defaultWeight;
                return (
                  <button
                    onClick={() => onUpdateElement(selectedIndex, {
                      fontWeight: currentWeight === 'bold' ? 'normal' : 'bold'
                    })}
                    className={`px-2 py-1 text-xs font-bold border rounded mt-0.5 ${
                      currentWeight === 'bold'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    B
                  </button>
                );
              })()}
            </div>
          </div>
        )}

        {selectedElement.type === 'scale_bar' && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Units</label>
            <select
              value={selectedElement.units || 'feet'}
              onChange={(e) => onUpdateElement(selectedIndex, { units: e.target.value })}
              className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="feet">Feet</option>
              <option value="meters">Meters</option>
              <option value="miles">Miles</option>
              <option value="kilometers">Kilometers</option>
            </select>
          </div>
        )}

        {selectedElement.type === 'horizontal_rule' && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Thickness (pt)</label>
            <input
              type="number"
              step="0.5"
              value={selectedElement.thickness || 0.5}
              onChange={(e) => onUpdateElement(selectedIndex, { thickness: parseFloat(e.target.value) || 0.5 })}
              className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {(selectedElement.type === 'horizontal_rule' || selectedElement.type === 'header_decorator' || selectedElement.type === 'footer_decorator') && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={selectedElement.color || (selectedElement.type === 'horizontal_rule' ? '#000000' : '#1e40af')}
                onChange={(e) => onUpdateElement(selectedIndex, { color: e.target.value })}
                className="w-8 h-6 border border-gray-300 rounded cursor-pointer"
              />
              <span className="text-[10px] text-gray-400">{selectedElement.color || '#000000'}</span>
            </div>
          </div>
        )}

        {selectedElement.type === 'shape' && (
          <>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 mb-1">Fill Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selectedElement.fillColor === 'transparent' ? '#ffffff' : (selectedElement.fillColor || '#ffffff')}
                  onChange={(e) => onUpdateElement(selectedIndex, { fillColor: e.target.value })}
                  className="w-8 h-6 border border-gray-300 rounded cursor-pointer"
                />
                <label className="flex items-center gap-1 text-[10px] text-gray-500">
                  <input
                    type="checkbox"
                    checked={selectedElement.fillColor === 'transparent' || !selectedElement.fillColor}
                    onChange={(e) => onUpdateElement(selectedIndex, { fillColor: e.target.checked ? 'transparent' : '#ffffff' })}
                    className="w-3 h-3"
                  />
                  No fill
                </label>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 mb-1">Border Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selectedElement.strokeColor || '#000000'}
                  onChange={(e) => onUpdateElement(selectedIndex, { strokeColor: e.target.value })}
                  className="w-8 h-6 border border-gray-300 rounded cursor-pointer"
                />
                <span className="text-[10px] text-gray-400">{selectedElement.strokeColor || '#000000'}</span>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 mb-1">Border Width (pt)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={selectedElement.strokeWidth || 1}
                onChange={(e) => onUpdateElement(selectedIndex, { strokeWidth: parseFloat(e.target.value) || 1 })}
                className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {(selectedElement.type === 'title' || selectedElement.type === 'subtitle' || selectedElement.type === 'text') && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 mb-1">Text Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={selectedElement.textColor || '#1f2937'}
                onChange={(e) => onUpdateElement(selectedIndex, { textColor: e.target.value })}
                className="w-8 h-6 border border-gray-300 rounded cursor-pointer"
              />
              <span className="text-[10px] text-gray-400">{selectedElement.textColor || '#1f2937'}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Page settings (no element selected)
  return (
    <div className="w-56 border-l border-gray-200 bg-white p-3 overflow-y-auto flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-gray-700">Page Settings</h3>

      {/* Units */}
      <div>
        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Display Units</label>
        <div className="flex rounded overflow-hidden border border-gray-300">
          {(['in', 'mm'] as DisplayUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => onChangeDisplayUnit(u)}
              className={`flex-1 px-2 py-1 text-xs font-medium ${
                displayUnit === u ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {u === 'in' ? 'Inches' : 'Millimeters'}
            </button>
          ))}
        </div>
      </div>

      {/* Page Size */}
      <div>
        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Page Size</label>
        <select
          value={pagePreset}
          onChange={(e) => onChangePagePreset(e.target.value as PagePresetKey)}
          className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {Object.entries(PAGE_PRESETS).map(([key, preset]) => (
            <option key={key} value={key}>
              {preset.label} ({formatPageLabel(preset.width, preset.height, displayUnit)})
            </option>
          ))}
        </select>
      </div>

      {/* Margins */}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 mb-1">Margins</p>
        <div className="grid grid-cols-2 gap-1.5">
          <DimensionInput label="Top" valueMm={margins.top} unit={displayUnit}
            onChange={(v) => onChangeMargins({ ...margins, top: v })} />
          <DimensionInput label="Right" valueMm={margins.right} unit={displayUnit}
            onChange={(v) => onChangeMargins({ ...margins, right: v })} />
          <DimensionInput label="Bottom" valueMm={margins.bottom} unit={displayUnit}
            onChange={(v) => onChangeMargins({ ...margins, bottom: v })} />
          <DimensionInput label="Left" valueMm={margins.left} unit={displayUnit}
            onChange={(v) => onChangeMargins({ ...margins, left: v })} />
        </div>
      </div>

      {/* Grid */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <input
            type="checkbox"
            id="snap-toggle"
            checked={enableSnap}
            onChange={(e) => onChangeSnap(e.target.checked)}
            className="w-3 h-3"
          />
          <label htmlFor="snap-toggle" className="text-[10px] font-semibold text-gray-500">Snap to Grid</label>
        </div>
        {enableSnap && (
          <DimensionInput label="Grid Size" valueMm={gridSize} unit={displayUnit}
            onChange={(v) => onChangeGridSize(v)} />
        )}
      </div>
    </div>
  );
}
