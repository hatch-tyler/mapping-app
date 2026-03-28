import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import { useMapStore } from '../../stores/mapStore';
import { useDatasetStore } from '../../stores/datasetStore';
import { createLayerFromDataset } from '../../utils/layerFactory';
import { createClusteredLayer, shouldUseClustering, clearClusterCache } from '../../utils/clusterLayer';
import { BasemapGallery } from './BasemapGallery';
import { FeatureDetailPanel } from './FeatureDetailPanel';
import { MeasureTool } from './MeasureTool';
import { Dataset } from '../../api/types';
import 'maplibre-gl/dist/maplibre-gl.css';

// Create a MapLibre style for raster tile sources (like satellite imagery)
function createRasterStyle(tileUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      'raster-tiles': {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution: '&copy; Esri',
      },
    },
    layers: [
      {
        id: 'raster-layer',
        type: 'raster',
        source: 'raster-tiles',
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  };
}

// Check if basemap URL is a raster tile template (contains {z}, {x}, {y})
function isRasterTileUrl(url: string): boolean {
  return url.includes('{z}') && url.includes('{x}') && url.includes('{y}');
}

export function MapContainer() {
  const { viewState, setViewState, visibleDatasets, truncatedLayers, setSelectedFeature, currentBasemap } =
    useMapStore();
  const { datasets } = useDatasetStore();
  const [clusteredLayers, setClusteredLayers] = useState<Record<string, unknown>>({});
  const [showMeasure, setShowMeasure] = useState(false);
  const measureClickHandler = useRef<((info: { coordinate?: [number, number] }) => void) | null>(null);
  const deckRef = useRef<HTMLDivElement>(null);

  // Generate the appropriate map style based on basemap type
  const mapStyle = useMemo(() => {
    if (isRasterTileUrl(currentBasemap.url)) {
      return createRasterStyle(currentBasemap.url);
    }
    return currentBasemap.url;
  }, [currentBasemap.url]);

  // Get visible datasets
  const visibleDatasetsList = useMemo(() => {
    return datasets.filter((d) => visibleDatasets.has(d.id) && d.is_visible);
  }, [datasets, visibleDatasets]);

  // Datasets that should use clustering (point type)
  const clusterableDatasets = useMemo(() => {
    return visibleDatasetsList.filter(shouldUseClustering);
  }, [visibleDatasetsList]);

  // Datasets that don't need clustering
  const nonClusterableDatasets = useMemo(() => {
    return visibleDatasetsList.filter((d) => !shouldUseClustering(d));
  }, [visibleDatasetsList]);

  // Update clustered layers when zoom or datasets change
  const clusterRequestId = useRef(0);
  useEffect(() => {
    const requestId = ++clusterRequestId.current;
    const updateClusters = async () => {
      const newClusteredLayers: Record<string, unknown> = {};

      for (const dataset of clusterableDatasets) {
        try {
          const layer = await createClusteredLayer(dataset, viewState.zoom);
          if (layer) {
            newClusteredLayers[dataset.id] = layer;
          }
        } catch (error) {
          console.error(`Failed to create clustered layer for ${dataset.name}:`, error);
        }
      }

      // Only update if this is still the latest request
      if (requestId === clusterRequestId.current) {
        setClusteredLayers(newClusteredLayers);
      }
    };

    updateClusters();
  }, [clusterableDatasets, viewState.zoom]);

  // Clear cluster cache when datasets are removed
  useEffect(() => {
    return () => {
      clearClusterCache();
    };
  }, []);

  // Combine non-clustered and clustered layers
  const layers = useMemo(() => {
    const nonClusteredLayers = nonClusterableDatasets
      .map((dataset: Dataset) => createLayerFromDataset(dataset))
      .filter(Boolean);

    // For clusterable datasets, use clustered layer if available, otherwise regular layer
    const pointLayers = clusterableDatasets
      .map((dataset: Dataset) => {
        const clustered = clusteredLayers[dataset.id];
        if (clustered) {
          return clustered;
        }
        // Fallback to regular layer while cluster loads
        return createLayerFromDataset(dataset);
      })
      .filter(Boolean);

    return [...nonClusteredLayers, ...pointLayers];
  }, [nonClusterableDatasets, clusterableDatasets, clusteredLayers]);

  const onViewStateChange = useCallback(
    ({ viewState: newViewState }: { viewState: unknown }) => {
      setViewState(newViewState as typeof viewState);
    },
    [setViewState]
  );

  const onClick = useCallback(
    (info: { object?: unknown; coordinate?: [number, number] }) => {
      // Delegate to measurement tool if active
      if (measureClickHandler.current && info.coordinate) {
        measureClickHandler.current(info);
        return;
      }

      const obj = info.object as { properties?: { cluster?: boolean; point_count?: number } } | undefined;

      // Handle cluster click - zoom in
      if (obj?.properties?.cluster && info.coordinate) {
        const [longitude, latitude] = info.coordinate;
        setViewState({
          ...viewState,
          longitude,
          latitude,
          zoom: Math.min(viewState.zoom + 2, 18),
        });
        return;
      }

      if (info.object) {
        setSelectedFeature(info.object);
      } else {
        setSelectedFeature(null);
      }
    },
    [setSelectedFeature, setViewState, viewState]
  );

  const getTooltip = useCallback(
    ({ object }: { object?: { properties?: Record<string, unknown> } }) => {
      if (!object || !object.properties) return null;

      const props = object.properties;

      // Escape HTML to prevent XSS
      const escapeHtml = (str: string): string => {
        const htmlEscapes: Record<string, string> = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        };
        return str.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
      };

      // Handle cluster tooltip
      if (props.cluster && props.point_count) {
        return {
          html: `<div class="deck-tooltip"><strong>${props.point_count} features</strong><br/><span style="font-size: 11px; color: #666;">Click to zoom in</span></div>`,
          style: {
            backgroundColor: 'transparent',
            border: 'none',
          },
        };
      }

      const content = Object.entries(props)
        .filter(([k, v]) => v !== null && v !== undefined && k !== 'cluster' && k !== 'cluster_id')
        .slice(0, 5)
        .map(([k, v]) => `<strong>${escapeHtml(String(k))}:</strong> ${escapeHtml(String(v))}`)
        .join('<br/>');

      return {
        html: `<div class="deck-tooltip">${content}</div>`,
        style: {
          backgroundColor: 'transparent',
          border: 'none',
        },
      };
    },
    []
  );

  // Check if any visible external layers have truncated results
  const hasVisibleTruncated = useMemo(() => {
    for (const id of truncatedLayers) {
      if (visibleDatasets.has(id)) return true;
    }
    return false;
  }, [truncatedLayers, visibleDatasets]);

  // Check if any visible datasets require a higher zoom level
  const belowMinZoomDatasets = useMemo(() => {
    return datasets.filter(
      d => visibleDatasets.has(d.id) && d.min_zoom > 0 && d.min_zoom > Math.floor(viewState.zoom)
    );
  }, [datasets, visibleDatasets, viewState.zoom]);

  return (
    <div className="map-container" ref={deckRef}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
        layers={layers}
        onClick={onClick}
        getTooltip={getTooltip}
      >
        <Map mapStyle={mapStyle} />
      </DeckGL>
      <BasemapGallery />
      <FeatureDetailPanel />

      {/* Map Toolbar */}
      <div className="absolute top-14 right-6 flex flex-col gap-1 z-10">
        <button
          onClick={() => setShowMeasure(!showMeasure)}
          className={`p-2 rounded-lg shadow border ${showMeasure ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          title="Measure distance/area"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 2L2 6l16 16 4-4L6 2zm2 8l2 2m2-6l2 2m2-6l2 2" />
          </svg>
        </button>
        <button
          onClick={() => {
            const canvas = deckRef.current?.querySelector('canvas');
            if (canvas) {
              const link = document.createElement('a');
              link.download = 'map-export.png';
              link.href = (canvas as HTMLCanvasElement).toDataURL('image/png');
              link.click();
            }
          }}
          className="p-2 rounded-lg shadow border bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
          title="Export map as PNG"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </div>

      {showMeasure && (
        <MeasureTool
          onClose={() => { setShowMeasure(false); measureClickHandler.current = null; }}
          onMapClick={(handler) => { measureClickHandler.current = handler; }}
        />
      )}
      {belowMinZoomDatasets.length > 0 && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-blue-50 border border-blue-300 text-blue-800 px-4 py-2 rounded-lg shadow text-sm flex items-center gap-2 z-10">
          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          {belowMinZoomDatasets.length === 1
            ? `Zoom in to level ${belowMinZoomDatasets[0].min_zoom} to view ${belowMinZoomDatasets[0].name}`
            : `Zoom in to level ${Math.max(...belowMinZoomDatasets.map(d => d.min_zoom))} to view ${belowMinZoomDatasets.length} layers`
          }
        </div>
      )}
      {hasVisibleTruncated && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-amber-50 border border-amber-300 text-amber-800 px-4 py-2 rounded-lg shadow text-sm flex items-center gap-2 z-10">
          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {(() => {
            const truncatedDs = datasets.find(d => truncatedLayers.has(d.id) && visibleDatasets.has(d.id));
            const featureCount = (truncatedDs?.service_metadata as Record<string, unknown> | null)?.feature_count as number | undefined;
            return featureCount
              ? `Zoom in to see all features — layer has ${featureCount.toLocaleString()} features`
              : 'Zoom in to see all features — some layers have more data than shown';
          })()}
        </div>
      )}
    </div>
  );
}
