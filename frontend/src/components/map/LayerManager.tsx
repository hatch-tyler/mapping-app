import { useDatasetStore } from '../../stores/datasetStore';
import { useMapStore } from '../../stores/mapStore';

export function LayerManager() {
  const { datasets } = useDatasetStore();
  const { visibleDatasets, toggleDatasetVisibility } = useMapStore();

  const visibleDatasetsList = datasets.filter((d) => d.is_visible);

  if (visibleDatasetsList.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 max-w-xs">
        <h3 className="font-semibold text-gray-700 mb-2">Layers</h3>
        <p className="text-gray-500 text-sm">No layers available</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 max-w-xs max-h-96 overflow-y-auto">
      <h3 className="font-semibold text-gray-700 mb-3">Layers</h3>
      <ul className="space-y-2">
        {visibleDatasetsList.map((dataset) => (
          <li key={dataset.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`layer-${dataset.id}`}
              checked={visibleDatasets.has(dataset.id)}
              onChange={() => toggleDatasetVisibility(dataset.id)}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <label
              htmlFor={`layer-${dataset.id}`}
              className="flex-1 text-sm text-gray-700 cursor-pointer truncate"
              title={dataset.name}
            >
              {dataset.name}
            </label>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                dataset.data_type === 'vector'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              {dataset.data_type}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
