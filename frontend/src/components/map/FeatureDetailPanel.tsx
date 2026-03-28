import { useMapStore } from '@/stores/mapStore';

interface FeatureProperties {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

export function FeatureDetailPanel() {
  const { selectedFeature, setSelectedFeature } = useMapStore();

  if (!selectedFeature) return null;

  const feature = selectedFeature as FeatureProperties;
  const props = feature.properties || {};

  // Filter out internal/geometry fields
  const entries = Object.entries(props).filter(
    ([key]) => !['cluster', 'cluster_id', 'point_count', 'point_count_abbreviated'].includes(key)
  );

  if (entries.length === 0) return null;

  return (
    <div className="absolute top-12 right-0 bottom-0 w-[320px] bg-white/95 backdrop-blur-sm border-l border-gray-200 z-10 flex flex-col shadow-lg">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">Feature Attributes</h3>
        <button
          onClick={() => setSelectedFeature(null)}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          title="Close"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Attribute list */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <table className="w-full text-sm">
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-b border-gray-100 last:border-0">
                <td className="py-1.5 pr-3 text-gray-500 font-medium align-top whitespace-nowrap text-xs">
                  {key}
                </td>
                <td className="py-1.5 text-gray-900 break-words text-xs">
                  {formatValue(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-200 shrink-0">
        <p className="text-[10px] text-gray-400">
          {entries.length} attribute{entries.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}
