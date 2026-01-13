import { useMemo, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import { useMapStore } from '../../stores/mapStore';
import { useDatasetStore } from '../../stores/datasetStore';
import { createLayerFromDataset } from '../../utils/layerFactory';
import { BasemapGallery } from './BasemapGallery';
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

  // Generate the appropriate map style based on basemap type
  const mapStyle = useMemo(() => {
    if (isRasterTileUrl(currentBasemap.url)) {
      return createRasterStyle(currentBasemap.url);
    }
    return currentBasemap.url;
  }, [currentBasemap.url]);

  const layers = useMemo(() => {
    return datasets
      .filter((d) => visibleDatasets.has(d.id) && d.is_visible)
      .map((dataset) => createLayerFromDataset(dataset))
      .filter(Boolean);
  }, [datasets, visibleDatasets]);

  const onViewStateChange = useCallback(
    ({ viewState: newViewState }: { viewState: typeof viewState }) => {
      setViewState(newViewState);
    },
    [setViewState]
  );

  const onClick = useCallback(
    (info: { object?: unknown }) => {
      if (info.object) {
        setSelectedFeature(info.object);
      } else {
        setSelectedFeature(null);
      }
    },
    [setSelectedFeature]
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

      const content = Object.entries(props)
        .filter(([, v]) => v !== null && v !== undefined)
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
