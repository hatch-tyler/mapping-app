import { useState, useEffect, useMemo } from 'react';
import { Dataset } from '../../api/types';
import { getBrowsableDatasets } from '../../api/datasets';
import { DatasetCard } from './DatasetCard';

interface Props {
  selectedDataset: Dataset | null;
  onSelectDataset: (dataset: Dataset) => void;
}

export function DatasetList({ selectedDataset, onSelectDataset }: Props) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    async function fetchDatasets() {
      try {
        setLoading(true);
        const response = await getBrowsableDatasets(0, 500);
        setDatasets(response.datasets);
        setError(null);
      } catch (err) {
        setError('Failed to load datasets');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchDatasets();
  }, []);

  const filteredDatasets = useMemo(() => {
    if (!searchQuery.trim()) {
      return datasets;
    }
    const query = searchQuery.toLowerCase();
    return datasets.filter(
      (d) =>
        d.name.toLowerCase().includes(query) ||
        d.description?.toLowerCase().includes(query)
    );
  }, [datasets, searchQuery]);

  // Only show vector datasets (tabular data)
  const vectorDatasets = useMemo(
    () => filteredDatasets.filter((d) => d.data_type === 'vector'),
    [filteredDatasets]
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-600 mb-2">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-4 border-b border-gray-200">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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
            placeholder="Search datasets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Dataset List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {vectorDatasets.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {searchQuery ? 'No datasets match your search' : 'No datasets available'}
          </div>
        ) : (
          vectorDatasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              isSelected={selectedDataset?.id === dataset.id}
              onSelect={() => onSelectDataset(dataset)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 text-sm text-gray-500">
        {vectorDatasets.length} dataset{vectorDatasets.length !== 1 ? 's' : ''} available
      </div>
    </div>
  );
}
