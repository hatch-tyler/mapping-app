import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DatasetTable } from '../components/admin/DatasetTable';
import { UploadForm } from '../components/admin/UploadForm';
import { useDatasetStore } from '../stores/datasetStore';
import { useAuthStore } from '../stores/authStore';
import * as datasetsApi from '../api/datasets';

export function AdminPage() {
  const { datasets, loading, error, fetchDatasets, updateDataset, removeDataset } =
    useDatasetStore();
  const { user, logout } = useAuthStore();

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  const handleToggleVisibility = async (id: string, visible: boolean) => {
    try {
      const updated = await datasetsApi.toggleVisibility(id, visible);
      updateDataset(id, updated);
    } catch (err) {
      console.error('Failed to toggle visibility:', err);
    }
  };

  const handleTogglePublic = async (id: string, isPublic: boolean) => {
    try {
      const updated = await datasetsApi.togglePublicStatus(id, isPublic);
      updateDataset(id, updated);
    } catch (err) {
      console.error('Failed to toggle public status:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await datasetsApi.deleteDataset(id);
      removeDataset(id);
    } catch (err) {
      console.error('Failed to delete dataset:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <Link to="/" className="text-sm text-blue-600 hover:text-blue-800">
              Back to Map
            </Link>
          </div>
          <div className="flex items-center gap-4">
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

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Upload Section */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Upload Dataset
              </h2>
              <UploadForm onSuccess={fetchDatasets} />
            </div>
          </div>

          {/* Datasets Table */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  Datasets ({datasets.length})
                </h2>
              </div>

              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              )}

              {error && (
                <div className="p-6">
                  <div className="text-red-600 bg-red-50 p-4 rounded-md">
                    {error}
                  </div>
                </div>
              )}

              {!loading && !error && (
                <DatasetTable
                  datasets={datasets}
                  onToggleVisibility={handleToggleVisibility}
                  onTogglePublic={handleTogglePublic}
                  onDelete={handleDelete}
                />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
