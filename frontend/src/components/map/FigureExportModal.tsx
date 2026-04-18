import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { LayoutElement, LayoutTemplate } from '@/api/templates';
import type { Dataset, StyleConfig, RasterStyleConfig, RGBAColor } from '@/api/types';
import * as templatesApi from '@/api/templates';
import { useMapStore } from '@/stores/mapStore';
import { useDatasetStore } from '@/stores/datasetStore';
import { createLayerFromDataset } from '@/utils/layerFactory';
import { getColorRamp, interpolateRamp } from '@/utils/colorRamps';
import {
  captureMapCanvas,
  exportFigureAsPNG,
  exportFigureAsPDF,
  getEditablePlaceholders,
  type PlaceholderField,
} from '../templates/FigureExporter';
import { EmbeddedMap, type EmbeddedViewState, type EmbeddedMapHandle } from './EmbeddedMap';

const LAST_TEMPLATE_KEY = 'figure-export:last-template-id';
const MM_TO_PX = 3.7795;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.15;

interface Props {
  deckRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Preview sub-components
// ---------------------------------------------------------------------------

function rgbaStr(c: RGBAColor): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;
}

function PreviewLegend({ datasets }: { datasets: Dataset[] }) {
  if (datasets.length === 0) return null;
  return (
    <div className="w-full h-full overflow-hidden p-1" style={{ fontSize: 7 }}>
      <div className="font-bold text-[8px] mb-0.5">Legend</div>
      {datasets.slice(0, 8).map((ds) => {
        const cfg = ds.style_config as Partial<StyleConfig & RasterStyleConfig> | undefined;
        if (ds.data_type === 'raster' && cfg?.raster_mode === 'continuous' && cfg?.color_ramp) {
          const ramp = getColorRamp(cfg.color_ramp);
          if (ramp) {
            const stops = Array.from({ length: 8 }, (_, i) => {
              const t = i / 7;
              const c = interpolateRamp(cfg.color_ramp!, t);
              return `${rgbaStr(c)} ${(t * 100).toFixed(0)}%`;
            }).join(', ');
            return (
              <div key={ds.id} className="mb-0.5">
                <div className="text-[7px] font-medium truncate">{ds.name}</div>
                <div className="h-2 rounded-sm border border-gray-300" style={{ background: `linear-gradient(to right, ${stops})` }} />
              </div>
            );
          }
        }
        const fillColor = (cfg as Partial<StyleConfig>)?.fillColor || [0, 128, 255, 180];
        return (
          <div key={ds.id} className="flex items-center gap-1 mb-0.5">
            <span className="shrink-0 rounded-sm border border-gray-300" style={{ width: 8, height: 8, backgroundColor: rgbaStr(fillColor) }} />
            <span className="truncate text-[7px]">{ds.name}</span>
          </div>
        );
      })}
      {datasets.length > 8 && <div className="text-[6px] text-gray-400">+{datasets.length - 8} more</div>}
    </div>
  );
}

function PreviewScaleBar({ zoom }: { zoom: number }) {
  const metersPerPixel = 156543.03 / Math.pow(2, zoom);
  const barWidthMeters = metersPerPixel * 100;
  const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  let dist = nice[0];
  for (const d of nice) { if (d <= barWidthMeters) dist = d; else break; }
  const label = dist >= 1000 ? `${dist / 1000} km` : `${dist} m`;
  return (
    <div className="flex flex-col items-center justify-end h-full p-1">
      <div className="flex w-4/5 h-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 border border-black" style={{ backgroundColor: i % 2 === 0 ? '#000' : '#fff' }} />
        ))}
      </div>
      <div className="text-[6px] mt-0.5">{label}</div>
    </div>
  );
}

