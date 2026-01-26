import { useMemo, useCallback, useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import { useMapStore } from '../../stores/mapStore';
import { useDatasetStore } from '../../stores/datasetStore';
import { createLayerFromDataset } from '../../utils/layerFactory';
import { createClusteredLayer, shouldUseClustering, clearClusterCache } from '../../utils/clusterLayer';
import { BasemapGallery } from './BasemapGallery';
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
  const { viewState, setViewState, visibleDatasets, setSelectedFeature, currentBasemap } =
    useMapStore();
  const { datasets } = useDatasetStore();
  const [clusteredLayers, setClusteredLayers] = useState<Record<string, unknown>>({});

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
  useEffect(() => {
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

      setClusteredLayers(newClusteredLayers);
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

  return (
    <div className="map-container">
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
    </div>
  );
}
