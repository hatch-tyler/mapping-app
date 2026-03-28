import { useEffect, useState } from 'react';
import { DatasetTable } from '../components/admin/DatasetTable';
import { UploadModal } from '../components/admin/UploadModal';
import { AddExternalSourceModal } from '../components/admin/AddExternalSourceModal';
import { DatasetSearchBar } from '../components/admin/DatasetSearchBar';
import { DatasetFilterPanel } from '../components/admin/DatasetFilterPanel';
import { ProjectsTab } from '../components/admin/ProjectsTab';
import { LayoutDesigner } from '../components/templates/LayoutDesigner';
import { Navbar } from '@/components/layout/Navbar';
import { useDatasetStore } from '../stores/datasetStore';
import { useToastStore } from '../stores/toastStore';
import { Dataset } from '../api/types';
import { apiClient } from '../api/client';
import * as datasetsApi from '../api/datasets';

type TabType = 'datasets' | 'projects' | 'templates';

export function UploadPage() {
  const [showAddExternal, setShowAddExternal] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('datasets');
  const { datasets, loading, error, filters, fetchDatasets, setFilters, updateDataset, removeDataset } =
    useDatasetStore();

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

  const handleUpdateDataset = async (id: string, data: Partial<Dataset>) => {
    try {
      const updated = await datasetsApi.updateDataset(id, data);
      updateDataset(id, updated);
    } catch (err) {
      console.error('Failed to update dataset:', err);
    }
  };

  const handleRefreshAllMetadata = async () => {
    setRefreshingMetadata(true);
    try {
      const [extResult, localResult] = await Promise.all([
        apiClient.post('/external-sources/refresh-all-metadata'),
        apiClient.post('/datasets/refresh-local-metadata'),
      ]);
      const ext = extResult.data;
      const local = localResult.data;
      useToastStore.getState().addToast(
        `Metadata refreshed. External: ${ext.updated} updated, ${ext.failed} failed. Local: ${local.updated} updated.`,
        'success'
      );
      fetchDatasets();
    } catch {
      useToastStore.getState().addToast('Failed to refresh metadata', 'error');
    } finally {
      setRefreshingMetadata(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <Navbar />

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white shrink-0">
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
              onClick={() => setActiveTab('projects')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'projects'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Projects
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'templates'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Templates
            </button>
          </nav>
        </div>
      </div>

      {/* Templates tab: full-bleed layout */}
      {activeTab === 'templates' && (
        <div className="flex-1 min-h-0">
          <LayoutDesigner onClose={() => setActiveTab('datasets')} />
        </div>
      )}

      {/* Other tabs: constrained width */}
      <main className={`max-w-7xl mx-auto px-4 py-8 ${activeTab === 'templates' ? 'hidden' : ''} flex-1 overflow-y-auto`}>
        {activeTab === 'datasets' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Datasets ({datasets.length})
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRefreshAllMetadata}
                    disabled={refreshingMetadata}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                    title="Re-fetch metadata for all datasets"
                  >
                    {refreshingMetadata ? 'Refreshing...' : 'Refresh Metadata'}
                  </button>
                  <button
                    onClick={() => setShowUpload(true)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    + Upload Dataset
                  </button>
                  <button
                    onClick={() => setShowAddExternal(true)}
                    className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50"
                  >
                    + External Source
                  </button>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <DatasetSearchBar
                    value={filters.search || ''}
                    onChange={(search) => setFilters({ ...filters, search: search || undefined })}
                  />
                </div>
                <DatasetFilterPanel filters={filters} onChange={setFilters} />
              </div>
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
        )}

        {activeTab === 'projects' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <ProjectsTab />
          </div>
        )}

        {activeTab === 'templates' && (
          <LayoutDesigner onClose={() => setActiveTab('datasets')} />
        )}
      </main>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => { setShowUpload(false); fetchDatasets(); }}
        />
      )}

      {showAddExternal && (
        <AddExternalSourceModal
          onClose={() => setShowAddExternal(false)}
          onSuccess={() => { setShowAddExternal(false); fetchDatasets(); }}
        />
      )}
    </div>
  );
}
