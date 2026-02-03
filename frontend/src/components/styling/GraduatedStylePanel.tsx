import { useState, useEffect } from 'react';
import { StyleConfig, FieldMetadata, ColorRampConfig } from '../../api/types';
import { COLOR_RAMPS, generateRampPreview } from '../../utils/colorRamps';
import { getDatasetFields, getFieldStatistics } from '../../api/datasets';

interface Props {
  datasetId: string;
  styleConfig: StyleConfig;
  onChange: (config: StyleConfig) => void;
}

function ColorRampPreview({ rampName, selected, onClick }: { rampName: string; selected: boolean; onClick: () => void }) {
  const colors = generateRampPreview(rampName, 20);
  const ramp = COLOR_RAMPS.find(r => r.name === rampName);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 p-2 rounded-md border-2 transition-colors ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div
        className="h-4 w-full rounded"
        style={{
          background: `linear-gradient(to right, ${colors.map((c, i) =>
            `rgba(${c[0]},${c[1]},${c[2]},1) ${(i / (colors.length - 1)) * 100}%`
          ).join(', ')})`,
        }}
      />
      <span className="text-xs text-gray-600">{ramp?.label || rampName}</span>
    </button>
  );
}

export function GraduatedStylePanel({ datasetId, styleConfig, onChange }: Props) {
  const [fields, setFields] = useState<FieldMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter to only numeric fields
  const numericFields = fields.filter((f) => f.field_type === 'number');

  // Load fields on mount
  useEffect(() => {
    async function loadFields() {
      setLoading(true);
      setError(null);
      try {
        const response = await getDatasetFields(datasetId);
        setFields(response.fields);
      } catch (err) {
        setError('Failed to load fields');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadFields();
  }, [datasetId]);

  // Load statistics when field changes
  useEffect(() => {
    async function loadStats() {
      if (!styleConfig.attributeField) {
        return;
      }

      setLoadingStats(true);
      try {
        const stats = await getFieldStatistics(datasetId, styleConfig.attributeField);

        // Auto-set min/max if not already set
        const currentRamp = styleConfig.colorRamp || { name: 'viridis' };
        if (currentRamp.minValue === undefined || currentRamp.maxValue === undefined) {
          onChange({
            ...styleConfig,
            colorRamp: {
              ...currentRamp,
              minValue: stats.min ?? 0,
              maxValue: stats.max ?? 100,
            },
          });
        }
      } catch (err) {
        console.error('Failed to load field statistics:', err);
      } finally {
        setLoadingStats(false);
      }
    }
    loadStats();
  }, [datasetId, styleConfig.attributeField]);

  const handleFieldChange = (fieldName: string) => {
    onChange({
      ...styleConfig,
      attributeField: fieldName,
      colorRamp: {
        name: styleConfig.colorRamp?.name || 'viridis',
        minValue: undefined,
        maxValue: undefined,
      },
    });
  };

  const handleRampChange = (rampName: string) => {
    onChange({
      ...styleConfig,
      colorRamp: {
        ...styleConfig.colorRamp,
        name: rampName,
      } as ColorRampConfig,
    });
  };

  const handleMinChange = (value: string) => {
    const numValue = parseFloat(value);
    onChange({
      ...styleConfig,
      colorRamp: {
        ...styleConfig.colorRamp,
        name: styleConfig.colorRamp?.name || 'viridis',
        minValue: isNaN(numValue) ? undefined : numValue,
      },
    });
  };

  const handleMaxChange = (value: string) => {
    const numValue = parseFloat(value);
    onChange({
      ...styleConfig,
      colorRamp: {
        ...styleConfig.colorRamp,
        name: styleConfig.colorRamp?.name || 'viridis',
        maxValue: isNaN(numValue) ? undefined : numValue,
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading fields...</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-600 py-4">{error}</div>;
  }

  const currentRampName = styleConfig.colorRamp?.name || 'viridis';

  return (
    <div className="space-y-6">
      {/* Field Selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Color by Numeric Field
        </label>
        {numericFields.length === 0 ? (
          <p className="text-sm text-amber-600">
            No numeric fields available in this dataset.
          </p>
        ) : (
          <select
            value={styleConfig.attributeField || ''}
            onChange={(e) => handleFieldChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a field...</option>
            {numericFields.map((field) => (
              <option key={field.name} value={field.name}>
                {field.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Color Ramp Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Color Ramp</label>

        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500 mb-2">Sequential</p>
            <div className="grid grid-cols-3 gap-2">
              {COLOR_RAMPS.filter((r) => r.type === 'sequential').map((ramp) => (
                <ColorRampPreview
                  key={ramp.name}
                  rampName={ramp.name}
                  selected={currentRampName === ramp.name}
                  onClick={() => handleRampChange(ramp.name)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">Diverging</p>
            <div className="grid grid-cols-3 gap-2">
              {COLOR_RAMPS.filter((r) => r.type === 'diverging').map((ramp) => (
                <ColorRampPreview
                  key={ramp.name}
                  rampName={ramp.name}
                  selected={currentRampName === ramp.name}
                  onClick={() => handleRampChange(ramp.name)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Min/Max Range */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Value Range
          {loadingStats && (
            <span className="ml-2 text-xs text-gray-500">(loading statistics...)</span>
          )}
        </label>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Min Value</label>
            <input
              type="number"
              value={styleConfig.colorRamp?.minValue ?? ''}
              onChange={(e) => handleMinChange(e.target.value)}
              placeholder="Auto"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Max Value</label>
            <input
              type="number"
              value={styleConfig.colorRamp?.maxValue ?? ''}
              onChange={(e) => handleMaxChange(e.target.value)}
              placeholder="Auto"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Preview */}
      {styleConfig.attributeField && styleConfig.colorRamp && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Preview</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {styleConfig.colorRamp.minValue ?? 'min'}
            </span>
            <div
              className="flex-1 h-6 rounded"
              style={{
                background: `linear-gradient(to right, ${generateRampPreview(currentRampName, 20)
                  .map(
                    (c, i, arr) =>
                      `rgba(${c[0]},${c[1]},${c[2]},1) ${(i / (arr.length - 1)) * 100}%`
                  )
                  .join(', ')})`,
              }}
            />
            <span className="text-xs text-gray-500">
              {styleConfig.colorRamp.maxValue ?? 'max'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
