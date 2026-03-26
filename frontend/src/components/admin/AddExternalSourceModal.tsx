import { useState, useEffect } from 'react';
import { GeographicScope, ServiceCatalog, BrowseServiceInfo } from '../../api/types';
import * as externalApi from '../../api/externalSources';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'source' | 'browse' | 'configure' | 'done';

interface SelectedLayer {
  serviceUrl: string;
  serviceType: string;
  layerId: string;
  layerName: string;
}

export function AddExternalSourceModal({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('source');
  const [url, setUrl] = useState('');
  const [saveCatalog, setSaveCatalog] = useState(false);
  const [catalogName, setCatalogName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Saved catalogs
  const [catalogs, setCatalogs] = useState<ServiceCatalog[]>([]);

  // Browse state
  const [browseHistory, setBrowseHistory] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [services, setServices] = useState<BrowseServiceInfo[]>([]);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [probedLayers, setProbedLayers] = useState<Record<string, externalApi.ExternalServiceLayer[]>>({});
  const [probedTypes, setProbedTypes] = useState<Record<string, string>>({});

  // Browse filter
  const [browseFilter, setBrowseFilter] = useState('');

  // Selection state
  const [selectedLayers, setSelectedLayers] = useState<SelectedLayer[]>([]);

  // Configure state
  const [layerNames, setLayerNames] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<'reference' | 'project'>('reference');
  const [geographicScope, setGeographicScope] = useState<GeographicScope | ''>('');
  const [tags, setTags] = useState('');
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    externalApi.getCatalogs().then((r) => setCatalogs(r.catalogs)).catch(() => {});
  }, []);

  const currentUrl = browseHistory[browseHistory.length - 1] || '';

  const doBrowse = async (targetUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await externalApi.browseDirectory(targetUrl);
      setFolders(result.folders);
      setServices(result.services);
      setBrowseHistory((prev) => [...prev, targetUrl]);
      setExpandedService(null);
      setBrowseFilter('');
      setStep('browse');
    } catch {
      // Not a directory — try probing as a direct service
      try {
        const probe = await externalApi.probeService(targetUrl);
        // Go directly to configure with this service's layers
        const layers = probe.layers.map((l) => ({
          serviceUrl: targetUrl,
          serviceType: probe.service_type,
          layerId: l.id,
          layerName: l.name,
        }));
        setSelectedLayers(layers);
        const names: Record<string, string> = {};
        layers.forEach((l) => { names[`${l.serviceUrl}:${l.layerId}`] = l.layerName; });
        setLayerNames(names);
        setStep('configure');
      } catch {
        setError('Could not browse or detect a service at this URL.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (!url.trim()) return;
    const cleanUrl = url.trim().replace(/\/$/, '');

    // Save as catalog if requested
    if (saveCatalog && catalogName.trim()) {
      try {
        const newCatalog = await externalApi.createCatalog({
          name: catalogName.trim(),
          base_url: cleanUrl,
        });
        setCatalogs((prev) => [...prev, newCatalog]);
      } catch {
        // Catalog save failed (maybe duplicate) — continue browsing anyway
      }
    }

    setBrowseHistory([]);
    await doBrowse(cleanUrl);
  };

  const handleBrowseFolder = (folder: string) => {
    doBrowse(`${currentUrl}/${folder}`);
  };

  const handleBrowseBack = () => {
    if (browseHistory.length <= 1) {
      setStep('source');
      setBrowseHistory([]);
      return;
    }
    // Remove current URL, navigate to the one before it
    const withoutCurrent = browseHistory.slice(0, -1);
    const prevUrl = withoutCurrent[withoutCurrent.length - 1];
    // Remove prevUrl too since doBrowse will re-add it
    setBrowseHistory(withoutCurrent.slice(0, -1));
    doBrowse(prevUrl);
  };

  const handleExpandService = async (svc: BrowseServiceInfo) => {
    if (expandedService === svc.url) {
      setExpandedService(null);
      return;
    }
    setExpandedService(svc.url);
    if (!probedLayers[svc.url]) {
      try {
        const probe = await externalApi.probeService(svc.url);
        setProbedLayers((prev) => ({ ...prev, [svc.url]: probe.layers }));
        setProbedTypes((prev) => ({ ...prev, [svc.url]: probe.service_type }));
      } catch {
        setProbedLayers((prev) => ({ ...prev, [svc.url]: [] }));
      }
    }
  };

  const toggleLayer = (svc: BrowseServiceInfo, layer: externalApi.ExternalServiceLayer) => {
    const key = `${svc.url}:${layer.id}`;
    const exists = selectedLayers.some((l) => `${l.serviceUrl}:${l.layerId}` === key);
    if (exists) {
      setSelectedLayers((prev) => prev.filter((l) => `${l.serviceUrl}:${l.layerId}` !== key));
    } else {
      setSelectedLayers((prev) => [
        ...prev,
        {
          serviceUrl: svc.url,
          serviceType: probedTypes[svc.url] || svc.type.toLowerCase().replace('server', '_').replace('feature_', 'arcgis_feature').replace('image_', 'arcgis_image').replace('map_', 'arcgis_map'),
          layerId: layer.id,
          layerName: layer.name,
        },
      ]);
      setLayerNames((prev) => ({ ...prev, [key]: layer.name }));
    }
  };

  const isLayerSelected = (svcUrl: string, layerId: string) =>
    selectedLayers.some((l) => l.serviceUrl === svcUrl && l.layerId === layerId);

  const handleProceedToConfigure = () => {
    if (selectedLayers.length === 0) return;
    setStep('configure');
  };

  const handleRegister = async () => {
    if (selectedLayers.length === 0) return;
    setRegistering(true);
    setError(null);
    try {
      const tagList = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
      for (const layer of selectedLayers) {
        const key = `${layer.serviceUrl}:${layer.layerId}`;
        await externalApi.registerExternalSource({
          name: layerNames[key] || layer.layerName,
          service_url: layer.serviceUrl,
          service_type: layer.serviceType,
          service_layer_id: layer.layerId,
          category,
          geographic_scope: geographicScope || undefined,
          tags: tagList,
        });
      }
      setStep('done');
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch {
      setError('Failed to register one or more layers.');
    } finally {
      setRegistering(false);
    }
  };

  const handleDeleteCatalog = async (id: string) => {
    try {
      await externalApi.deleteCatalog(id);
      setCatalogs((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError('Failed to delete catalog');
    }
  };

  // Breadcrumbs from browse history
  const breadcrumbs = browseHistory.map((u) => {
    const parts = u.split('/');
    return parts[parts.length - 1] || 'Services';
  });

  const filteredFolders = browseFilter
    ? folders.filter((f) => f.toLowerCase().includes(browseFilter.toLowerCase()))
    : folders;
  const filteredServices = browseFilter
    ? services.filter((s) => s.name.toLowerCase().includes(browseFilter.toLowerCase()))
    : services;

  const typeBadge = (type: string) => {
    const lower = type.toLowerCase();
    const isFeature = lower.includes('feature');
    const isImage = lower.includes('image');
    const badgeColor = isFeature
      ? 'bg-blue-100 text-blue-700'
      : isImage
        ? 'bg-green-100 text-green-700'
        : 'bg-purple-100 text-purple-700';
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeColor}`}>
        {type}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Add External Data Source</h3>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">

          {/* STEP: SOURCE SELECTION */}
          {step === 'source' && (
            <>
              {catalogs.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Saved Catalogs</label>
                  <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-200 rounded-md">
                    {catalogs.map((cat) => (
                      <div key={cat.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                        <button
                          onClick={() => { setBrowseHistory([]); doBrowse(cat.base_url); }}
                          className="flex-1 text-left text-sm"
                        >
                          <span className="font-medium text-blue-600 hover:text-blue-800">{cat.name}</span>
                          {cat.description && <span className="text-gray-400 ml-2 text-xs">{cat.description}</span>}
                        </button>
                        <button
                          onClick={() => handleDeleteCatalog(cat.id)}
                          className="text-gray-400 hover:text-red-500 p-1 ml-2"
                          title="Remove catalog"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="ext-url" className="block text-sm font-medium text-gray-700 mb-1">
                  {catalogs.length > 0 ? 'Or Enter URL' : 'Service URL'}
                </label>
                <input
                  id="ext-url"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://gis.water.ca.gov/arcgis/rest/services/"
                  onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Enter a service directory URL or a direct service URL
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={saveCatalog}
                  onChange={(e) => setSaveCatalog(e.target.checked)}
                  className="text-blue-600"
                />
                Save as catalog for future use
              </label>

              {saveCatalog && (
                <input
                  type="text"
                  value={catalogName}
                  onChange={(e) => setCatalogName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Catalog name (e.g., CA DWR GIS)"
                />
              )}
            </>
          )}

          {/* STEP: DIRECTORY BROWSER */}
          {step === 'browse' && (
            <>
              {/* Breadcrumbs */}
              <div className="flex items-center gap-1 text-sm text-gray-500 flex-wrap">
                {breadcrumbs.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-300">/</span>}
                    <span className={i === breadcrumbs.length - 1 ? 'text-gray-900 font-medium' : ''}>
                      {crumb}
                    </span>
                  </span>
                ))}
              </div>

              {/* Search filter */}
              {(folders.length > 0 || services.length > 0) && (
                <div className="relative">
                  <input
                    type="text"
                    value={browseFilter}
                    onChange={(e) => setBrowseFilter(e.target.value)}
                    className="w-full px-3 py-1.5 pl-8 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Filter folders and services..."
                  />
                  <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {browseFilter && (
                    <button
                      onClick={() => setBrowseFilter('')}
                      className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              )}

              {/* Folders */}
              {filteredFolders.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Folders</div>
                  <div className="grid grid-cols-2 gap-1">
                    {filteredFolders.map((folder) => (
                      <button
                        key={folder}
                        onClick={() => handleBrowseFolder(folder)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md hover:bg-blue-50 border border-gray-200"
                      >
                        <svg className="w-4 h-4 text-yellow-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                        <span className="truncate">{folder}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Services */}
              {filteredServices.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">
                    Services ({filteredServices.length}{browseFilter ? ` of ${services.length}` : ''})
                  </div>
                  <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-64 overflow-y-auto">
                    {filteredServices.map((svc) => (
                      <div key={svc.url}>
                        <button
                          onClick={() => handleExpandService(svc)}
                          className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <svg className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${expandedService === svc.url ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="truncate font-medium">{svc.name}</span>
                          </div>
                          {typeBadge(svc.type)}
                        </button>

                        {/* Expanded layers */}
                        {expandedService === svc.url && (
                          <div className="bg-gray-50 px-4 py-2 space-y-1">
                            {!probedLayers[svc.url] ? (
                              <div className="flex items-center gap-2 text-xs text-gray-500 py-1">
                                <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-600" />
                                Loading layers...
                              </div>
                            ) : probedLayers[svc.url].length === 0 ? (
                              <div className="text-xs text-gray-400 py-1">No layers found</div>
                            ) : (
                              probedLayers[svc.url].map((layer) => (
                                <label key={layer.id} className="flex items-center gap-2 py-1 cursor-pointer text-sm">
                                  <input
                                    type="checkbox"
                                    checked={isLayerSelected(svc.url, layer.id)}
                                    onChange={() => toggleLayer(svc, layer)}
                                    className="text-blue-600"
                                  />
                                  <span className="truncate">{layer.name}</span>
                                  {layer.geometry_type && (
                                    <span className="text-[10px] text-gray-400 shrink-0">
                                      {layer.geometry_type.replace('esriGeometry', '')}
                                    </span>
                                  )}
                                </label>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filteredFolders.length === 0 && filteredServices.length === 0 && !loading && (
                <div className="text-center text-gray-500 text-sm py-4">
                  {browseFilter ? 'No matches found' : 'No folders or services found at this URL'}
                </div>
              )}
            </>
          )}

          {/* STEP: CONFIGURE */}
          {step === 'configure' && (
            <>
              <div className="text-sm font-medium text-gray-700">
                {selectedLayers.length} layer{selectedLayers.length !== 1 ? 's' : ''} selected
              </div>
              <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                {selectedLayers.map((layer) => {
                  const key = `${layer.serviceUrl}:${layer.layerId}`;
                  return (
                    <div key={key} className="flex items-center gap-2 px-3 py-2">
                      <input
                        type="text"
                        value={layerNames[key] || ''}
                        onChange={(e) => setLayerNames({ ...layerNames, [key]: e.target.value })}
                        className="flex-1 text-sm border-0 border-b border-transparent focus:border-blue-500 focus:ring-0 p-0 bg-transparent"
                      />
                      <button
                        onClick={() => setSelectedLayers((prev) => prev.filter((l) => `${l.serviceUrl}:${l.layerId}` !== key))}
                        className="text-gray-400 hover:text-red-500 p-1"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" checked={category === 'reference'} onChange={() => setCategory('reference')} />
                    Reference
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" checked={category === 'project'} onChange={() => setCategory('project')} />
                    Project
                  </label>
                </div>
              </div>

              {category === 'reference' && (
                <div>
                  <label htmlFor="ext-scope" className="block text-sm font-medium text-gray-700 mb-1">Geographic Scope</label>
                  <select
                    id="ext-scope"
                    value={geographicScope}
                    onChange={(e) => setGeographicScope(e.target.value as GeographicScope | '')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select scope (optional)</option>
                    <option value="federal">Federal</option>
                    <option value="state">State</option>
                    <option value="county">County</option>
                    <option value="local">Local</option>
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="ext-tags" className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                <input
                  id="ext-tags"
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. parcels, boundaries"
                />
                <p className="text-xs text-gray-400 mt-0.5">Comma-separated</p>
              </div>
            </>
          )}

          {/* STEP: DONE */}
          {step === 'done' && (
            <div className="text-green-700 text-sm bg-green-50 p-4 rounded-md">
              External source(s) registered successfully.
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            </div>
          )}

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
          <div>
            {step === 'browse' && (
              <button onClick={handleBrowseBack} className="text-sm text-gray-600 hover:text-gray-800">
                &larr; Back
              </button>
            )}
            {step === 'configure' && browseHistory.length > 0 && (
              <button onClick={() => setStep('browse')} className="text-sm text-gray-600 hover:text-gray-800">
                &larr; Back to browser
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">
              Cancel
            </button>
            {step === 'source' && (
              <button
                onClick={handleStart}
                disabled={loading || !url.trim()}
                className={`px-4 py-2 text-sm font-medium text-white rounded-md ${loading || !url.trim() ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {loading ? 'Loading...' : 'Browse'}
              </button>
            )}
            {step === 'browse' && (
              <button
                onClick={handleProceedToConfigure}
                disabled={selectedLayers.length === 0}
                className={`px-4 py-2 text-sm font-medium text-white rounded-md ${selectedLayers.length === 0 ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                Configure {selectedLayers.length > 0 ? `(${selectedLayers.length})` : ''}
              </button>
            )}
            {step === 'configure' && (
              <button
                onClick={handleRegister}
                disabled={registering || selectedLayers.length === 0}
                className={`px-4 py-2 text-sm font-medium text-white rounded-md ${registering || selectedLayers.length === 0 ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {registering ? 'Registering...' : `Register ${selectedLayers.length} Layer${selectedLayers.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
