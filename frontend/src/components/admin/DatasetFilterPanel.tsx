import { useState } from 'react';
import { DatasetFilters, DatasetCategory, GeographicScope } from '../../api/types';

interface DatasetFilterPanelProps {
  filters: DatasetFilters;
  onChange: (filters: DatasetFilters) => void;
}

export function DatasetFilterPanel({ filters, onChange }: DatasetFilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeCount = Object.values(filters).filter(
    (v) => v !== undefined && v !== ''
  ).length - (filters.search ? 1 : 0); // Don't count search in filter badge

  const updateFilter = (key: keyof DatasetFilters, value: string | undefined) => {
    const updated = { ...filters, [key]: value || undefined };
    // Clear geographic_scope when switching away from reference
    if (key === 'category' && value !== 'reference') {
      updated.geographic_scope = undefined;
    }
    onChange(updated);
  };

  const clearFilters = () => {
    onChange({ search: filters.search }); // Keep search, clear rest
  };

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
      >
        <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
            {activeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="mt-2 p-4 bg-gray-50 border border-gray-200 rounded-md">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={filters.category || ''}
                onChange={(e) => updateFilter('category', e.target.value as DatasetCategory)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="reference">Reference</option>
                <option value="project">Project</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
              <select
                value={filters.source_type || ''}
                onChange={(e) => updateFilter('source_type', e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="local">Local</option>
                <option value="external">External</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Scope</label>
              <select
                value={filters.geographic_scope || ''}
                onChange={(e) => updateFilter('geographic_scope', e.target.value as GeographicScope)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="federal">Federal</option>
                <option value="state">State</option>
                <option value="county">County</option>
                <option value="local">Local</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select
                value={filters.data_type || ''}
                onChange={(e) => updateFilter('data_type', e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="vector">Vector</option>
                <option value="raster">Raster</option>
              </select>
            </div>
          </div>

          {activeCount > 0 && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={clearFilters}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
