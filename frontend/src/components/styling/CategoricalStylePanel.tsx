import { useState, useEffect } from 'react';
import { StyleConfig, FieldMetadata, RGBAColor } from '../../api/types';
import { ColorPicker } from './ColorPicker';
import { getCategoryColor } from '../../utils/colorRamps';
import { getDatasetFields, getUniqueValues } from '../../api/datasets';

interface Props {
  datasetId: string;
  styleConfig: StyleConfig;
  onChange: (config: StyleConfig) => void;
}

export function CategoricalStylePanel({ datasetId, styleConfig, onChange }: Props) {
  const [fields, setFields] = useState<FieldMetadata[]>([]);
  const [uniqueValues, setUniqueValues] = useState<(string | number | boolean | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingValues, setLoadingValues] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Load unique values when field changes
  useEffect(() => {
    async function loadUniqueValues() {
      if (!styleConfig.attributeField) {
        setUniqueValues([]);
        return;
      }

      setLoadingValues(true);
      try {
        const response = await getUniqueValues(datasetId, styleConfig.attributeField);
        setUniqueValues(response.values);

        // Auto-assign colors if no categoryColors set
        if (!styleConfig.categoryColors || Object.keys(styleConfig.categoryColors).length === 0) {
          const newCategoryColors: Record<string, RGBAColor> = {};
          response.values.forEach((value, index) => {
            const key = String(value ?? 'null');
            newCategoryColors[key] = getCategoryColor(index);
          });
          onChange({
            ...styleConfig,
            categoryColors: newCategoryColors,
          });
        }
      } catch (err) {
        console.error('Failed to load unique values:', err);
      } finally {
        setLoadingValues(false);
      }
    }
    loadUniqueValues();
  }, [datasetId, styleConfig.attributeField]);

  const handleFieldChange = (fieldName: string) => {
    onChange({
      ...styleConfig,
      attributeField: fieldName,
      categoryColors: {}, // Reset colors when field changes
    });
  };

  const handleCategoryColorChange = (key: string, color: RGBAColor) => {
    onChange({
      ...styleConfig,
      categoryColors: {
        ...styleConfig.categoryColors,
        [key]: color,
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
    return (
      <div className="text-red-600 py-4">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Field Selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Color by Field
        </label>
        <select
          value={styleConfig.attributeField || ''}
          onChange={(e) => handleFieldChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select a field...</option>
          {fields.map((field) => (
            <option key={field.name} value={field.name}>
              {field.name} ({field.field_type})
            </option>
          ))}
        </select>
      </div>

      {/* Default Color */}
      <ColorPicker
        label="Default Color (unmatched values)"
        color={styleConfig.defaultCategoryColor || styleConfig.fillColor}
        onChange={(color) => onChange({ ...styleConfig, defaultCategoryColor: color })}
      />

      {/* Category Colors */}
      {styleConfig.attributeField && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Category Colors
          </label>

          {loadingValues ? (
            <div className="flex items-center py-4">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span className="ml-2 text-sm text-gray-600">Loading values...</span>
            </div>
          ) : uniqueValues.length === 0 ? (
            <p className="text-sm text-gray-500">No unique values found</p>
          ) : (
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-md">
              {uniqueValues.slice(0, 50).map((value, index) => {
                const key = String(value ?? 'null');
                const color = styleConfig.categoryColors?.[key] || getCategoryColor(index);
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0"
                  >
                    <input
                      type="color"
                      value={`#${color.slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('')}`}
                      onChange={(e) => {
                        const hex = e.target.value;
                        const r = parseInt(hex.slice(1, 3), 16);
                        const g = parseInt(hex.slice(3, 5), 16);
                        const b = parseInt(hex.slice(5, 7), 16);
                        handleCategoryColorChange(key, [r, g, b, color[3]]);
                      }}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                    />
                    <span className="flex-1 text-sm text-gray-700 truncate" title={key}>
                      {value === null ? '(null)' : key}
                    </span>
                  </div>
                );
              })}
              {uniqueValues.length > 50 && (
                <div className="px-3 py-2 text-sm text-gray-500 bg-gray-50">
                  ...and {uniqueValues.length - 50} more values
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
