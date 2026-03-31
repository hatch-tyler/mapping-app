import { useState, useCallback } from 'react';
import { LayerManager } from './LayerManager';
import { LegendPanel } from './LegendPanel';
import { BasemapGallery } from './BasemapGallery';
import { useMapStore } from '@/stores/mapStore';
import { useToastStore } from '@/stores/toastStore';
import * as templatesApi from '@/api/templates';

type PanelType = 'layers' | 'legend' | 'basemap' | null;

export function MapToolbar() {
  const [activePanel, setActivePanel] = useState<PanelType>('layers');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  const togglePanel = (panel: PanelType) => {
    setActivePanel((current) => (current === panel ? null : panel));
  };

  const handleSaveView = useCallback(async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const { viewState, visibleDatasets, currentBasemap } = useMapStore.getState();
      await templatesApi.createMapView({
        name: saveName.trim(),
        map_config: {
          zoom: viewState.zoom,
          latitude: viewState.latitude,
          longitude: viewState.longitude,
          bearing: viewState.bearing,
          pitch: viewState.pitch,
          basemap: currentBasemap.id,
        },
        layer_configs: Array.from(visibleDatasets).map((id) => ({
          dataset_id: id,
          visible: true,
        })),
      });
      useToastStore.getState().addToast('Map view saved', 'success');
      setSaveName('');
      setShowSaveInput(false);
    } catch {
      useToastStore.getState().addToast('Failed to save map view', 'error');
    } finally {
      setSaving(false);
    }
  }, [saveName]);

  const toolbarButtons = [
    {
      id: 'layers' as const,
      title: 'Layers',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      id: 'legend' as const,
      title: 'Legend',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          <circle cx="4" cy="6" r="1" fill="currentColor" />
          <circle cx="4" cy="10" r="1" fill="currentColor" />
          <circle cx="4" cy="14" r="1" fill="currentColor" />
          <circle cx="4" cy="18" r="1" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: 'basemap' as const,
      title: 'Basemaps',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* Icon Toolbar */}
      <div className="absolute top-12 left-0 bottom-0 w-11 bg-white/90 backdrop-blur-sm border-r border-gray-200 z-10 flex flex-col items-center pt-2 gap-1">
        {toolbarButtons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => togglePanel(btn.id)}
            className={`p-2 rounded-md transition-colors ${
              activePanel === btn.id
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
            title={btn.title}
          >
            {btn.icon}
          </button>
        ))}

        <div className="border-t border-gray-200 w-6 my-1" />

        {/* Save View */}
        <button
          onClick={() => setShowSaveInput(!showSaveInput)}
          className={`p-2 rounded-md transition-colors ${
            showSaveInput
              ? 'bg-green-100 text-green-700'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          }`}
          title="Save map view"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
        </button>
      </div>

      {/* Save View Input (floating) */}
      {showSaveInput && (
        <div className="absolute top-24 left-14 z-20 bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-56">
          <p className="text-xs font-medium text-gray-700 mb-2">Save Current View</p>
          <div className="flex gap-1">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="View name..."
              className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && handleSaveView()}
              autoFocus
            />
            <button
              onClick={handleSaveView}
              disabled={saving || !saveName.trim()}
              className="px-2 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Sliding Panels */}
      {activePanel === 'layers' && <LayerManager />}
      {activePanel === 'legend' && <LegendPanel />}
      {activePanel === 'basemap' && <BasemapGallery inline />}
    </>
  );
}
