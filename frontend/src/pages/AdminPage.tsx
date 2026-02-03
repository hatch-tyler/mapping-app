import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DatasetTable } from '../components/admin/DatasetTable';
import { UploadForm } from '../components/admin/UploadForm';
import { RegistrationRequests } from '../components/admin/RegistrationRequests';
import { ChangePasswordModal } from '../components/common/ChangePasswordModal';
import { useDatasetStore } from '../stores/datasetStore';
import { useAuthStore } from '../stores/authStore';
import { Dataset, StyleConfig } from '../api/types';
import * as datasetsApi from '../api/datasets';

type TabType = 'datasets' | 'registrations';

export function AdminPage() {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('datasets');
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

  const handleUpdateDataset = async (id: string, data: { name?: string; description?: string; style_config?: StyleConfig }) => {
    try {
      const updated = await datasetsApi.updateDataset(id, data as Partial<Dataset>);
      updateDataset(id, updated);
    } catch (err) {
      console.error('Failed to update dataset:', err);
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
              onClick={() => setShowChangePassword(true)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Change Password
            </button>
            <button
              onClick={() => logout()}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('datasets')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'datasets'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Datasets
            </button>
            <button
              onClick={() => setActiveTab('registrations')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'registrations'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Registration Requests
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'datasets' && (
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
            <div className="lg:col-span-2 min-w-0">
              <div className="bg-white rounded-lg shadow overflow-hidden">
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
                    onUpdate={handleUpdateDataset}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'registrations' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Registration Requests
              </h2>
            </div>
            <RegistrationRequests />
          </div>
        )}
      </main>
    </div>
  );
}
