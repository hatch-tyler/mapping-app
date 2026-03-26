import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dataset } from '@/api/types';
import { EXPORT_FORMATS, getExportUrl, getExternalProxyUrl } from '@/api/datasets';

interface CatalogCardProps {
  dataset: Dataset;
  onViewMetadata: (dataset: Dataset) => void;
  isLinked?: boolean;
}

export function CatalogCard({ dataset, onViewMetadata, isLinked }: CatalogCardProps) {
  const navigate = useNavigate();
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowDownloadMenu(false);
      }
    }
    if (showDownloadMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDownloadMenu]);

  const isExternal = dataset.source_type === 'external';
  const isVector = dataset.data_type === 'vector';

  function handleDownload(formatId: string) {
    let url: string;
    if (isExternal && isVector) {
      // For external vector datasets, proxy-based download
      url = `${getExternalProxyUrl(dataset.id)}?format=${formatId}`;
    } else {
      url = getExportUrl(dataset.id, formatId as 'geojson' | 'gpkg' | 'shp' | 'kml');
    }
    window.open(url, '_blank');
    setShowDownloadMenu(false);
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900 truncate flex-1" title={dataset.name}>
            {dataset.name}
          </h3>
          {isLinked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Linked</span>
          )}
          <span
            className={`flex-shrink-0 px-1.5 py-0.5 text-xs font-medium rounded ${
              isExternal
                ? 'bg-orange-100 text-orange-700'
                : 'bg-teal-100 text-teal-700'
            }`}
          >
            {isExternal ? 'External' : 'Local'}
          </span>
        </div>

        {dataset.description && (
          <p className="mt-1 text-xs text-gray-500 line-clamp-2">{dataset.description}</p>
        )}
      </div>

      {/* Badges */}
      <div className="px-4 pb-2 flex flex-wrap gap-1.5">
        {/* Data type badge */}
        <span
          className={`px-1.5 py-0.5 text-xs font-medium rounded ${
            isVector ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
          }`}
        >
          {dataset.data_type}
        </span>

        {/* Category badge */}
        {dataset.category === 'project' ? (
          <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700">
            {dataset.project_name || 'Project'}
          </span>
        ) : (
          <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
            Reference
          </span>
        )}

        {/* Geographic scope badge */}
        {dataset.geographic_scope && (
          <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-yellow-100 text-yellow-700 capitalize">
            {dataset.geographic_scope}
          </span>
        )}
      </div>

      {/* Tags */}
      {dataset.tags && dataset.tags.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1">
          {dataset.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-xs rounded bg-gray-50 text-gray-500 border border-gray-200"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="px-4 pb-3 flex items-center gap-3 text-xs text-gray-500">
        {dataset.feature_count != null && (
          <span>{dataset.feature_count.toLocaleString()} features</span>
        )}
        {dataset.geometry_type && <span>{dataset.geometry_type}</span>}
      </div>

      {/* Spacer to push actions to bottom */}
      <div className="flex-1" />

      {/* Action Buttons */}
      <div className="px-4 pb-4 pt-2 border-t border-gray-100 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => navigate(`/?dataset=${dataset.id}`)}
          className="px-2.5 py-1 text-xs font-medium text-blue-600 border border-blue-300 rounded hover:bg-blue-50 transition-colors"
        >
          View on Map
        </button>

        {isVector && (
          <button
            onClick={() => navigate(`/data?dataset=${dataset.id}`)}
            className="px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Feature Table
          </button>
        )}

        <button
          onClick={() => onViewMetadata(dataset)}
          className="px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          Metadata
        </button>

        {/* Download dropdown */}
        <div className="relative ml-auto" ref={menuRef}>
          <button
            onClick={() => setShowDownloadMenu(!showDownloadMenu)}
            className="p-1.5 text-gray-500 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            title="Download"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>

          {showDownloadMenu && (
            <div className="absolute right-0 bottom-full mb-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-20">
              {EXPORT_FORMATS.map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => handleDownload(fmt.id)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors"
                >
                  <span className="font-medium text-gray-700">{fmt.name}</span>
                  <span className="text-gray-400 ml-1">{fmt.ext}</span>
                  <p className="text-gray-400">{fmt.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
