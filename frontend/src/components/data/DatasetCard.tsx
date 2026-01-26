import { Dataset } from '../../api/types';

interface Props {
  dataset: Dataset;
  isSelected: boolean;
  onSelect: () => void;
}

export function DatasetCard({ dataset, isSelected, onSelect }: Props) {
  const getGeometryIcon = (type: string | null) => {
    switch (type?.toLowerCase()) {
      case 'point':
      case 'multipoint':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="4" />
          </svg>
        );
      case 'linestring':
      case 'multilinestring':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 20 20">
            <path d="M3 15L10 5L17 12" />
          </svg>
        );
      case 'polygon':
      case 'multipolygon':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <polygon points="10,2 18,18 2,18" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <rect x="3" y="3" width="14" height="14" rx="2" />
          </svg>
        );
    }
  };

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`p-2 rounded ${
            isSelected ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {dataset.data_type === 'raster' ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <rect x="2" y="2" width="7" height="7" />
              <rect x="11" y="2" width="7" height="7" />
              <rect x="2" y="11" width="7" height="7" />
              <rect x="11" y="11" width="7" height="7" />
            </svg>
          ) : (
            getGeometryIcon(dataset.geometry_type)
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate">{dataset.name}</h3>
          {dataset.description && (
            <p className="text-sm text-gray-500 truncate mt-0.5">{dataset.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
              {dataset.data_type}
            </span>
            {dataset.feature_count !== null && (
              <span className="text-xs text-gray-500">
                {dataset.feature_count.toLocaleString()} features
              </span>
            )}
            {dataset.is_public && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                Public
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
