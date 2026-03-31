import { useState, useEffect, useMemo, useCallback } from 'react';
import { Dataset } from '@/api/types';
import { getBrowsableDatasets } from '@/api/datasets';
import { Navbar } from '@/components/layout/Navbar';
import { CatalogCard } from '@/components/catalog/CatalogCard';
import { MetadataModal } from '@/components/catalog/MetadataModal';
import { ProjectAccordion } from '@/components/catalog/ProjectAccordion';
import {
  CatalogFilters,
  CatalogFilterState,
  DEFAULT_FILTERS,
} from '@/components/catalog/CatalogFilters';
import * as templatesApi from '@/api/templates';
import type { MapView, LayoutTemplate } from '@/api/templates';
import { useNavigate } from 'react-router-dom';

export function CatalogPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CatalogFilterState>(DEFAULT_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [metadataDataset, setMetadataDataset] = useState<Dataset | null>(null);
  const [savedViews, setSavedViews] = useState<MapView[]>([]);
  const [layoutTemplates, setLayoutTemplates] = useState<LayoutTemplate[]>([]);
  const navigate = useNavigate();

  // Fetch all browsable datasets on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        setLoading(true);
        const result = await getBrowsableDatasets(0, 500);
        if (!cancelled) {
          setDatasets(result.datasets);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load datasets. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch saved views and templates
  useEffect(() => {
    templatesApi.getMapViews().then(setSavedViews).catch((e) => console.warn('Failed to load map views:', e));
    templatesApi.getLayoutTemplates().then(setLayoutTemplates).catch((e) => console.warn('Failed to load templates:', e));
  }, []);

  const handleOpenView = (view: MapView) => {
    const config = view.map_config;
    const layers = view.layer_configs.filter(l => l.visible).map(l => l.dataset_id);
    const hash = `zoom=${config.zoom.toFixed(1)}&lat=${config.latitude.toFixed(4)}&lon=${config.longitude.toFixed(4)}&layers=${layers.join(',')}`;
    navigate(`/#${hash}`);
  };

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // Client-side filtering
  const filteredDatasets = useMemo(() => {
    return datasets.filter((ds) => {
      // Text search
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const matchesSearch =
          ds.name.toLowerCase().includes(q) ||
          (ds.description && ds.description.toLowerCase().includes(q)) ||
          (ds.tags && ds.tags.some((t) => t.toLowerCase().includes(q)));
        if (!matchesSearch) return false;
      }

      // Category
      if (filters.category && ds.category !== filters.category) return false;

      // Data type
      if (filters.dataType && ds.data_type !== filters.dataType) return false;

      // Source type
      if (filters.sourceType && ds.source_type !== filters.sourceType) return false;

      // Geographic scope
      if (filters.geographicScope && ds.geographic_scope !== filters.geographicScope)
        return false;

      // Project
      if (filters.projectId && ds.project_id !== filters.projectId) return false;

      // Tag
      if (filters.tag && !(ds.tags && ds.tags.includes(filters.tag))) return false;

      return true;
    });
  }, [datasets, debouncedSearch, filters]);

  // Project groups (datasets with project_id or linked to projects)
  const projectGroups = useMemo(() => {
    const projectDatasetMap: Record<string, { name: string; datasets: Dataset[] }> = {};

    for (const ds of filteredDatasets) {
      // Add to owned project
      if (ds.project_id && ds.project_name) {
        if (!projectDatasetMap[ds.project_id]) {
          projectDatasetMap[ds.project_id] = { name: ds.project_name, datasets: [] };
        }
        if (!projectDatasetMap[ds.project_id].datasets.find(d => d.id === ds.id)) {
          projectDatasetMap[ds.project_id].datasets.push(ds);
        }
      }
      // Add to linked projects
      if (ds.linked_project_ids && ds.linked_project_names) {
        for (let i = 0; i < ds.linked_project_ids.length; i++) {
          const pid = ds.linked_project_ids[i];
          const pname = ds.linked_project_names[i] || 'Unknown';
          if (!projectDatasetMap[pid]) {
            projectDatasetMap[pid] = { name: pname, datasets: [] };
          }
          if (!projectDatasetMap[pid].datasets.find(d => d.id === ds.id)) {
            projectDatasetMap[pid].datasets.push(ds);
          }
        }
      }
    }

    return Object.entries(projectDatasetMap).sort((a, b) =>
      a[1].name.localeCompare(b[1].name)
    );
  }, [filteredDatasets]);

  // Reference datasets (no project_id)
  const referenceDatasets = useMemo(
    () => filteredDatasets.filter((d) => !d.project_id),
    [filteredDatasets]
  );

  const handleViewMetadata = useCallback((dataset: Dataset) => {
    setMetadataDataset(dataset);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Navbar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Filters */}
        <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          <CatalogFilters
            filters={filters}
            onChange={setFilters}
            datasets={datasets}
          />
        </aside>

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Results summary */}
          <p className="text-sm text-gray-500 mb-6">
            {filteredDatasets.length} datasets found
          </p>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3">
                <svg
                  className="animate-spin h-8 w-8 text-blue-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <p className="text-sm text-gray-500">Loading datasets...</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-sm text-red-600">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-8">
              {/* Projects Section */}
              {projectGroups.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    My Projects
                  </h2>
                  <div className="space-y-3">
                    {projectGroups.map(([projectId, group]) => (
                      <ProjectAccordion
                        key={projectId}
                        projectId={projectId}
                        projectName={group.name}
                        datasets={group.datasets}
                        onViewMetadata={handleViewMetadata}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Reference Data Section */}
              {referenceDatasets.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Reference Data
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {referenceDatasets.map((dataset) => (
                      <CatalogCard
                        key={dataset.id}
                        dataset={dataset}
                        onViewMetadata={handleViewMetadata}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Saved Map Views */}
              {savedViews.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Saved Map Views
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {savedViews.map((view) => (
                      <button
                        key={view.id}
                        onClick={() => handleOpenView(view)}
                        className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow-md transition-all"
                      >
                        <h3 className="font-medium text-gray-900 text-sm">{view.name}</h3>
                        {view.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{view.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                            {view.layer_configs.length} layers
                          </span>
                          <span className="text-[10px] text-gray-400">
                            Zoom {view.map_config.zoom?.toFixed(0)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Layout Templates */}
              {layoutTemplates.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Layout Templates
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {layoutTemplates.map((tmpl) => (
                      <div
                        key={tmpl.id}
                        className="bg-white rounded-lg border border-gray-200 p-4"
                      >
                        <h3 className="font-medium text-gray-900 text-sm">{tmpl.name}</h3>
                        {tmpl.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tmpl.description}</p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-1">
                          {tmpl.page_config.orientation} {tmpl.page_config.width}x{tmpl.page_config.height}mm
                        </p>
                        <div className="flex gap-1 mt-2">
                          <button
                            onClick={() => templatesApi.downloadLayoutExport(tmpl.id, 'qpt')}
                            className="text-[10px] px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
                          >
                            QGIS (.qpt)
                          </button>
                          <button
                            onClick={() => templatesApi.downloadLayoutExport(tmpl.id, 'pagx')}
                            className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            ArcGIS (.pagx)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Empty state */}
              {projectGroups.length === 0 && referenceDatasets.length === 0 && (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <svg
                      className="mx-auto h-12 w-12 text-gray-300"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                      />
                    </svg>
                    <p className="mt-2 text-sm text-gray-500">
                      No datasets found matching your filters.
                    </p>
                    <button
                      onClick={() => setFilters(DEFAULT_FILTERS)}
                      className="mt-1 text-sm text-blue-600 hover:text-blue-800"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      {metadataDataset && (
        <MetadataModal
          dataset={metadataDataset}
          onClose={() => setMetadataDataset(null)}
        />
      )}
    </div>
  );
}
