import { useMemo } from 'react';
import { Dataset, DatasetCategory, GeographicScope, SourceType } from '@/api/types';

export interface CatalogFilterState {
  search: string;
  category: DatasetCategory | '';
  dataType: 'vector' | 'raster' | '';
  sourceType: SourceType | '';
  geographicScope: GeographicScope | '';
  projectId: string;
  tag: string;
}

export const DEFAULT_FILTERS: CatalogFilterState = {
  search: '',
  category: '',
  dataType: '',
  sourceType: '',
  geographicScope: '',
  projectId: '',
  tag: '',
};

interface CatalogFiltersProps {
  filters: CatalogFilterState;
  onChange: (filters: CatalogFilterState) => void;
  datasets: Dataset[];
}

export function CatalogFilters({ filters, onChange, datasets }: CatalogFiltersProps) {
  const uniqueProjects = useMemo(() => {
    const projects = new Map<string, string>();
    for (const ds of datasets) {
      if (ds.project_id && ds.project_name) {
        projects.set(ds.project_id, ds.project_name);
      }
    }
    return Array.from(projects.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [datasets]);

  const uniqueTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const ds of datasets) {
      if (ds.tags) {
        for (const tag of ds.tags) {
          tagSet.add(tag);
        }
      }
    }
    return Array.from(tagSet).sort();
  }, [datasets]);

  const update = (partial: Partial<CatalogFilterState>) => {
    onChange({ ...filters, ...partial });
  };

  const hasActiveFilters =
    filters.search !== '' ||
    filters.dataType !== '' ||
    filters.sourceType !== '' ||
    filters.geographicScope !== '' ||
    filters.projectId !== '' ||
    filters.tag !== '';

  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
        Filters
      </h2>

      {/* Search */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
        <div className="relative">
          <svg
            className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Search datasets..."
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          {filters.search && (
            <button
              onClick={() => update({ search: '' })}
              className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Data Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Data Type</label>
        <div className="space-y-1">
          {([['', 'All'], ['vector', 'Vector'], ['raster', 'Raster']] as const).map(
            ([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="dataType"
                  checked={filters.dataType === value}
                  onChange={() => update({ dataType: value })}
                  className="text-blue-600 focus:ring-blue-500"
                />
                {label}
              </label>
            )
          )}
        </div>
      </div>

      {/* Source */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Source</label>
        <div className="space-y-1">
          {([['', 'All'], ['local', 'Local'], ['external', 'External']] as const).map(
            ([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="sourceType"
                  checked={filters.sourceType === value}
                  onChange={() => update({ sourceType: value })}
                  className="text-blue-600 focus:ring-blue-500"
                />
                {label}
              </label>
            )
          )}
        </div>
      </div>

      {/* Geographic Scope */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Geographic Scope
        </label>
        <select
          value={filters.geographicScope}
          onChange={(e) => update({ geographicScope: e.target.value as GeographicScope | '' })}
          className="w-full py-2 px-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Scopes</option>
          <option value="federal">Federal</option>
          <option value="state">State</option>
          <option value="county">County</option>
          <option value="local">Local</option>
        </select>
      </div>

      {/* Project */}
      {uniqueProjects.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
          <select
            value={filters.projectId}
            onChange={(e) => update({ projectId: e.target.value })}
            className="w-full py-2 px-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Projects</option>
            {uniqueProjects.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tags */}
      {uniqueTags.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {uniqueTags.map((tag) => (
              <button
                key={tag}
                onClick={() => update({ tag: filters.tag === tag ? '' : tag })}
                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                  filters.tag === tag
                    ? 'bg-blue-100 border-blue-300 text-blue-800'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Clear All */}
      {hasActiveFilters && (
        <button
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="w-full py-2 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors border border-red-200"
        >
          Clear All Filters
        </button>
      )}
    </div>
  );
}
