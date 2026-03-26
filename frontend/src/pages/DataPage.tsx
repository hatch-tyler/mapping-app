import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dataset } from '../api/types';
import { Navbar } from '@/components/layout/Navbar';
import { DatasetList } from '../components/data/DatasetList';
import { FeatureTable } from '../components/data/FeatureTable';
import { ServiceUrlsPanel } from '../components/data/ServiceUrlsPanel';

export function DataPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [showServiceUrls, setShowServiceUrls] = useState(true);

  // Read initial dataset ID from URL param (e.g., /data?dataset=xxx from catalog)
  const initialDatasetId = searchParams.get('dataset');

  const handleSelectDataset = (dataset: Dataset) => {
    setSelectedDataset(dataset);
    // Clear the URL param once a dataset is selected
    if (searchParams.has('dataset')) {
      searchParams.delete('dataset');
      setSearchParams(searchParams, { replace: true });
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <Navbar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Dataset List */}
        <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white">
          <DatasetList selectedDataset={selectedDataset} onSelectDataset={handleSelectDataset} initialDatasetId={initialDatasetId} />
        </div>

        {/* Center - Feature Table */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedDataset ? (
            <>
              {/* Dataset Header */}
              <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">{selectedDataset.name}</h2>
                  {selectedDataset.description && (
                    <p className="text-sm text-gray-500">{selectedDataset.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowServiceUrls(!showServiceUrls)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                      showServiceUrls
                        ? 'bg-blue-50 border-blue-200 text-blue-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                      />
                    </svg>
                    Service URLs
                  </button>
                </div>
              </div>

              {/* Table Area */}
              <div className="flex-1 overflow-hidden flex">
                <div className="flex-1 overflow-hidden">
                  <FeatureTable dataset={selectedDataset} />
                </div>

                {/* Right Panel - Service URLs */}
                {showServiceUrls && (
                  <div className="w-80 flex-shrink-0">
                    <ServiceUrlsPanel dataset={selectedDataset} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <svg
                  className="w-16 h-16 mx-auto text-gray-300 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                  />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-1">Select a Dataset</h3>
                <p className="text-sm text-gray-500">
                  Choose a dataset from the list to view its features
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
