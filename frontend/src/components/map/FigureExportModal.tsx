import { useState, useEffect, useRef, useCallback } from 'react';
import { LayoutTemplate } from '@/api/templates';
import * as templatesApi from '@/api/templates';
import { useMapStore } from '@/stores/mapStore';
import { useDatasetStore } from '@/stores/datasetStore';
import {
  captureMapCanvas,
  renderFigure,
  exportFigureAsPNG,
  exportFigureAsPDF,
} from '../templates/FigureExporter';

interface Props {
  deckRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function FigureExportModal({ deckRef, onClose }: Props) {
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const { viewState, visibleDatasets: visibleSet } = useMapStore();
  const { datasets } = useDatasetStore();

  const visibleDatasets = datasets.filter((d) => visibleSet.has(d.id) && d.is_visible);

  useEffect(() => {
    templatesApi.getLayoutTemplates().then((t) => {
      setTemplates(t);
      if (t.length > 0) setSelectedId(t[0].id);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Capture map once when modal opens
  useEffect(() => {
    if (deckRef.current) {
      mapCanvasRef.current = captureMapCanvas(deckRef.current);
    }
  }, [deckRef]);

  const selectedTemplate = templates.find((t) => t.id === selectedId);

  // Render preview
  const renderPreview = useCallback(() => {
    if (!selectedTemplate || !mapCanvasRef.current || !previewContainerRef.current) return;

    const figure = renderFigure({
      template: selectedTemplate,
      mapImage: mapCanvasRef.current,
      visibleDatasets,
      mapZoom: viewState.zoom,
      mapCenter: { latitude: viewState.latitude, longitude: viewState.longitude },
    });

    // Scale to fit the preview container
    const containerW = previewContainerRef.current.clientWidth;
    const containerH = previewContainerRef.current.clientHeight;
    const scaleX = containerW / figure.width;
    const scaleY = containerH / figure.height;
    const previewScale = Math.min(scaleX, scaleY, 1);

    const preview = document.createElement('canvas');
    preview.width = Math.round(figure.width * previewScale);
    preview.height = Math.round(figure.height * previewScale);
    const ctx = preview.getContext('2d')!;
    ctx.drawImage(figure, 0, 0, preview.width, preview.height);

    previewRef.current = figure; // keep full-res for export

    // Display preview
    const container = previewContainerRef.current;
    const existing = container.querySelector('canvas');
    if (existing) container.removeChild(existing);
    preview.style.maxWidth = '100%';
    preview.style.maxHeight = '100%';
    preview.style.margin = 'auto';
    preview.style.display = 'block';
    preview.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    container.appendChild(preview);
  }, [selectedTemplate, visibleDatasets, viewState]);

  useEffect(() => {
    if (selectedTemplate && mapCanvasRef.current) {
      renderPreview();
    }
  }, [selectedTemplate, renderPreview]);

  const handleExport = async (format: 'png' | 'pdf') => {
    if (!selectedTemplate || !mapCanvasRef.current) return;
    setExporting(format);

    try {
      const options = {
        template: selectedTemplate,
        mapImage: mapCanvasRef.current,
        visibleDatasets,
        mapZoom: viewState.zoom,
        mapCenter: { latitude: viewState.latitude, longitude: viewState.longitude },
      };

      const blob = format === 'pdf'
        ? await exportFigureAsPDF(options)
        : await exportFigureAsPNG(options);

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">Export as Figure</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col p-6 gap-4 overflow-hidden">
          {/* Template selector */}
          <div className="flex items-center gap-3 shrink-0">
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
                  <option key={t.id} value={t.id}>{t.name} ({t.page_config.width}×{t.page_config.height}mm)</option>
                ))}
              </select>
            )}
          </div>

          {/* Preview */}
          <div
            ref={previewContainerRef}
            className="flex-1 min-h-0 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden"
          >
            {!selectedTemplate && (
              <p className="text-gray-400 text-sm">Select a template to preview</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
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
