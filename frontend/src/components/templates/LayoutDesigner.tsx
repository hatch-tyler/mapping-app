import { useState, useEffect, useCallback, useRef } from 'react';
import { useToastStore } from '@/stores/toastStore';
import * as templatesApi from '@/api/templates';
import type { LayoutTemplate, LayoutElement, DisplayUnit } from '@/api/templates';
import { VisualCanvas } from './VisualCanvas';
import { PropertiesPanel } from './PropertiesPanel';
import { ElementList } from './ElementList';
import {
  PAGE_PRESETS, DEFAULT_MARGINS, ELEMENT_LABELS, ELEMENT_ICONS,
  getDefaultElement, getDefaultElements,
} from './canvasUtils';
import type { PagePresetKey } from './canvasUtils';

interface Props {
  onClose: () => void;
}

const ADDABLE_TYPES: LayoutElement['type'][] = [
  'map_frame', 'title', 'subtitle', 'legend', 'scale_bar', 'north_arrow',
  'text', 'logo', 'horizontal_rule', 'header_decorator', 'footer_decorator',
];

export function LayoutDesigner({ onClose }: Props) {
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pagePreset, setPagePreset] = useState<PagePresetKey>('letter_landscape');
  const [elements, setElements] = useState<LayoutElement[]>(() =>
    getDefaultElements(PAGE_PRESETS.letter_landscape.width, PAGE_PRESETS.letter_landscape.height)
  );
  const [margins, setMargins] = useState(DEFAULT_MARGINS);
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('in');
  const [enableSnap, setEnableSnap] = useState(true);
  const [gridSize, setGridSize] = useState(12.7); // 0.5 inch in mm
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LayoutTemplate | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const preset = PAGE_PRESETS[pagePreset];

  const fetchTemplates = async () => {
    try {
      const data = await templatesApi.getLayoutTemplates();
      setTemplates(data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const updateElement = useCallback((index: number, updates: Partial<LayoutElement>) => {
    setElements((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, []);

  const removeElement = useCallback((index: number) => {
    setElements((prev) => prev.filter((_, i) => i !== index));
    if (selectedIndex === index) setSelectedIndex(null);
    else if (selectedIndex !== null && selectedIndex > index) setSelectedIndex(selectedIndex - 1);
  }, [selectedIndex]);

  const addElement = useCallback((type: LayoutElement['type']) => {
    const el = getDefaultElement(type, preset.width, preset.height);
    setElements((prev) => [...prev, el]);
    setSelectedIndex(elements.length);
  }, [preset.width, preset.height, elements.length]);

  const reorderElements = useCallback((from: number, to: number) => {
    setElements((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    if (selectedIndex === from) setSelectedIndex(to);
    else if (selectedIndex !== null) {
      if (from < selectedIndex && to >= selectedIndex) setSelectedIndex(selectedIndex - 1);
      else if (from > selectedIndex && to <= selectedIndex) setSelectedIndex(selectedIndex + 1);
    }
  }, [selectedIndex]);

  const handleChangePagePreset = useCallback((key: PagePresetKey) => {
    setPagePreset(key);
    const p = PAGE_PRESETS[key];
    setElements(getDefaultElements(p.width, p.height));
    setSelectedIndex(null);
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      useToastStore.getState().addToast('Please enter a template name', 'error');
      return;
    }
    setSaving(true);
    try {
      const pageConfig = {
        width: preset.width,
        height: preset.height,
        orientation: preset.orientation,
        margins,
        displayUnit,
      };
      if (editingTemplate) {
        await templatesApi.updateLayoutTemplate(editingTemplate.id, {
          name: name.trim(),
          description: description || undefined,
          page_config: pageConfig,
          elements,
        });
        useToastStore.getState().addToast('Template updated', 'success');
      } else {
        await templatesApi.createLayoutTemplate({
          name: name.trim(),
          description: description || undefined,
          page_config: pageConfig,
          elements,
        });
        useToastStore.getState().addToast('Template saved', 'success');
      }
      fetchTemplates();
    } catch {
      useToastStore.getState().addToast('Failed to save template', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await templatesApi.deleteLayoutTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      if (editingTemplate?.id === id) {
        setEditingTemplate(null);
        setName('');
        setDescription('');
      }
      useToastStore.getState().addToast('Template deleted', 'success');
    } catch {
      useToastStore.getState().addToast('Failed to delete template', 'error');
    }
  };

  const handleExport = async (id: string, format: 'qpt' | 'pagx') => {
    setExporting(`${id}-${format}`);
    try {
      await templatesApi.downloadLayoutExport(id, format);
    } catch {
      useToastStore.getState().addToast(`Failed to export ${format.toUpperCase()}`, 'error');
    } finally {
      setExporting(null);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = '';
    const defaultName = file.name.replace(/\.(qpt|pagx)$/i, '');
    setImporting(true);
    try {
      await templatesApi.importLayoutTemplate(file, defaultName);
      useToastStore.getState().addToast('Template imported', 'success');
      // Refresh list and auto-load the imported template
      const updated = await templatesApi.getLayoutTemplates();
      setTemplates(updated);
      const imported = updated.find((t) => t.name === defaultName);
      if (imported) loadForEdit(imported);
    } catch {
      useToastStore.getState().addToast('Failed to import template', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadOriginal = async (t: LayoutTemplate) => {
    try {
      await templatesApi.downloadOriginalTemplate(t.id, t.name, t.source_format || 'xml');
    } catch {
      useToastStore.getState().addToast('Failed to download template', 'error');
    }
  };

  const loadForEdit = (template: LayoutTemplate) => {
    setEditingTemplate(template);
    setName(template.name);
    setDescription(template.description || '');
    setElements(template.elements || getDefaultElements(preset.width, preset.height));
    setSelectedIndex(null);

    // Restore margins & display unit
    if (template.page_config.margins) setMargins(template.page_config.margins);
    else setMargins(DEFAULT_MARGINS);
    if (template.page_config.displayUnit) setDisplayUnit(template.page_config.displayUnit);

    // Find matching preset
    const match = Object.entries(PAGE_PRESETS).find(([, p]) =>
      p.width === template.page_config.width && p.height === template.page_config.height
    );
    if (match) setPagePreset(match[0] as PagePresetKey);
  };

  const handleNewTemplate = () => {
    setEditingTemplate(null);
    setName('');
    setDescription('');
    setElements(getDefaultElements(preset.width, preset.height));
    setSelectedIndex(null);
  };

  const selectedElement = selectedIndex !== null ? elements[selectedIndex] : null;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shrink-0">
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Close">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="h-5 w-px bg-gray-300" />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name..."
          className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
        />
        <div className="flex-1" />
        {editingTemplate && (
          <button
            onClick={handleNewTemplate}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            New
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : editingTemplate ? 'Update' : 'Save'}
        </button>
      </div>

      {/* Main 3-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel */}
        <div className="w-56 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          {/* Saved Templates */}
          <div className="p-3 border-b border-gray-200 overflow-y-auto" style={{ maxHeight: '35%' }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Templates</h3>
              <button
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                className="text-[9px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded hover:bg-purple-100 disabled:opacity-50 font-medium"
              >
                {importing ? '...' : 'Import'}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".qpt,.pagx"
                onChange={handleImport}
                className="hidden"
              />
            </div>
            {templates.length === 0 ? (
              <div
                onClick={() => importInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file && (file.name.endsWith('.qpt') || file.name.endsWith('.pagx'))) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    if (importInputRef.current) {
                      importInputRef.current.files = dt.files;
                      importInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  }
                }}
                className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors"
              >
                <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-xs font-medium text-gray-600">Import Template</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Drop .qpt or .pagx file here</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className={`p-2 rounded border text-xs cursor-pointer ${
                      editingTemplate?.id === t.id
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => loadForEdit(t)}
                  >
                    <div className="flex items-center gap-1">
                      <p className="font-medium text-gray-800 truncate flex-1">{t.name}</p>
                      {t.source_format && (
                        <span className="text-[8px] px-1 py-0.5 bg-purple-100 text-purple-700 rounded font-semibold uppercase shrink-0">
                          {t.source_format}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {t.page_config.orientation} {t.page_config.width}x{t.page_config.height}mm
                    </p>
                    <div className="flex gap-1 mt-1">
                      {t.source_format && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownloadOriginal(t); }}
                          className="text-[9px] px-1 py-0.5 bg-purple-50 text-purple-600 rounded hover:bg-purple-100"
                          title="Download original file"
                        >
                          Original
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExport(t.id, 'qpt'); }}
                        disabled={exporting === `${t.id}-qpt`}
                        className="text-[9px] px-1 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
                      >
                        {exporting === `${t.id}-qpt` ? '...' : 'QGIS'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExport(t.id, 'pagx'); }}
                        disabled={exporting === `${t.id}-pagx`}
                        className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
                      >
                        {exporting === `${t.id}-pagx` ? '...' : 'ArcGIS'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                        className="text-[9px] px-1 py-0.5 bg-red-50 text-red-600 rounded hover:bg-red-100 ml-auto"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Elements */}
          <div className="p-3 border-b border-gray-200">
            <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Add Element</h3>
            <div className="grid grid-cols-2 gap-1">
              {ADDABLE_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => addElement(type)}
                  className="flex items-center gap-1 px-1.5 py-1 text-[10px] bg-gray-50 text-gray-600 rounded hover:bg-blue-50 hover:text-blue-600 border border-gray-200"
                >
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d={ELEMENT_ICONS[type]} />
                  </svg>
                  <span className="truncate">{ELEMENT_LABELS[type]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Element List */}
          <div className="flex-1 overflow-y-auto p-2">
            <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">Layers</h3>
            <ElementList
              elements={elements}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              onReorder={reorderElements}
              onDelete={removeElement}
            />
          </div>
        </div>

        {/* Center: Visual Canvas */}
        <VisualCanvas
          pageWidth={preset.width}
          pageHeight={preset.height}
          elements={elements}
          selectedIndex={selectedIndex}
          margins={margins}
          enableSnap={enableSnap}
          gridSize={gridSize}
          onSelectElement={setSelectedIndex}
          onUpdateElement={updateElement}
        />

        {/* Right: Properties Panel */}
        <PropertiesPanel
          selectedElement={selectedElement}
          selectedIndex={selectedIndex}
          displayUnit={displayUnit}
          pagePreset={pagePreset}
          margins={margins}
          enableSnap={enableSnap}
          gridSize={gridSize}
          onUpdateElement={updateElement}
          onDeleteElement={removeElement}
          onChangePagePreset={handleChangePagePreset}
          onChangeMargins={setMargins}
          onChangeSnap={setEnableSnap}
          onChangeGridSize={setGridSize}
          onChangeDisplayUnit={setDisplayUnit}
        />
      </div>
    </div>
  );
}
