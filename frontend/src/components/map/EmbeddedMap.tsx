import { forwardRef, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import type { Basemap } from '../../stores/mapStore';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface EmbeddedViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

interface Props {
  viewState: EmbeddedViewState;
  onViewStateChange: (vs: EmbeddedViewState) => void;
  layers: unknown[];
  basemap: Basemap;
  /** Pixel width × height of the map container. */
  width: number;
  height: number;
}

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

function isRasterTileUrl(url: string): boolean {
  return url.includes('{z}') && url.includes('{x}') && url.includes('{y}');
}

/**
 * A self-contained MapLibre + DeckGL instance used inside the figure export
 * modal. It manages its own viewState so panning/zooming here doesn't mutate
 * the main map. The caller owns the container ref, which is used for
 * capturing the rendered canvases at export time.
 */
export const EmbeddedMap = forwardRef<HTMLDivElement, Props>(function EmbeddedMap(
  { viewState, onViewStateChange, layers, basemap, width, height },
  ref,
) {
  const mapStyle = useMemo(() => {
    if (isRasterTileUrl(basemap.url)) return createRasterStyle(basemap.url);
    return basemap.url;
  }, [basemap.url]);

  const handleChange = useCallback(
    ({ viewState: vs }: { viewState: unknown }) => {
      onViewStateChange(vs as EmbeddedViewState);
    },
    [onViewStateChange],
  );

  return (
    <div
      ref={ref}
      style={{ width, height, position: 'relative', overflow: 'hidden' }}
      className="bg-gray-200 rounded border border-gray-300"
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleChange}
        controller={true}
        layers={layers}
        width={width}
        height={height}
        glOptions={{ preserveDrawingBuffer: true }}
        _animate={false}
      >
        <Map mapStyle={mapStyle} preserveDrawingBuffer={true} />
      </DeckGL>
    </div>
  );
});