function PreviewNorthArrow() {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <svg viewBox="0 0 20 30" className="w-3/5 h-3/5" fill="black">
        <polygon points="10,2 14,20 10,16 6,20" />
      </svg>
      <span className="text-[8px] font-bold">N</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline-editable text element (multiline, with visual hints)
// ---------------------------------------------------------------------------

function EditableTextElement({
  elem,
  value,
  label,
  onChange,
  scale,
}: {
  elem: LayoutElement;
  value: string;
  label: string;
  onChange: (v: string) => void;
  scale: number;
}) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const fontSize = Math.max(6, (elem.fontSize || 10) * scale * 0.35);
  const fontWeight = elem.fontWeight === 'bold' ? 700 : 400;
  const textAlign = (elem.textAlign || 'left') as 'left' | 'center' | 'right';
  const color = elem.textColor || '#000000';

  const baseStyle: React.CSSProperties = {
    fontSize,
    fontWeight,
    textAlign,
    color,
    fontFamily: 'Arial, sans-serif',
    lineHeight: 1.3,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        style={{
          ...baseStyle,
          border: 'none',
          outline: '2px solid rgba(59,130,246,0.7)',
          outlineOffset: -1,
          background: 'rgba(255,255,255,0.95)',
          padding: '1px 2px',
          margin: 0,
          resize: 'none',
          cursor: 'text',
        }}
      />
    );
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title={`Click to edit: ${label}`}
      style={{
        ...baseStyle,
        cursor: 'text',
        outline: '1px dashed transparent',
        padding: '1px 2px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
      className="hover:outline-blue-400 hover:!outline-dashed hover:bg-blue-50/30 transition-colors"
    >
      {value || <span style={{ color: '#bbb', fontStyle: 'italic', fontSize: Math.max(6, fontSize * 0.9) }}>Click to edit: {label}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function FigureExportModal({ onClose }: Props) {
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  // Preview zoom/pan state
  const [previewZoom, setPreviewZoom] = useState<number | null>(null); // null = fit
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const embeddedMapRef = useRef<EmbeddedMapHandle>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);

  const { viewState: globalViewState, visibleDatasets: visibleSet, currentBasemap } = useMapStore();
  const { datasets } = useDatasetStore();

  const [embeddedViewState, setEmbeddedViewState] = useState<EmbeddedViewState>(() => ({
    longitude: globalViewState.longitude,
    latitude: globalViewState.latitude,
    zoom: globalViewState.zoom,
    pitch: globalViewState.pitch,
    bearing: globalViewState.bearing,
  }));

  const visibleDatasets = useMemo(
    () => datasets.filter((d) => visibleSet.has(d.id) && d.is_visible),
    [datasets, visibleSet],
  );

  const embeddedLayers = useMemo(
    () => visibleDatasets.map((d) => createLayerFromDataset(d)).filter(Boolean).flat(),
    [visibleDatasets],
  );

  useEffect(() => {
    templatesApi
      .getLayoutTemplates()
      .then((t) => {
        setTemplates(t);
        if (t.length > 0) {
          const last = localStorage.getItem(LAST_TEMPLATE_KEY);
          const match = last && t.find((x) => x.id === last);
          setSelectedId(match ? match.id : t[0].id);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const selectedTemplate = templates.find((t) => t.id === selectedId);

  useEffect(() => {
    if (selectedId) localStorage.setItem(LAST_TEMPLATE_KEY, selectedId);
  }, [selectedId]);

  const placeholderFields: PlaceholderField[] = useMemo(
    () => (selectedTemplate ? getEditablePlaceholders(selectedTemplate) : []),
    [selectedTemplate],
  );

  const editableIndices = useMemo(
    () => new Set(placeholderFields.map((f) => f.elementIndex)),
    [placeholderFields],
  );

  const placeholderLabels = useMemo(() => {
    const map: Record<number, string> = {};
    for (const f of placeholderFields) map[f.elementIndex] = f.label;
    return map;
  }, [placeholderFields]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const initial: Record<number, string> = {};
    for (const f of placeholderFields) initial[f.elementIndex] = f.defaultValue;
    setOverrides(initial);
    setPreviewZoom(null);
    setPreviewPan({ x: 0, y: 0 });
  }, [selectedTemplate, placeholderFields]);

  // Page layout
  const [containerSize, setContainerSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    if (!pageContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setContainerSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(pageContainerRef.current);
    return () => ro.disconnect();
  }, []);

  const pageLayout = useMemo(() => {
    if (!selectedTemplate) return null;
    const { width, height } = selectedTemplate.page_config;
    const pageWPx = width * MM_TO_PX;
    const pageHPx = height * MM_TO_PX;
    const fitScale = Math.min(
      (containerSize.w - 32) / pageWPx,
      (containerSize.h - 16) / pageHPx,
      1,
    );
    return { pageWPx, pageHPx, fitScale };
  }, [selectedTemplate, containerSize]);

  const effectiveZoom = previewZoom ?? pageLayout?.fitScale ?? 0.5;

  // Reference-only heuristic (same as FigureExporter.ts)
  const shouldRender = useCallback(
    (elem: LayoutElement) => {
      if (elem.referenceOnly) return false;
      if (!selectedTemplate) return true;
      const raw = (elem.text || '').trim();
      if (raw.length >= 8 && raw.length <= 80) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normText = normalize(raw);
        const normName = normalize(selectedTemplate.name);
        if (normText.length >= 6 && normName && (normName.includes(normText) || normText.includes(normName))) {
          return false;
        }
      }
      return true;
    },
    [selectedTemplate],
  );

  // Preview zoom/pan handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const fit = pageLayout?.fitScale ?? 0.5;
    setPreviewZoom((prev) => {
      const current = prev ?? fit;
      const next = e.deltaY < 0 ? current + ZOOM_STEP : current - ZOOM_STEP;
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    });
  }, [pageLayout]);

  const handlePreviewMouseDown = useCallback((e: React.MouseEvent) => {
    // Only pan on middle-click or when clicking empty space (not map/text)
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-pan]')) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: previewPan.x, panY: previewPan.y };
  }, [previewPan]);

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPreviewPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  }, [isPanning]);

  const handlePreviewMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const resetZoom = useCallback(() => {
    setPreviewZoom(null);
    setPreviewPan({ x: 0, y: 0 });
  }, []);

  // Export
  const handleExport = async (format: 'png' | 'pdf') => {
    if (!selectedTemplate || !embeddedMapRef.current) return;
    setExporting(format);

    try {
      // Force DeckGL to flush its render to the canvas buffer
      embeddedMapRef.current.redraw();

      // Wait for the GPU to finish
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      const container = embeddedMapRef.current.getContainer();
      const mapImage = container ? captureMapCanvas(container) : null;
      if (!mapImage) throw new Error('Map canvas not ready — try again in a moment');

      const options = {
        template: selectedTemplate,
        mapImage,
        visibleDatasets,
        mapZoom: embeddedViewState.zoom,
        mapCenter: { latitude: embeddedViewState.latitude, longitude: embeddedViewState.longitude },
        textOverrides: overrides,
      };

      const blob =
        format === 'pdf' ? await exportFigureAsPDF(options) : await exportFigureAsPNG(options);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTemplate.name}_figure.${format}`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Figure export failed:', err);
      const { useToastStore } = await import('@/stores/toastStore');
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : 'Figure export failed. Please try again.',
        'error',
      );
    } finally {
      setExporting(null);
    }
  };

  // Render a single template element
  function renderElement(elem: LayoutElement, idx: number) {
    if (!pageLayout || !shouldRender(elem)) return null;

    const left = elem.x * MM_TO_PX;
    const top = elem.y * MM_TO_PX;
    const width = elem.w * MM_TO_PX;
    const height = elem.h * MM_TO_PX;

    const posStyle: React.CSSProperties = {
      position: 'absolute',
      left, top, width, height,
      overflow: 'hidden',
    };

    switch (elem.type) {
      case 'map_frame':
        return (
          <div key={`el-${idx}`} data-no-pan style={{ ...posStyle, border: '1px solid #000', zIndex: 0 }}>
            <EmbeddedMap
              ref={embeddedMapRef}
              viewState={embeddedViewState}
              onViewStateChange={setEmbeddedViewState}
              layers={embeddedLayers}
              basemap={currentBasemap}
              width={Math.round(width)}
              height={Math.round(height)}
            />
          </div>
        );

      case 'title':
      case 'subtitle':
      case 'text':
        if (!editableIndices.has(idx)) return null;
        return (
          <div key={`el-${idx}`} data-no-pan style={posStyle}>
            <EditableTextElement
              elem={elem}
              value={overrides[idx] ?? elem.text ?? ''}
              label={placeholderLabels[idx] || 'Text'}
              onChange={(v) => setOverrides((o) => ({ ...o, [idx]: v }))}
              scale={pageLayout.fitScale}
            />
          </div>
        );

      case 'legend':
        return (
          <div key={`el-${idx}`} style={{ ...posStyle, backgroundColor: '#fff' }}>
            <PreviewLegend datasets={visibleDatasets.filter((d) => d.data_type === 'vector' || d.data_type === 'raster')} />
          </div>
        );

      case 'scale_bar':
        return (
          <div key={`el-${idx}`} style={posStyle}>
            <PreviewScaleBar zoom={embeddedViewState.zoom} />
          </div>
        );

      case 'north_arrow':
        return (
          <div key={`el-${idx}`} style={posStyle}>
            <PreviewNorthArrow />
          </div>
        );

      case 'logo':
      case 'image':
        if (elem.imageData) {
          return (
            <div key={`el-${idx}`} style={posStyle}>
              <img src={elem.imageData} alt="" className="w-full h-full object-contain" />
            </div>
          );
        }
        return null;

      case 'shape':
        return <div key={`el-${idx}`} style={{ ...posStyle, border: '1px solid #000' }} />;

      case 'horizontal_rule':
        return (
          <div
            key={`el-${idx}`}
            style={{
              ...posStyle,
              height: Math.max(1, (elem.thickness || 0.5) * MM_TO_PX),
              backgroundColor: elem.color || '#000',
            }}
          />
        );

      default:
        return null;
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[min(1100px,95vw)] h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">Export as Figure</h3>
          <div className="flex items-center gap-2">
            {/* Zoom controls */}
            <div className="flex items-center gap-1 mr-2 text-xs text-gray-500">
              <button
                onClick={() => setPreviewZoom((p) => Math.max(MIN_ZOOM, (p ?? pageLayout?.fitScale ?? 0.5) - ZOOM_STEP))}
                className="px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-100 text-sm"
                title="Zoom out"
              >−</button>
              <span className="w-10 text-center">{Math.round(effectiveZoom * 100)}%</span>
              <button
                onClick={() => setPreviewZoom((p) => Math.min(MAX_ZOOM, (p ?? pageLayout?.fitScale ?? 0.5) + ZOOM_STEP))}
                className="px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-100 text-sm"
                title="Zoom in"
              >+</button>
              <button
                onClick={resetZoom}
                className="px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-100 text-[10px]"
                title="Fit to window"
              >Fit</button>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Template picker */}
        <div className="px-6 py-2 border-b border-gray-200 flex items-center gap-3 shrink-0">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Template:</label>
          {loading ? (
            <span className="text-sm text-gray-400">Loading...</span>
          ) : templates.length === 0 ? (
            <span className="text-sm text-gray-500">No templates available. Import one from Manage &gt; Templates.</span>
          ) : (
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.page_config.width}×{t.page_config.height}mm)
                </option>
              ))}
            </select>
          )}
          <p className="text-[10px] text-gray-400 hidden sm:block">Click text to edit · Scroll to zoom · Drag to pan</p>
        </div>

        {/* Unified preview body — zoomable/pannable */}
        <div
          ref={pageContainerRef}
          className="flex-1 min-h-[300px] bg-gray-100 overflow-hidden relative"
          style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
          onWheel={handleWheel}
          onMouseDown={handlePreviewMouseDown}
          onMouseMove={handlePreviewMouseMove}
          onMouseUp={handlePreviewMouseUp}
          onMouseLeave={handlePreviewMouseUp}
        >
          {selectedTemplate && pageLayout ? (
            <div
              className="absolute"
              style={{
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%) translate(${previewPan.x}px, ${previewPan.y}px) scale(${effectiveZoom})`,
                transformOrigin: 'center center',
              }}
            >
              <div
                className="bg-white shadow-lg relative"
                style={{
                  width: pageLayout.pageWPx,
                  height: pageLayout.pageHPx,
                  border: '2px solid #000',
                }}
              >
                {selectedTemplate.elements.map((elem, idx) => renderElement(elem, idx))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-400 text-sm">Select a template to preview</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-500">
            {visibleDatasets.length} layer{visibleDatasets.length !== 1 ? 's' : ''} visible
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">
              Cancel
            </button>
            <button
              onClick={() => handleExport('png')}
              disabled={!selectedTemplate || exporting !== null}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {exporting === 'png' ? 'Exporting...' : 'Download PNG'}
            </button>
            <button
              onClick={() => handleExport('pdf')}
              disabled={!selectedTemplate || exporting !== null}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50"
            >
              {exporting === 'pdf' ? 'Exporting...' : 'Download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
