import { useState } from 'react';
import { Dataset } from '../../api/types';
import { getGeoJSONUrl, getExportUrl, getArcGISFeatureServerUrl, EXPORT_FORMATS } from '../../api/datasets';

interface Props {
  dataset: Dataset;
  onClose: () => void;
}

export function ShareUrlModal({ dataset, onClose }: Props) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const geojsonUrl = getGeoJSONUrl(dataset.id);
  const arcgisUrl = getArcGISFeatureServerUrl(dataset.name);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      // Try modern clipboard API first (requires HTTPS)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for HTTP: use textarea + execCommand
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDownload = async (format: typeof EXPORT_FORMATS[number]['id']) => {
    setDownloading(format);
    try {
      const url = getExportUrl(dataset.id, format);
      // Open in new tab to trigger download
      window.open(url, '_blank');
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setTimeout(() => setDownloading(null), 1000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">
            Share "{dataset.name}"
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6">
          {/* Download Section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Data
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Download this dataset for use in desktop GIS applications.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format.id}
                  onClick={() => handleDownload(format.id)}
                  disabled={downloading === format.id}
                  className="flex flex-col items-start p-3 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-medium text-gray-900">{format.name}</span>
                    {downloading === format.id && (
                      <svg className="w-4 h-4 animate-spin text-blue-600 ml-auto" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">{format.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200"></div>

          {/* ArcGIS Pro Section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              ArcGIS Pro / QGIS
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              Add this layer directly in ArcGIS Pro or QGIS using the Feature Service URL.
            </p>

            {/* ArcGIS Feature Service URL */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Feature Service URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={arcgisUrl}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm font-mono text-gray-700"
                />
                <button
                  onClick={() => copyToClipboard(arcgisUrl, 'arcgis')}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm font-medium whitespace-nowrap"
                >
                  {copiedField === 'arcgis' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                In ArcGIS Pro: Map tab &gt; Add Data &gt; Data From Path &gt; paste URL
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200"></div>

          {/* API Access Section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Web API Access
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              Access this data programmatically via GeoJSON.
            </p>

            {/* GeoJSON URL */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                GeoJSON Endpoint
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={geojsonUrl}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm font-mono text-gray-700"
                />
                <button
                  onClick={() => copyToClipboard(geojsonUrl, 'geojson')}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm font-medium whitespace-nowrap"
                >
                  {copiedField === 'geojson' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Usage Examples */}
            <details className="group">
              <summary className="text-sm text-blue-600 cursor-pointer hover:text-blue-800">
                View code examples
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">JavaScript</label>
                  <pre className="bg-gray-800 text-gray-100 p-3 rounded-md text-xs overflow-x-auto">
{`fetch('${geojsonUrl}')
  .then(res => res.json())
  .then(data => console.log(data));`}
                  </pre>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Python</label>
                  <pre className="bg-gray-800 text-gray-100 p-3 rounded-md text-xs overflow-x-auto">
{`import geopandas as gpd
gdf = gpd.read_file('${geojsonUrl}')`}
                  </pre>
                </div>
              </div>
            </details>
          </div>

          {/* Usage Tips */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="text-sm font-semibold text-blue-800 mb-2">
              Recommended Workflows
            </h4>
            <ul className="text-sm text-blue-900 space-y-2">
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">ArcGIS Pro:</span>
                <span>Use Feature Service URL or download GeoPackage</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">QGIS:</span>
                <span>Use Feature Service URL or download GeoPackage</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">Google Earth:</span>
                <span>Download as KML</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">Web Apps:</span>
                <span>Use the GeoJSON endpoint URL directly</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
