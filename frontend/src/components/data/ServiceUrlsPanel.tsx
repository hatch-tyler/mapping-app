import { useState } from 'react';
import { Dataset } from '../../api/types';
import {
  getGeoJSONUrl,
  getWFSUrl,
  getArcGISFeatureServerUrl,
  getExportUrl,
  EXPORT_FORMATS,
} from '../../api/datasets';
import { ServiceUrlCard } from './ServiceUrlCard';

interface Props {
  dataset: Dataset;
}

export function ServiceUrlsPanel({ dataset }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const geojsonUrl = getGeoJSONUrl(dataset.id);
  const arcgisUrl = getArcGISFeatureServerUrl(dataset.name);
  const wfsUrl = getWFSUrl();

  const handleDownload = async (formatId: string) => {
    setDownloading(formatId);
    try {
      const url = getExportUrl(dataset.id, formatId as 'geojson' | 'gpkg' | 'shp' | 'kml');
      window.open(url, '_blank');
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setTimeout(() => setDownloading(null), 1000);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          <span className="font-medium text-gray-900">Service URLs</span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${collapsed ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ArcGIS Feature Service */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                />
              </svg>
              ArcGIS / QGIS
            </h3>
            <ServiceUrlCard
              label="Feature Service"
              url={arcgisUrl}
              description="Add to ArcGIS Pro: Map > Add Data > Data From Path"
            />
          </div>

          {/* Web APIs */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
              Web APIs
            </h3>
            <div className="space-y-2">
              <ServiceUrlCard label="GeoJSON" url={geojsonUrl} />
              <ServiceUrlCard
                label="WFS"
                url={`${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature&typeName=gis:${dataset.id}&outputFormat=application/json`}
                description="OGC Web Feature Service"
              />
            </div>
          </div>

          {/* Downloads */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Download Full Dataset
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format.id}
                  onClick={() => handleDownload(format.id)}
                  disabled={downloading === format.id}
                  className="flex flex-col items-start p-2 border border-gray-200 rounded hover:border-blue-500 hover:bg-blue-50 transition-colors text-left disabled:opacity-50"
                >
                  <div className="flex items-center gap-1 w-full">
                    <span className="text-sm font-medium text-gray-900">{format.name}</span>
                    {downloading === format.id && (
                      <svg
                        className="w-3 h-3 animate-spin text-blue-600 ml-auto"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">{format.ext}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-50 p-3 rounded-lg">
            <h4 className="text-xs font-semibold text-blue-800 mb-1">Quick Tips</h4>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>
                <strong>ArcGIS Pro:</strong> Use Feature Service URL
              </li>
              <li>
                <strong>QGIS:</strong> Add ArcGIS REST or GeoJSON layer
              </li>
              <li>
                <strong>Web apps:</strong> Use GeoJSON endpoint
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
