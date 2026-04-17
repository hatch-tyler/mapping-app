import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import { useMapStore } from '../../stores/mapStore';
import { useDatasetStore } from '../../stores/datasetStore';
import { createLayerFromDataset } from '../../utils/layerFactory';
import { createClusteredLayer, shouldUseClustering, clearClusterCache } from '../../utils/clusterLayer';
import { FeatureDetailPanel } from './FeatureDetailPanel';
import { MeasureTool } from './MeasureTool';
import { MapControls, MapWarnings } from './MapControls';
import { FigureExportModal } from './FigureExportModal';
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
  const { viewState, setViewState, visibleDatasets, truncatedLayers, setSelectedFeature, currentBasemap, layerOrder } =
    useMapStore();
  const { datasets } = useDatasetStore();
  const [clusteredLayers, setClusteredLayers] = useState<Record<string, unknown>>({});
  const [showMeasure, setShowMeasure] = useState(false);
  const [showFigureExport, setShowFigureExport] = useState(false);
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

    const allLayers = [...nonClusteredLayers, ...pointLayers].flat();

    if (layerOrder.length === 0) return allLayers;

    return [...allLayers].sort((a, b) => {
      const idOf = (layer: unknown) => {
        const lid = (layer as { id?: string })?.id ?? '';
        const ds = visibleDatasetsList.find((d) => lid.includes(d.id));
        return ds?.id ?? '';
      };
      const posA = layerOrder.indexOf(idOf(a));
      const posB = layerOrder.indexOf(idOf(b));
      const effA = posA === -1 ? layerOrder.length : posA;
      const effB = posB === -1 ? layerOrder.length : posB;
      return effA - effB;
    });
  }, [nonClusterableDatasets, clusterableDatasets, clusteredLayers, layerOrder, visibleDatasetsList]);

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
    ({ object, layer }: { object?: { properties?: Record<string, unknown> }; layer?: { id?: string } }) => {
      if (!object || !object.properties) return null;

      const props = object.properties;

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

      if (props.cluster && props.point_count) {
        return {
          html: `<div class="deck-tooltip"><strong>${props.point_count} features</strong><br/><span style="font-size: 11px; color: #666;">Click to zoom in</span></div>`,
          style: {
            backgroundColor: 'transparent',
            border: 'none',
          },
        };
      }

      // Look up the dataset's hoverFields from its style_config.
      // Layer IDs contain the dataset ID (e.g. "vector-{uuid}", "ext-vec-{uuid}").
      let hoverFields: string[] | undefined;
      if (layer?.id) {
        const ds = datasets.find((d) => layer.id!.includes(d.id));
        if (ds) {
          const cfg = ds.style_config as Partial<{ hoverFields?: string[] }> | undefined;
          hoverFields = cfg?.hoverFields;
        }
      }

      const entries = Object.entries(props)
        .filter(([k, v]) => v !== null && v !== undefined && k !== 'cluster' && k !== 'cluster_id');

      const filtered = hoverFields?.length
        ? entries.filter(([k]) => hoverFields!.includes(k))
        : entries.slice(0, 5);

      if (filtered.length === 0) return null;

      const content = filtered
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
    [datasets]
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
        glOptions={{ preserveDrawingBuffer: true }}
      >
        <Map mapStyle={mapStyle} preserveDrawingBuffer={true} />
      </DeckGL>
      <FeatureDetailPanel />
      <MapControls
        showMeasure={showMeasure}
        onToggleMeasure={() => setShowMeasure(!showMeasure)}
        onExportFigure={() => setShowFigureExport(true)}
        deckRef={deckRef}
      />

      {showMeasure && (
        <MeasureTool
          onClose={() => { setShowMeasure(false); measureClickHandler.current = null; }}
          onMapClick={(handler) => { measureClickHandler.current = handler; }}
        />
      )}
      {showFigureExport && (
        <FigureExportModal
          deckRef={deckRef}
          onClose={() => setShowFigureExport(false)}
        />
      )}
      <MapWarnings
        belowMinZoomDatasets={belowMinZoomDatasets}
        hasVisibleTruncated={hasVisibleTruncated}
        truncatedDataset={datasets.find(d => truncatedLayers.has(d.id) && visibleDatasets.has(d.id))}
      />
    </div>
  );
}
