import { useState, useEffect } from 'react';
import { useMapStore, AVAILABLE_BASEMAPS } from '@/stores/mapStore';
import { useToastStore } from '@/stores/toastStore';
import * as templatesApi from '@/api/templates';
import type { MapView } from '@/api/templates';

export function MapViewManager() {
  const [views, setViews] = useState<MapView[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [loading, setLoading] = useState(false);
  const { viewState, visibleDatasets, currentBasemap, setViewState, setVisibleDatasets } = useMapStore();

  const fetchViews = async () => {
    try {
      const data = await templatesApi.getMapViews();
      setViews(data);
    } catch {
      // Silently fail — views are optional
    }
  };

  useEffect(() => {
    fetchViews();
  }, []);

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setLoading(true);
    try {
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
        layer_configs: Array.from(visibleDatasets).map(id => ({ dataset_id: id, visible: true })),
      });
      useToastStore.getState().addToast('Map view saved', 'success');
      setSaveName('');
      setShowSave(false);
      fetchViews();
    } catch {
      useToastStore.getState().addToast('Failed to save view', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = (view: MapView) => {
    const config = view.map_config;
    setViewState({
      ...viewState,
      zoom: config.zoom,
      latitude: config.latitude,
      longitude: config.longitude,
      bearing: config.bearing || 0,
      pitch: config.pitch || 0,
    });

    // Restore basemap
    const basemap = AVAILABLE_BASEMAPS.find(b => b.id === config.basemap);
    if (basemap) {
      useMapStore.getState().setBasemap(basemap);
    }

    // Restore visible layers
    const layerIds = view.layer_configs.filter(l => l.visible).map(l => l.dataset_id);
    setVisibleDatasets(layerIds);

    useToastStore.getState().addToast(`Loaded view: ${view.name}`, 'info');
  };

  const handleDelete = async (id: string) => {
    try {
      await templatesApi.deleteMapView(id);
      setViews(views.filter(v => v.id !== id));
    } catch {
      useToastStore.getState().addToast('Failed to delete view', 'error');
    }
  };

  return (
    <div className="border-t border-gray-200 px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Saved Views</span>
        <button
          onClick={() => setShowSave(!showSave)}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          {showSave ? 'Cancel' : '+ Save'}
        </button>
      </div>

      {showSave && (
        <div className="flex gap-1 mb-2">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="View name..."
            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            onClick={handleSave}
            disabled={loading || !saveName.trim()}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      {views.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No saved views</p>
      ) : (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {views.map((view) => (
            <div key={view.id} className="flex items-center gap-1 group">
              <button
                onClick={() => handleLoad(view)}
                className="flex-1 text-left text-xs text-gray-700 hover:text-blue-600 truncate py-0.5"
                title={`Load: ${view.name}`}
              >
                {view.name}
              </button>
              <button
                onClick={() => handleDelete(view.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500"
                title="Delete view"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
