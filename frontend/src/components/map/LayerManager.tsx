import { useState } from 'react';
import { Dataset, StyleConfig } from '../../api/types';
import { useDatasetStore } from '../../stores/datasetStore';
import { useMapStore } from '../../stores/mapStore';
import { useAuthStore } from '../../stores/authStore';
import { StyleEditor } from '../styling/StyleEditor';
import { rgbaToString, DEFAULT_STYLE } from '../../utils/styleInterpreter';
import * as datasetsApi from '../../api/datasets';

export function LayerManager() {
  const { datasets, updateDataset } = useDatasetStore();
  const { visibleDatasets, toggleDatasetVisibility } = useMapStore();
  const { user } = useAuthStore();
  const [styleDataset, setStyleDataset] = useState<Dataset | null>(null);

  const visibleDatasetsList = datasets.filter((d) => d.is_visible);

  const handleStyleSave = async (styleConfig: StyleConfig) => {
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

  if (visibleDatasetsList.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 max-w-xs">
        <h3 className="font-semibold text-gray-700 mb-2">Layers</h3>
        <p className="text-gray-500 text-sm">No layers available</p>
      </div>
    );
  }

  return (
    <>
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
              {/* Color swatch */}
              {dataset.data_type === 'vector' && (
                <button
                  onClick={() => setStyleDataset(dataset)}
                  className="w-4 h-4 rounded border border-gray-400 shrink-0 hover:ring-2 hover:ring-blue-300 cursor-pointer"
                  style={{ backgroundColor: getFillColor(dataset) }}
                  title="Change style"
                />
              )}
              <label
                htmlFor={`layer-${dataset.id}`}
                className="flex-1 text-sm text-gray-700 cursor-pointer truncate"
                title={dataset.name}
              >
                {dataset.name}
              </label>
              {/* Style button for admin users on vector layers */}
              {user?.is_admin && dataset.data_type === 'vector' && (
                <button
                  onClick={() => setStyleDataset(dataset)}
                  className="text-gray-400 hover:text-purple-600 shrink-0"
                  title="Edit layer style"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                </button>
              )}
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

      {styleDataset && (
        <StyleEditor
          dataset={styleDataset}
          onSave={handleStyleSave}
          onClose={() => setStyleDataset(null)}
        />
      )}
    </>
  );
}
