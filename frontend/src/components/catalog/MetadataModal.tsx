import { Dataset } from '../../api/types';
import { getGeoJSONUrl, getArcGISFeatureServerUrl, getWFSUrl } from '../../api/datasets';

interface Props {
  dataset: Dataset;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {children}
      </dl>
    </div>
  );
}

function Field({ label, value, showNA = false }: { label: string; value: string | number | null | undefined; showNA?: boolean }) {
  const isEmpty = value === null || value === undefined || value === '';
  if (isEmpty && !showNA) return null;
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className={`truncate ${isEmpty ? 'text-gray-300 italic' : 'text-gray-900'}`} title={isEmpty ? 'N/A' : String(value)}>
        {isEmpty ? 'N/A' : String(value)}
      </dd>
    </>
  );
}

function UrlField({ label, url }: { label: string; url: string }) {
  return (
    <div className="col-span-2 flex items-start gap-2">
      <span className="text-gray-500 text-sm shrink-0">{label}:</span>
      <code className="text-xs text-blue-600 break-all bg-gray-50 px-1.5 py-0.5 rounded flex-1">{url}</code>
    </div>
  );
}

export function MetadataModal({ dataset, onClose }: Props) {
  const geojsonUrl = getGeoJSONUrl(dataset.id);
  const arcgisUrl = getArcGISFeatureServerUrl(dataset.name);
  const wfsUrl = getWFSUrl();

  const formatBounds = (bounds: number[] | null) => {
    if (!bounds || bounds.length < 4) return null;
    return `${bounds[0].toFixed(4)}, ${bounds[1].toFixed(4)} → ${bounds[2].toFixed(4)}, ${bounds[3].toFixed(4)}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 truncate pr-4">{dataset.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-5">
          {/* Description */}
          {dataset.description && (
            <p className="text-sm text-gray-600">{dataset.description}</p>
          )}

          {/* Basic Info */}
          <Section title="Basic Information">
            <Field label="Data Type" value={dataset.data_type} />
            <Field label="Source Format" value={dataset.source_format} />
            <Field label="Source Type" value={dataset.source_type} />
            <Field label="Feature Count" value={dataset.feature_count?.toLocaleString()} />
            <Field label="Created" value={formatDate(dataset.created_at)} />
            <Field label="Updated" value={formatDate(dataset.updated_at)} />
          </Section>

          {/* Spatial Info */}
          <div className="border-t border-gray-100 pt-4">
            <Section title="Spatial Information">
              <Field label="Geometry Type" value={dataset.geometry_type} />
              <Field label="Coordinate System" value={`EPSG:${dataset.srid}`} />
              <Field label="Bounds" value={formatBounds(dataset.bounds)} />
              <Field label="Min Zoom" value={dataset.min_zoom} />
              <Field label="Max Zoom" value={dataset.max_zoom} />
            </Section>
          </div>

          {/* Organization */}
          <div className="border-t border-gray-100 pt-4">
            <Section title="Organization">
              <Field label="Category" value={dataset.category} />
              <Field label="Geographic Scope" value={dataset.geographic_scope} />
              <Field label="Project" value={dataset.project_name} />
              <Field label="Published" value={dataset.is_visible ? 'Yes' : 'No'} />
              <Field label="Public Access" value={dataset.is_public ? 'Yes' : 'No'} />
              {dataset.tags.length > 0 && (
                <div className="col-span-2 mt-1">
                  <span className="text-gray-500 text-sm">Tags: </span>
                  {dataset.tags.map((tag) => (
                    <span key={tag} className="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded mr-1 mb-1">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* Source Info */}
          {dataset.source_type === 'external' && (
            <div className="border-t border-gray-100 pt-4">
              <Section title="External Service">
                <Field label="Service Type" value={dataset.service_type} />
                <Field label="Layer ID" value={dataset.service_layer_id} />
                {dataset.service_url && (
                  <UrlField label="Service URL" url={dataset.service_url} />
                )}
              </Section>
            </div>
          )}

          {/* Data Metadata */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Data Metadata</h3>
            {dataset.service_metadata && Object.keys(dataset.service_metadata).length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {/* Common metadata fields with N/A fallback */}
                <Field label="Description" value={dataset.service_metadata.description as string || dataset.service_metadata.serviceDescription as string || dataset.service_metadata.Abstract as string} showNA />
                <Field label="Copyright" value={dataset.service_metadata.copyrightText as string} showNA />
                <Field label="Credits" value={dataset.service_metadata.credits as string} showNA />
                <Field label="Capabilities" value={dataset.service_metadata.capabilities as string} showNA />
                <Field label="Version" value={dataset.service_metadata.currentVersion as string} showNA />
                <Field label="Access Constraints" value={dataset.service_metadata.AccessConstraints as string} showNA />
                {/* Local file metadata: fields list */}
                {Array.isArray(dataset.service_metadata.fields) && (
                  <div className="col-span-2 mt-2">
                    <span className="text-gray-500 text-sm">Data Fields:</span>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      {(dataset.service_metadata.fields as Array<{name: string; dtype: string}>).map((f) => (
                        <div key={f.name} className="text-xs bg-gray-50 px-2 py-1 rounded flex justify-between">
                          <span className="text-gray-700 font-mono">{f.name}</span>
                          <span className="text-gray-400">{f.dtype}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* CRS info from local files */}
                <Field label="CRS" value={dataset.service_metadata.crs as string} />
                <Field label="CRS EPSG" value={dataset.service_metadata.crs_epsg as number} />
              </dl>
            ) : (
              <p className="text-sm text-gray-400 italic">No metadata available for this dataset</p>
            )}
          </div>

          {/* Access URLs */}
          {dataset.data_type === 'vector' && dataset.source_type !== 'external' && (
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Access URLs</h3>
              <div className="space-y-2">
                <UrlField label="ArcGIS Feature Service" url={arcgisUrl} />
                <UrlField label="GeoJSON" url={geojsonUrl} />
                <UrlField label="WFS" url={`${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature&typeName=gis:${dataset.id}&outputFormat=application/json`} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 font-medium text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
