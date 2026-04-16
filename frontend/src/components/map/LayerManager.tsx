import { useState, useCallback, useEffect } from 'react';
import { Dataset, StyleConfig, RasterStyleConfig } from '../../api/types';
import { useDatasetStore } from '../../stores/datasetStore';
import { useMapStore } from '../../stores/mapStore';
import { useAuthStore } from '../../stores/authStore';
import { StyleEditor } from '../styling/StyleEditor';
import { RasterStyleEditor } from '../styling/RasterStyleEditor';
import { MetadataModal } from '../catalog/MetadataModal';
import { rgbaToString, DEFAULT_STYLE } from '../../utils/styleInterpreter';
import * as datasetsApi from '../../api/datasets';

const STORAGE_KEY = 'layer-panel:expanded';

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function persistExpanded(set: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

export function LayerManager() {
  const { datasets, updateDataset } = useDatasetStore();
  const { visibleDatasets, toggleDatasetVisibility, setDatasetVisible, zoomToBounds } = useMapStore();
  const { user } = useAuthStore();
  const [styleDataset, setStyleDataset] = useState<Dataset | null>(null);
  const [metadataDataset, setMetadataDataset] = useState<Dataset | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(loadExpanded);
  const [searchQuery, setSearchQuery] = useState('');

  const visibleDatasetsList = datasets.filter((d) => {
    if (!d.is_visible) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Group datasets by project
  const projectDatasets: Record<string, { name: string; datasets: Dataset[] }> = {};
  const referenceDatasets: Dataset[] = [];

  for (const ds of visibleDatasetsList) {
    if (ds.project_id && ds.project_name) {
      if (!projectDatasets[ds.project_id]) {
        projectDatasets[ds.project_id] = { name: ds.project_name, datasets: [] };
      }
      projectDatasets[ds.project_id].datasets.push(ds);
    } else {
      referenceDatasets.push(ds);
    }
  }

  const allSectionIds = [
    ...Object.keys(projectDatasets),
    ...(referenceDatasets.length > 0 ? ['_reference'] : []),
  ];

  const updateExpanded = useCallback((next: Set<string>) => {
    setExpandedSections(next);
    persistExpanded(next);
  }, []);

  function toggleSection(sectionId: string) {
    const next = new Set(expandedSections);
    if (next.has(sectionId)) next.delete(sectionId);
    else next.add(sectionId);
    updateExpanded(next);
  }

  function expandAll() {
    updateExpanded(new Set(allSectionIds));
  }

  function collapseAll() {
    updateExpanded(new Set());
  }

  // When searching, auto-expand all so results are visible.
  useEffect(() => {
    if (searchQuery) updateExpanded(new Set(allSectionIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  function toggleSectionVisibility(sectionDatasets: Dataset[]) {
    const allOn = sectionDatasets.every((d) => visibleDatasets.has(d.id));
    for (const d of sectionDatasets) {
      setDatasetVisible(d.id, !allOn);
    }
  }

  const handleStyleSave = async (styleConfig: StyleConfig | RasterStyleConfig) => {
    if (!styleDataset) return;
    try {
      const updated = await datasetsApi.updateDataset(
        styleDataset.id,
        { style_config: styleConfig as unknown as Record<string, unknown> }
      );
      updateDataset(styleDataset.id, updated);
      setStyleDataset(null);
    } catch (err) {
      console.error('Failed to save style:', err);
    }
  };

  const getFillColor = (dataset: Dataset): string => {
    const config = dataset.style_config as Partial<StyleConfig> | undefined;
    const fillColor = config?.fillColor || DEFAULT_STYLE.fillColor;
    return rgbaToString(fillColor);
  };

  function getBounds(dataset: Dataset): number[] | null {
    const bounds = dataset.bounds;
    if (bounds && bounds.length >= 4) return bounds;
    const meta = dataset.service_metadata as Record<string, unknown> | null;
    const totalBounds = meta?.total_bounds as number[] | undefined;
    if (totalBounds && totalBounds.length >= 4) return totalBounds;
    return null;
  }

  function handleZoom(dataset: Dataset) {
    const bounds = getBounds(dataset);
    if (bounds && bounds.length >= 4) {
      zoomToBounds(bounds);
      if (!visibleDatasets.has(dataset.id)) {
        toggleDatasetVisibility(dataset.id);
      }
    }
  }

  function handleZoomToProject(projectId: string) {
    const group = projectDatasets[projectId];
    if (!group) return;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const ds of group.datasets) {
      const b = getBounds(ds);
      if (b) {
        minx = Math.min(minx, b[0]);
        miny = Math.min(miny, b[1]);
        maxx = Math.max(maxx, b[2]);
        maxy = Math.max(maxy, b[3]);
      }
    }
    if (minx < Infinity) {
      zoomToBounds([minx, miny, maxx, maxy]);
    }
  }

  const ZoomIcon = () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );

  const ChevronIcon = ({ open }: { open: boolean }) => (
    <svg className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );

  function renderLayerRow(dataset: Dataset) {
    return (
      <div key={dataset.id} className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-gray-50 text-sm">
        <input
          type="checkbox"
          id={`layer-${dataset.id}`}
          checked={visibleDatasets.has(dataset.id)}
          onChange={() => toggleDatasetVisibility(dataset.id)}
          className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 shrink-0"
        />
        {dataset.data_type === 'vector' && (
          <button
            onClick={() => setStyleDataset(dataset)}
            className="w-3.5 h-3.5 rounded border border-gray-400 shrink-0 hover:ring-2 hover:ring-blue-300 cursor-pointer"
            style={{ backgroundColor: getFillColor(dataset) }}
            title="Change style"
          />
        )}
        <label
          htmlFor={`layer-${dataset.id}`}
          className="flex-1 text-[13px] text-gray-700 cursor-pointer truncate"
          title={dataset.name}
        >
          {dataset.name}
        </label>
        {dataset.min_zoom > 0 && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-50 text-amber-600 shrink-0" title={`Visible at zoom ${dataset.min_zoom}+`}>
            z{dataset.min_zoom}+
          </span>
        )}
        <span
          className={`text-[10px] px-1 py-0.5 rounded shrink-0 ${
            dataset.data_type === 'vector'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-green-100 text-green-700'
          }`}
        >
          {dataset.data_type === 'vector' ? 'vec' : 'rst'}
        </span>
        <button
          onClick={() => handleZoom(dataset)}
          disabled={!getBounds(dataset)}
          className="p-0.5 rounded text-gray-400 hover:text-blue-600 disabled:opacity-30 shrink-0"
          title={getBounds(dataset) ? 'Zoom to extent' : 'Bounds not available'}
        >
          <ZoomIcon />
        </button>
        <button
          onClick={() => setMetadataDataset(dataset)}
          className="p-0.5 rounded text-gray-400 hover:text-gray-600 shrink-0"
          title="View dataset info"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        {user?.is_admin && (dataset.data_type === 'vector' || dataset.data_type === 'raster') && (
          <button
            onClick={() => setStyleDataset(dataset)}
            className="p-0.5 rounded text-gray-400 hover:text-purple-600 shrink-0"
            title="Edit layer style"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  function renderSection(sectionId: string, title: string, sectionDatasets: Dataset[], onZoom?: () => void, isProject = false) {
    const isOpen = expandedSections.has(sectionId);
    const allOn = sectionDatasets.every((d) => visibleDatasets.has(d.id));
    const noneOn = sectionDatasets.every((d) => !visibleDatasets.has(d.id));
    return (
      <div key={sectionId}>
        <div
          className={`px-3 py-1.5 text-xs font-semibold uppercase flex items-center gap-1 cursor-pointer select-none border-b ${
            isProject
              ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
              : 'bg-gray-50 text-gray-500 border-gray-100'
          }`}
          onClick={() => toggleSection(sectionId)}
          title={isProject ? 'Project data — only visible to project members' : 'Reference data — shared across all users'}
        >
          <ChevronIcon open={isOpen} />
          {isProject && <span aria-hidden>📁</span>}
          <span className="flex-1 truncate">{title} ({sectionDatasets.length})</span>
          {/* Bulk visibility toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleSectionVisibility(sectionDatasets); }}
            className={`p-0.5 rounded shrink-0 ${
              allOn ? 'text-blue-600' : noneOn ? 'text-gray-300' : 'text-gray-400'
            } hover:text-blue-500`}
            title={allOn ? 'Hide all layers in this group' : 'Show all layers in this group'}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {allOn || !noneOn ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
              )}
            </svg>
          </button>
          {onZoom && (
            <button
              onClick={(e) => { e.stopPropagation(); onZoom(); }}
              className="p-0.5 rounded text-gray-400 hover:text-blue-600 shrink-0"
              title="Zoom to project extent"
            >
              <ZoomIcon />
            </button>
          )}
        </div>
        {isOpen && sectionDatasets.map(renderLayerRow)}
      </div>
    );
  }

  const projectIds = Object.keys(projectDatasets);
  const totalCount = visibleDatasetsList.length;

  return (
    <>
      <div className="absolute top-12 left-11 bottom-0 w-[340px] bg-white/95 backdrop-blur-sm border-r border-gray-200 z-10 flex flex-col">
        {/* Header */}
        <div className="px-3 py-2 border-b border-gray-200 shrink-0 flex items-center justify-between">
          <h3 className="font-semibold text-gray-700 text-sm">
            Layers {totalCount > 0 && <span className="text-gray-400 font-normal">({totalCount})</span>}
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={expandAll}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title="Expand all sections"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
              </svg>
            </button>
            <button
              onClick={collapseAll}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title="Collapse all sections"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-gray-200 shrink-0">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search layers..."
            className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
          />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {totalCount === 0 ? (
            <p className="text-gray-500 text-sm px-3 py-4">{searchQuery ? 'No matching layers' : 'No layers available'}</p>
          ) : (
            <>
              {projectIds.map((pid) =>
                renderSection(
                  pid,
                  projectDatasets[pid].name,
                  projectDatasets[pid].datasets,
                  () => handleZoomToProject(pid),
                  true
                )
              )}
              {referenceDatasets.length > 0 &&
                renderSection('_reference', 'Reference Layers', referenceDatasets)
              }
            </>
          )}
        </div>
      </div>

      {styleDataset && styleDataset.data_type === 'raster' && (
        <RasterStyleEditor
          dataset={styleDataset}
          onSave={handleStyleSave}
          onClose={() => setStyleDataset(null)}
        />
      )}
      {styleDataset && styleDataset.data_type !== 'raster' && (
        <StyleEditor
          dataset={styleDataset}
          onSave={handleStyleSave}
          onClose={() => setStyleDataset(null)}
        />
      )}
      {metadataDataset && (
        <MetadataModal
          dataset={metadataDataset}
          onClose={() => setMetadataDataset(null)}
        />
      )}
    </>
  );
}
