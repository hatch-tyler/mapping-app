import { useState, useEffect } from 'react';
import { StyleConfig, FieldMetadata, RGBAColor } from '../../api/types';
import { getDatasetFields } from '../../api/datasets';
import { ColorPicker } from './ColorPicker';

interface Props {
  datasetId: string;
  styleConfig: StyleConfig;
  onChange: (config: StyleConfig) => void;
}

export function DisplayStylePanel({ datasetId, styleConfig, onChange }: Props) {
  const [fields, setFields] = useState<FieldMetadata[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getDatasetFields(datasetId)
      .then((r) => setFields(r.fields))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [datasetId]);

  const hoverFields = styleConfig.hoverFields || [];

  function toggleHoverField(fieldName: string) {
    const current = new Set(hoverFields);
    if (current.has(fieldName)) current.delete(fieldName);
    else current.add(fieldName);
    onChange({ ...styleConfig, hoverFields: [...current] });
  }

  function selectAllHover() {
    onChange({ ...styleConfig, hoverFields: fields.map((f) => f.name) });
  }

  function clearAllHover() {
    onChange({ ...styleConfig, hoverFields: [] });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
        <span className="ml-2 text-gray-600">Loading fields...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hover Fields */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">
            Hover Tooltip Fields
          </label>
          <div className="flex gap-2">
            <button onClick={selectAllHover} className="text-xs text-blue-600 hover:underline">All</button>
            <button onClick={clearAllHover} className="text-xs text-blue-600 hover:underline">None</button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Select which fields appear when hovering over features. Leave empty to show the first 5 fields.
        </p>
        <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md">
          {fields.map((field) => (
            <label
              key={field.name}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={hoverFields.includes(field.name)}
                onChange={() => toggleHoverField(field.name)}
                className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="text-gray-700">{field.name}</span>
              <span className="text-gray-400 text-xs">({field.field_type})</span>
            </label>
          ))}
          {fields.length === 0 && (
            <p className="text-xs text-gray-400 px-3 py-2">No fields available</p>
          )}
        </div>
        {hoverFields.length > 0 && (
          <p className="text-xs text-gray-500">
            {hoverFields.length} field{hoverFields.length !== 1 ? 's' : ''} selected
          </p>
        )}
      </div>

      {/* Label Field */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Map Label Field
        </label>
        <p className="text-xs text-gray-500">
          Select a field to display as text labels on the map.
        </p>
        <select
          value={styleConfig.labelField || ''}
          onChange={(e) =>
            onChange({
              ...styleConfig,
              labelField: e.target.value || undefined,
            })
          }
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">None (no labels)</option>
          {fields.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {/* Label appearance — only shown when a label field is selected */}
      {styleConfig.labelField && (
        <div className="space-y-4 pl-3 border-l-2 border-blue-200">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Label Size (pixels)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="8"
                max="24"
                step="1"
                value={styleConfig.labelSize || 12}
                onChange={(e) =>
                  onChange({ ...styleConfig, labelSize: parseInt(e.target.value, 10) })
                }
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-sm text-gray-600 w-12 text-right">
                {styleConfig.labelSize || 12}px
              </span>
            </div>
          </div>

          <ColorPicker
            label="Label Color"
            color={styleConfig.labelColor || [0, 0, 0, 255]}
            onChange={(color: RGBAColor) => onChange({ ...styleConfig, labelColor: color })}
          />
        </div>
      )}
    </div>
  );
}
