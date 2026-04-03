import { useState, useEffect } from 'react';
import { Dataset, RasterStyleConfig, RasterBandStatistics, RGBAColor, RasterMode } from '../../api/types';
import { getRasterStats } from '../../api/datasets';
import { COLOR_RAMPS, generateRampPreview, getCategoryColor } from '../../utils/colorRamps';

interface Props {
  dataset: Dataset;
  onSave: (styleConfig: RasterStyleConfig) => void;
  onClose: () => void;
}

function ColorRampPreview({ rampName, selected, onClick }: { rampName: string; selected: boolean; onClick: () => void }) {
  const colors = generateRampPreview(rampName, 40);
  const gradient = colors.map((c, i) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255}) ${((i / (colors.length - 1)) * 100).toFixed(0)}%`).join(', ');

  return (
    <button
      onClick={onClick}
      className={`w-full h-6 rounded border-2 transition-all ${selected ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-300 hover:border-gray-400'}`}
      style={{ background: `linear-gradient(to right, ${gradient})` }}
      title={rampName}
    />
  );
}

export function RasterStyleEditor({ dataset, onSave, onClose }: Props) {
  const existing = dataset.style_config as Partial<RasterStyleConfig> | undefined;

  const [mode, setMode] = useState<RasterMode>(existing?.raster_mode || 'continuous');
  const [colorRamp, setColorRamp] = useState(existing?.color_ramp || 'viridis');
  const [minValue, setMinValue] = useState<string>(existing?.min_value?.toString() ?? '');
  const [maxValue, setMaxValue] = useState<string>(existing?.max_value?.toString() ?? '');
  const [valueMap, setValueMap] = useState<Record<string, { color: RGBAColor; label: string }>>(
    existing?.value_map || {}
  );
  const [stats, setStats] = useState<RasterBandStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRasterStats(dataset.id)
      .then((s) => {
        if (cancelled) return;
        setStats(s);

        // Auto-populate min/max if not set
        if (!existing?.min_value && s.min != null) setMinValue(s.min.toString());
        if (!existing?.max_value && s.max != null) setMaxValue(s.max.toString());

        // Auto-detect mode: if few unique values, suggest classified
        if (!existing?.raster_mode && s.unique_values && s.unique_values.length <= 20) {
          setMode('classified');
          // Auto-build value_map if not already set
          if (!existing?.value_map || Object.keys(existing.value_map).length === 0) {
            const map: Record<string, { color: RGBAColor; label: string }> = {};
            s.unique_values.forEach((v, i) => {
              const key = v.toString();
              // Use RAT labels if available
              const ratLabel = s.rat?.[key]?.label;
              map[key] = {
                color: getCategoryColor(i),
                label: ratLabel || `Class ${v}`,
              };
            });
            setValueMap(map);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load raster stats:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dataset.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const config: RasterStyleConfig = {
        raster_mode: mode,
        band: 1,
        nodata_transparent: true,
      };
      if (mode === 'continuous') {
        config.color_ramp = colorRamp;
        if (minValue !== '') config.min_value = parseFloat(minValue);
        if (maxValue !== '') config.max_value = parseFloat(maxValue);
      } else {
        config.value_map = valueMap;
      }
      await onSave(config);
    } finally {
      setSaving(false);
    }
  };

  const updateValueColor = (key: string, color: string) => {
    // Parse hex to RGBA
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    setValueMap((prev) => ({
      ...prev,
      [key]: { ...prev[key], color: [r, g, b, 255] },
    }));
  };

  const updateValueLabel = (key: string, label: string) => {
    setValueMap((prev) => ({
      ...prev,
      [key]: { ...prev[key], label },
    }));
  };

  const rgbaToHex = (c: RGBAColor): string => {
    return '#' + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Raster Style</h2>
            <p className="text-sm text-gray-500 mt-0.5">{dataset.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
              <span className="ml-2 text-sm text-gray-500">Loading raster statistics...</span>
            </div>
          ) : (
            <>
              {/* Stats info */}
              {stats && (
                <div className="text-xs text-gray-500 bg-gray-50 rounded p-2 space-y-0.5">
                  <div>Type: {stats.dtype} | Range: {stats.min?.toFixed(2)} - {stats.max?.toFixed(2)}</div>
                  {stats.unique_values && <div>Unique values: {stats.unique_values.length}</div>}
                  {stats.nodata_value != null && <div>NoData: {stats.nodata_value}</div>}
                </div>
              )}

              {/* Mode tabs */}
              <div className="flex border-b border-gray-200">
                {(['continuous', 'classified'] as RasterMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      mode === m
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {m === 'continuous' ? 'Continuous' : 'Classified'}
                  </button>
                ))}
              </div>

              {/* Continuous mode */}
              {mode === 'continuous' && (
                <div className="space-y-4">
                  {/* Color ramp selection */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Color Ramp</label>
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500">Sequential</p>
                      <div className="grid grid-cols-3 gap-2">
                        {COLOR_RAMPS.filter((r) => r.type === 'sequential').map((ramp) => (
                          <div key={ramp.name} className="space-y-0.5">
                            <ColorRampPreview
                              rampName={ramp.name}
                              selected={colorRamp === ramp.name}
                              onClick={() => setColorRamp(ramp.name)}
                            />
                            <p className="text-[10px] text-center text-gray-400">{ramp.label}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">Diverging</p>
                      <div className="grid grid-cols-3 gap-2">
                        {COLOR_RAMPS.filter((r) => r.type === 'diverging').map((ramp) => (
                          <div key={ramp.name} className="space-y-0.5">
                            <ColorRampPreview
                              rampName={ramp.name}
                              selected={colorRamp === ramp.name}
                              onClick={() => setColorRamp(ramp.name)}
                            />
                            <p className="text-[10px] text-center text-gray-400">{ramp.label}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">Colorblind-safe</p>
                      <div className="grid grid-cols-3 gap-2">
                        {COLOR_RAMPS.filter((r) => r.type === 'colorblind-safe').map((ramp) => (
                          <div key={ramp.name} className="space-y-0.5">
                            <ColorRampPreview
                              rampName={ramp.name}
                              selected={colorRamp === ramp.name}
                              onClick={() => setColorRamp(ramp.name)}
                            />
                            <p className="text-[10px] text-center text-gray-400">{ramp.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Min/Max */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Min Value</label>
                      <input
                        type="number"
                        value={minValue}
                        onChange={(e) => setMinValue(e.target.value)}
                        placeholder={stats?.min?.toString() || '0'}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Max Value</label>
                      <input
                        type="number"
                        value={maxValue}
                        onChange={(e) => setMaxValue(e.target.value)}
                        placeholder={stats?.max?.toString() || '255'}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {stats && (
                    <button
                      onClick={() => {
                        if (stats.min != null) setMinValue(stats.min.toString());
                        if (stats.max != null) setMaxValue(stats.max.toString());
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Reset to data range ({stats.min} - {stats.max})
                    </button>
                  )}
                </div>
              )}

              {/* Classified mode */}
              {mode === 'classified' && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700">Value Classes</label>
                  {Object.keys(valueMap).length === 0 && (
                    <p className="text-sm text-gray-500">No classes defined. Stats show {stats?.unique_values?.length || 0} unique values.</p>
                  )}
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {Object.entries(valueMap)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([key, entry]) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-8 text-right shrink-0">{key}</span>
                          <input
                            type="color"
                            value={rgbaToHex(entry.color)}
                            onChange={(e) => updateValueColor(key, e.target.value)}
                            className="w-8 h-8 rounded border border-gray-300 cursor-pointer shrink-0"
                          />
                          <input
                            type="text"
                            value={entry.label}
                            onChange={(e) => updateValueLabel(key, e.target.value)}
                            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                          />
                        </div>
                      ))}
                  </div>
                  {stats?.unique_values && Object.keys(valueMap).length === 0 && (
                    <button
                      onClick={() => {
                        const map: Record<string, { color: RGBAColor; label: string }> = {};
                        stats.unique_values!.forEach((v, i) => {
                          const key = v.toString();
                          const ratLabel = stats.rat?.[key]?.label;
                          map[key] = {
                            color: getCategoryColor(i),
                            label: ratLabel || `Class ${v}`,
                          };
                        });
                        setValueMap(map);
                      }}
                      className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                    >
                      Auto-generate classes from data
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Apply Style'}
          </button>
        </div>
      </div>
    </div>
  );
}
