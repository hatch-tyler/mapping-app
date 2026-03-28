import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapContainer } from '../components/map/MapContainer';
import { LayerManager } from '../components/map/LayerManager';
import { Navbar } from '@/components/layout/Navbar';
import { useDatasetStore } from '../stores/datasetStore';
import { useMapStore } from '../stores/mapStore';

function parseHash(): Record<string, string> {
  const hash = window.location.hash.slice(1);
  if (!hash) return {};
  const params: Record<string, string> = {};
  for (const part of hash.split('&')) {
    const [key, val] = part.split('=');
    if (key && val) params[key] = decodeURIComponent(val);
  }
  return params;
}

function buildHash(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

export function MapPage() {
  const { fetchDatasets } = useDatasetStore();
  const { setDatasetVisible, setViewState, setVisibleDatasets } = useMapStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const initializedFromHash = useRef(false);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  // Restore map state from URL hash on mount
  useEffect(() => {
    const hash = parseHash();
    if (Object.keys(hash).length === 0) return;

    const store = useMapStore.getState();
    const newViewState = { ...store.viewState };
    let changed = false;

    if (hash.zoom) { newViewState.zoom = parseFloat(hash.zoom); changed = true; }
    if (hash.lat) { newViewState.latitude = parseFloat(hash.lat); changed = true; }
    if (hash.lon) { newViewState.longitude = parseFloat(hash.lon); changed = true; }

    if (changed) setViewState(newViewState);

    if (hash.layers) {
      const layerIds = hash.layers.split(',').filter(Boolean);
      if (layerIds.length > 0) {
        setVisibleDatasets(layerIds);
      }
    }

    initializedFromHash.current = true;
  }, [setViewState, setVisibleDatasets]);

  // Sync map state to URL hash on changes (debounced)
  const hashTimeout = useRef<ReturnType<typeof setTimeout>>();
  const syncToHash = useCallback(() => {
    if (hashTimeout.current) clearTimeout(hashTimeout.current);
    hashTimeout.current = setTimeout(() => {
      const { viewState, visibleDatasets } = useMapStore.getState();
      const params: Record<string, string> = {
        zoom: viewState.zoom.toFixed(1),
        lat: viewState.latitude.toFixed(4),
        lon: viewState.longitude.toFixed(4),
      };
      if (visibleDatasets.size > 0) {
        params.layers = Array.from(visibleDatasets).join(',');
      }
      const newHash = buildHash(params);
      if (window.location.hash.slice(1) !== newHash) {
        window.history.replaceState(null, '', `#${newHash}`);
      }
    }, 500);
  }, []);

  useEffect(() => {
    const unsub = useMapStore.subscribe(syncToHash);
    return () => unsub();
  }, [syncToHash]);

  // Auto-activate layer from URL param (e.g., /?dataset=xxx from catalog)
  useEffect(() => {
    const datasetId = searchParams.get('dataset');
    if (datasetId) {
      setDatasetVisible(datasetId, true);
      searchParams.delete('dataset');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, setDatasetVisible]);

  return (
    <div className="h-screen w-screen relative">
      <Navbar variant="overlay" />

      {/* Map */}
      <MapContainer />

      {/* Layer Manager Sidebar */}
      <LayerManager />
    </div>
  );
}
