import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer } from '../components/map/MapContainer';
import { LayerManager } from '../components/map/LayerManager';
import { useDatasetStore } from '../stores/datasetStore';
import { useAuthStore } from '../stores/authStore';

export function MapPage() {
  const { fetchDatasets } = useDatasetStore();
  const { user, logout } = useAuthStore();

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm z-10">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">GIS Application</h1>
          <div className="flex items-center gap-4">
            <Link
              to="/data"
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Data Browser
            </Link>
            {user?.is_admin && (
              <Link
                to="/admin"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Admin Dashboard
              </Link>
            )}
            <span className="text-sm text-gray-600">{user?.email}</span>
            <button
              onClick={() => logout()}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer />

        {/* Layer Manager Panel */}
        <div className="absolute top-4 left-4 z-10">
          <LayerManager />
        </div>
      </div>
    </div>
  );
}
