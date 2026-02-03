import { useState, useEffect } from 'react';
import { Dataset, StyleConfig, StyleMode } from '../../api/types';
import { DEFAULT_STYLE } from '../../utils/styleInterpreter';
import { UniformStylePanel } from './UniformStylePanel';
import { CategoricalStylePanel } from './CategoricalStylePanel';
import { GraduatedStylePanel } from './GraduatedStylePanel';

interface Props {
  dataset: Dataset;
  onSave: (styleConfig: StyleConfig) => void;
  onClose: () => void;
}

const TABS: { id: StyleMode; label: string; description: string }[] = [
  { id: 'uniform', label: 'Uniform', description: 'Same color for all features' },
  { id: 'categorical', label: 'Categorical', description: 'Color by field values' },
  { id: 'graduated', label: 'Graduated', description: 'Color ramp by numeric values' },
];

export function StyleEditor({ dataset, onSave, onClose }: Props) {
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(() => {
    // Initialize from existing style_config or defaults
    const existing = dataset.style_config as Partial<StyleConfig> || {};
    return {
      ...DEFAULT_STYLE,
      ...existing,
      mode: existing.mode || 'uniform',
    };
  });

  const [activeTab, setActiveTab] = useState<StyleMode>(styleConfig.mode);
  const [saving, setSaving] = useState(false);

  // Sync mode with active tab
  useEffect(() => {
    if (styleConfig.mode !== activeTab) {
      setStyleConfig({ ...styleConfig, mode: activeTab });
    }
  }, [activeTab]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(styleConfig);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setStyleConfig({
      ...DEFAULT_STYLE,
      mode: activeTab,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Layer Style</h2>
            <p className="text-sm text-gray-500 mt-0.5">{dataset.name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 shrink-0">
          <div className="flex border-b border-gray-200">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                title={tab.description}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {activeTab === 'uniform' && (
            <UniformStylePanel
              styleConfig={styleConfig}
              onChange={setStyleConfig}
              geometryType={dataset.geometry_type}
            />
          )}

          {activeTab === 'categorical' && (
            <CategoricalStylePanel
              datasetId={dataset.id}
              styleConfig={styleConfig}
              onChange={setStyleConfig}
            />
          )}

          {activeTab === 'graduated' && (
            <GraduatedStylePanel
              datasetId={dataset.id}
              styleConfig={styleConfig}
              onChange={setStyleConfig}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between shrink-0">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            Reset to Default
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                saving
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {saving ? 'Saving...' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
