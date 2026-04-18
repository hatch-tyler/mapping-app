import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import type { Basemap } from '../../stores/mapStore';
import { captureMapCanvas } from '../templates/FigureExporter';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface EmbeddedViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface EmbeddedMapHandle {
  redraw: () => void;
  getContainer: () => HTMLDivElement | null;
  captureImage: () => Promise<HTMLCanvasElement | null>;
}

interface Props {
  viewState: EmbeddedViewState;
  onViewStateChange: (vs: EmbeddedViewState) => void;
  layers: unknown[];
  basemap: Basemap;
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

export const EmbeddedMap = forwardRef<EmbeddedMapHandle, Props>(function EmbeddedMap(
  { viewState, onViewStateChange, layers, basemap, width, height },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deckRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    redraw: () => {
      const deckInstance = deckRef.current?.deck;
      if (deckInstance && typeof deckInstance.redraw === 'function') {
        deckInstance.redraw(true);
      }
    },
    getContainer: () => containerRef.current,
    captureImage: async () => {
      // Force a synchronous render so the WebGL buffer is populated
      const deckInstance = deckRef.current?.deck;
      if (deckInstance && typeof deckInstance.redraw === 'function') {
        deckInstance.redraw(true);
      }
      if (!containerRef.current) return null;
      return captureMapCanvas(containerRef.current);
    },
  }));

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
      ref={containerRef}
      style={{ width, height, position: 'relative', overflow: 'hidden' }}
    >
      <DeckGL
        ref={deckRef}
        viewState={viewState}
        onViewStateChange={handleChange}
        controller={true}
        layers={layers}
        width={width}
        height={height}
        glOptions={{ preserveDrawingBuffer: true }}
      >
        <Map mapStyle={mapStyle} preserveDrawingBuffer={true} />
      </DeckGL>
    </div>
  );
});
