import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapContainer } from '../components/map/MapContainer';
import { LayerManager } from '../components/map/LayerManager';
import { Navbar } from '@/components/layout/Navbar';
import { useDatasetStore } from '../stores/datasetStore';
import { useMapStore } from '../stores/mapStore';

export function MapPage() {
  const { fetchDatasets } = useDatasetStore();
  const { setDatasetVisible } = useMapStore();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

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
