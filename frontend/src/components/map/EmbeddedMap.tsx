import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export const EmbeddedMap = forwardRef<EmbeddedMapHandle, Props>(function EmbeddedMap(
  { viewState, onViewStateChange, layers, basemap, width, height },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deckRef = useRef<any>(null);
  const mapRef = useRef<MapRef>(null);

  useImperativeHandle(ref, () => ({
    redraw: () => {
      const deckInstance = deckRef.current?.deck;
      if (deckInstance && typeof deckInstance.redraw === 'function') {
        deckInstance.redraw(true);
      }
    },
    getContainer: () => containerRef.current,
    captureImage: async () => {
      // Use the MapLibre and DeckGL APIs directly to read their canvases
      // instead of querySelectorAll('canvas') which is unreliable.
      const deckInstance = deckRef.current?.deck;
      const mapInstance = mapRef.current?.getMap?.();

      // Force DeckGL to render the latest frame
      if (deckInstance && typeof deckInstance.redraw === 'function') {
        deckInstance.redraw(true);
      }

      // Strategy 1: Get canvases directly from the instances
      const mapCanvas = mapInstance?.getCanvas?.() as HTMLCanvasElement | undefined;
      const deckCanvas = deckInstance?.canvas as HTMLCanvasElement | undefined;

      // Determine export dimensions from whichever canvas is available
      const refCanvas = mapCanvas || deckCanvas;
      if (!refCanvas) {
        // Fallback: querySelectorAll
        if (!containerRef.current) return null;
        const all = containerRef.current.querySelectorAll('canvas');
        if (all.length === 0) return null;
        const first = all[0] as HTMLCanvasElement;
        const w = first.width || first.clientWidth;
        const h = first.height || first.clientHeight;
        if (w === 0 || h === 0) return null;
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const ctx = out.getContext('2d')!;
        for (const c of Array.from(all)) {
          try {
            const url = (c as HTMLCanvasElement).toDataURL('image/png');
            const im = await loadImage(url);
            ctx.drawImage(im, 0, 0, w, h);
          } catch { /* skip */ }
        }
        return out;
      }

      const w = refCanvas.width || refCanvas.clientWidth || width;
      const h = refCanvas.height || refCanvas.clientHeight || height;
      if (w === 0 || h === 0) return null;

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = w;
      exportCanvas.height = h;
      const ctx = exportCanvas.getContext('2d')!;

      // Layer 1: MapLibre basemap
      if (mapCanvas) {
        try {
          const url = mapCanvas.toDataURL('image/png');
          const img = await loadImage(url);
          ctx.drawImage(img, 0, 0, w, h);
        } catch (e) {
          console.warn('Failed to capture MapLibre canvas:', e);
        }
      }

      // Layer 2: DeckGL data layers (overlay)
      if (deckCanvas && deckCanvas !== mapCanvas) {
        try {
          const url = deckCanvas.toDataURL('image/png');
          const img = await loadImage(url);
          ctx.drawImage(img, 0, 0, w, h);
        } catch (e) {
          console.warn('Failed to capture DeckGL canvas:', e);
        }
      }

      // If only one canvas was found (interleaved rendering — deck.gl
      // renders INTO MapLibre's context), the single capture above
      // already has both basemap and data layers.

      return exportCanvas;
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
        <Map ref={mapRef} mapStyle={mapStyle} preserveDrawingBuffer={true} />
      </DeckGL>
    </div>
  );
});
