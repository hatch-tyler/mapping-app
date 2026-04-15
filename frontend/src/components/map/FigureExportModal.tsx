import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { LayoutTemplate } from '@/api/templates';
import * as templatesApi from '@/api/templates';
import { useMapStore } from '@/stores/mapStore';
import { useDatasetStore } from '@/stores/datasetStore';
import { createLayerFromDataset } from '@/utils/layerFactory';
import {
  captureMapCanvas,
  renderFigure,
  exportFigureAsPNG,
  exportFigureAsPDF,
  getEditablePlaceholders,
  type PlaceholderField,
} from '../templates/FigureExporter';
import { EmbeddedMap, type EmbeddedViewState } from './EmbeddedMap';

const LAST_TEMPLATE_KEY = 'figure-export:last-template-id';
const PREVIEW_DEBOUNCE_MS = 300;

interface Props {
  // deckRef kept for API compatibility with the caller, no longer used for capture.
  deckRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function FigureExportModal({ onClose }: Props) {
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const embeddedMapRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { viewState: globalViewState, visibleDatasets: visibleSet, currentBasemap } = useMapStore();
  const { datasets } = useDatasetStore();

  // Local viewState so panning inside the modal doesn't move the main map.
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
    () => visibleDatasets.map((d) => createLayerFromDataset(d)).filter(Boolean),
    [visibleDatasets],
  );

  // Load templates; restore last selection if available.
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

  // Persist last-selected template id.
  useEffect(() => {
    if (selectedId) localStorage.setItem(LAST_TEMPLATE_KEY, selectedId);
  }, [selectedId]);

  // Reset overrides to defaults whenever the template changes.
  const placeholderFields: PlaceholderField[] = useMemo(
    () => (selectedTemplate ? getEditablePlaceholders(selectedTemplate) : []),
    [selectedTemplate],
  );

  useEffect(() => {
    if (!selectedTemplate) return;
    const initial: Record<number, string> = {};
    for (const f of placeholderFields) initial[f.elementIndex] = f.defaultValue;
    setOverrides(initial);
  }, [selectedTemplate, placeholderFields]);

  // Map-frame aspect for sizing the live embedded map area.
  const mapFrameAspect = useMemo(() => {
    if (!selectedTemplate) return 16 / 9;
    const mf = selectedTemplate.elements.find((e) => e.type === 'map_frame');
    if (!mf || !mf.w || !mf.h) {
      const { width, height } = selectedTemplate.page_config;
      return width / height;
    }
    return mf.w / mf.h;
  }, [selectedTemplate]);

  // Scaled preview render.
  const renderPreview = useCallback(() => {
    if (!selectedTemplate || !previewContainerRef.current) return;
    const mapImage = embeddedMapRef.current ? captureMapCanvas(embeddedMapRef.current) : null;
    if (!mapImage) return;

    const figure = renderFigure({
      template: selectedTemplate,
      mapImage,
      visibleDatasets,
      mapZoom: embeddedViewState.zoom,
      mapCenter: { latitude: embeddedViewState.latitude, longitude: embeddedViewState.longitude },
      textOverrides: overrides,
    });

    const container = previewContainerRef.current;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const scaleX = containerW / figure.width;
    const scaleY = containerH / figure.height;
    const previewScale = Math.min(scaleX, scaleY, 1);

    const preview = document.createElement('canvas');
    preview.width = Math.max(1, Math.round(figure.width * previewScale));
    preview.height = Math.max(1, Math.round(figure.height * previewScale));
    const ctx = preview.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(figure, 0, 0, preview.width, preview.height);

    const existing = container.querySelector('canvas');
    if (existing) container.removeChild(existing);
    preview.style.maxWidth = '100%';
    preview.style.maxHeight = '100%';
    preview.style.margin = 'auto';
    preview.style.display = 'block';
    preview.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    container.appendChild(preview);
  }, [selectedTemplate, visibleDatasets, embeddedViewState, overrides]);

  // Debounced auto-refresh on relevant changes.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(renderPreview, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [renderPreview]);

  const handleExport = async (format: 'png' | 'pdf') => {
    if (!selectedTemplate || !embeddedMapRef.current) return;
    setExporting(format);

    try {
      const mapImage = captureMapCanvas(embeddedMapRef.current);
      if (!mapImage) throw new Error('Failed to capture map canvas');

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
      useToastStore.getState().addToast('Figure export failed. Please try again.', 'error');
    } finally {
      setExporting(null);
    }
  };

  // Compute map area size to match map_frame aspect.
  const mapAreaStyle = useMemo(() => {
    // Fit a 360×? (or ?×360) box within a 420×320 viewport.
    const maxW = 420;
    const maxH = 320;
    let w = maxW;
    let h = w / mapFrameAspect;
    if (h > maxH) {
      h = maxH;
      w = h * mapFrameAspect;
    }
    return { width: Math.round(w), height: Math.round(h) };
  }, [mapFrameAspect]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[min(1200px,95vw)] max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">Export as Figure</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Template picker */}
        <div className="px-6 py-3 border-b border-gray-200 flex items-center gap-3 shrink-0">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Template:</label>
          {loading ? (
            <span className="text-sm text-gray-400">Loading...</span>
          ) : templates.length === 0 ? (
            <span className="text-sm text-gray-500">
              No templates available. Import one from Manage &gt; Templates.
            </span>
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
        </div>

        {/* Three-column body */}
        <div className="flex-1 min-h-0 grid grid-cols-[260px_auto_1fr] gap-4 p-6 overflow-hidden">
          {/* Left: placeholder fields */}
          <div className="flex flex-col min-h-0 overflow-y-auto pr-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Fields
            </h4>
            {placeholderFields.length === 0 ? (
              <p className="text-xs text-gray-400">
                This template has no editable text fields.
              </p>
            ) : (
              <div className="space-y-3">
                {placeholderFields.map((f) => (
                  <div key={f.elementIndex}>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      {f.label}
                    </label>
                    {f.multiline ? (
                      <textarea
                        rows={3}
                        value={overrides[f.elementIndex] ?? ''}
                        onChange={(e) =>
                          setOverrides((o) => ({ ...o, [f.elementIndex]: e.target.value }))
                        }
                        className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <input
                        type="text"
                        value={overrides[f.elementIndex] ?? ''}
                        onChange={(e) =>
                          setOverrides((o) => ({ ...o, [f.elementIndex]: e.target.value }))
                        }
                        className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Middle: live embedded map */}
          <div className="flex flex-col items-center min-h-0">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 self-start">
              Map (pan &amp; zoom to frame)
            </h4>
            {selectedTemplate ? (
              <EmbeddedMap
                ref={embeddedMapRef}
                viewState={embeddedViewState}
                onViewStateChange={setEmbeddedViewState}
                layers={embeddedLayers}
                basemap={currentBasemap}
                width={mapAreaStyle.width}
                height={mapAreaStyle.height}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                Select a template
              </div>
            )}
          </div>

          {/* Right: scaled full-page preview */}
          <div className="flex flex-col min-h-0">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Preview
            </h4>
            <div
              ref={previewContainerRef}
              className="flex-1 min-h-0 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden p-3"
            >
              {!selectedTemplate && (
                <p className="text-gray-400 text-sm">Select a template to preview</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-500">
            {visibleDatasets.length} layer{visibleDatasets.length !== 1 ? 's' : ''} visible
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={renderPreview}
              disabled={!selectedTemplate}
              className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Refresh preview
            </button>
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
