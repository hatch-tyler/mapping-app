import { useState, useEffect } from 'react';
import { Dataset, StyleConfig, StyleMode } from '../../api/types';
import { DEFAULT_STYLE } from '../../utils/styleInterpreter';
import { downloadStyleExport } from '../../api/templates';
import { UniformStylePanel } from './UniformStylePanel';
import { CategoricalStylePanel } from './CategoricalStylePanel';
import { GraduatedStylePanel } from './GraduatedStylePanel';
import { DisplayStylePanel } from './DisplayStylePanel';

interface Props {
  dataset: Dataset;
  /** Apply the new style locally only (no API call). When provided,
   *  shows an "Apply" button — useful on the map view so viewers can
   *  preview a style for their session. Omit this on pages without a
   *  live map (e.g. the admin Datasets table) to avoid a button that
   *  has no visible effect. */
  onApply?: (styleConfig: StyleConfig) => void;
  /** Persist the new style for everyone via PUT /datasets/{id}.
   *  Pass undefined for users without editor/admin role; the Save
   *  button will be hidden and a small caption explains why. */
  onSave?: (styleConfig: StyleConfig) => Promise<void> | void;
  onClose: () => void;
}

type TabId = StyleMode | 'display';

const TABS: { id: TabId; label: string; description: string }[] = [
  { id: 'uniform', label: 'Uniform', description: 'Same color for all features' },
  { id: 'categorical', label: 'Categorical', description: 'Color by field values' },
  { id: 'graduated', label: 'Graduated', description: 'Color ramp by numeric values' },
  { id: 'display', label: 'Display', description: 'Tooltip fields and map labels' },
];

export function StyleEditor({ dataset, onApply, onSave, onClose }: Props) {
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(() => {
    const existing = dataset.style_config as Partial<StyleConfig> || {};
    return {
      ...DEFAULT_STYLE,
      ...existing,
      mode: existing.mode || 'uniform',
    };
  });

  const [activeTab, setActiveTab] = useState<TabId>(styleConfig.mode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (activeTab !== 'display' && styleConfig.mode !== activeTab) {
      setStyleConfig({ ...styleConfig, mode: activeTab as StyleMode });
    }
  }, [activeTab]);

  const handleApply = () => {
    onApply?.(styleConfig);
    onClose();
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(styleConfig);
      onApply?.(styleConfig);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setStyleConfig({
      ...DEFAULT_STYLE,
      mode: activeTab === 'display' ? styleConfig.mode : (activeTab as StyleMode),
    });
  };

  const canSave = !!onSave;
  const canApply = !!onApply;

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

          {activeTab === 'display' && (
            <DisplayStylePanel
              datasetId={dataset.id}
              styleConfig={styleConfig}
              onChange={setStyleConfig}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 shrink-0">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                Reset
              </button>
              <div className="relative group">
                <button className="px-3 py-2 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">
                  Export Style
                </button>
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:flex flex-col bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[120px] z-50">
                  <button onClick={() => downloadStyleExport(dataset.id, 'sld')} className="px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left">SLD (OGC)</button>
                  <button onClick={() => downloadStyleExport(dataset.id, 'lyrx')} className="px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left">LYRX (ArcGIS Pro)</button>
                  <button onClick={() => downloadStyleExport(dataset.id, 'qml')} className="px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left">QML (QGIS)</button>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Cancel
              </button>
              {canApply && (
                <button
                  onClick={handleApply}
                  disabled={saving}
                  className={`px-4 py-2 text-sm font-medium rounded-md ${
                    canSave
                      ? 'text-blue-700 border border-blue-300 hover:bg-blue-50'
                      : 'text-white bg-blue-600 hover:bg-blue-700'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  title="Apply locally to your map for this session"
                >
                  Apply
                </button>
              )}
              {canSave && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                    saving
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                  title="Save the style so it persists for everyone"
                >
                  {saving ? 'Saving...' : 'Save for everyone'}
                </button>
              )}
            </div>
          </div>
          {!canSave && canApply && (
            <p className="mt-2 text-xs text-gray-500 text-right">
              Apply changes the style for your session only. Saving for
              all users requires editor or admin access.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
