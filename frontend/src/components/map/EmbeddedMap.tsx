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
  /** Capture at a higher pixel ratio for print-quality export. */
  captureHighRes: (pixelRatio: number) => Promise<HTMLCanvasElement | null>;
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

  // Capture helper shared by captureImage and captureHighRes.
  const doCapture = async (): Promise<HTMLCanvasElement | null> => {
    const deckInstance = deckRef.current?.deck;
    const mapInstance = mapRef.current?.getMap?.();

    if (deckInstance && typeof deckInstance.redraw === 'function') {
      deckInstance.redraw(true);
    }

    const mapCanvas = mapInstance?.getCanvas?.() as HTMLCanvasElement | undefined;
    const deckCanvas = deckInstance?.canvas as HTMLCanvasElement | undefined;
    const refCanvas = mapCanvas || deckCanvas;
    if (!refCanvas) return null;

    const w = refCanvas.width || refCanvas.clientWidth || width;
    const h = refCanvas.height || refCanvas.clientHeight || height;
    if (w === 0 || h === 0) return null;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = w;
    exportCanvas.height = h;
    const ctx = exportCanvas.getContext('2d')!;

    if (mapCanvas) {
      try {
        const img = await loadImage(mapCanvas.toDataURL('image/png'));
        ctx.drawImage(img, 0, 0, w, h);
      } catch { /* skip */ }
    }
    if (deckCanvas && deckCanvas !== mapCanvas) {
      try {
        const img = await loadImage(deckCanvas.toDataURL('image/png'));
        ctx.drawImage(img, 0, 0, w, h);
      } catch { /* skip */ }
    }
    return exportCanvas;
  };

  useImperativeHandle(ref, () => ({
    redraw: () => {
      const deckInstance = deckRef.current?.deck;
      if (deckInstance && typeof deckInstance.redraw === 'function') {
        deckInstance.redraw(true);
      }
    },
    getContainer: () => containerRef.current,
    captureImage: doCapture,
    captureHighRes: async (pixelRatio: number) => {
      const deckInstance = deckRef.current?.deck;
      const mapInstance = mapRef.current?.getMap?.();

      // Inflate both canvases to the target resolution by setting
      // the pixel ratio on both rendering engines.
      const targetW = Math.round(width * pixelRatio);
      const targetH = Math.round(height * pixelRatio);

      // MapLibre: resize the canvas drawing buffer
      if (mapInstance) {
        const mapCanvas = mapInstance.getCanvas();
        if (mapCanvas) {
          mapCanvas.width = targetW;
          mapCanvas.height = targetH;
        }
        mapInstance.resize();
        mapInstance.triggerRepaint();
      }

      // DeckGL: resize canvas drawing buffer
      if (deckInstance?.canvas) {
        deckInstance.canvas.width = targetW;
        deckInstance.canvas.height = targetH;
      }
      if (deckInstance?.animationLoop?.gl) {
        const gl = deckInstance.animationLoop.gl;
        gl.viewport(0, 0, targetW, targetH);
      }
      if (deckInstance?.redraw) {
        deckInstance.redraw(true);
      }

      // Wait for both engines to finish rendering at the new resolution
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      );

      // Capture at high resolution
      const result = await doCapture();

      // Restore original resolution
      if (mapInstance) {
        const mapCanvas = mapInstance.getCanvas();
        if (mapCanvas) {
          mapCanvas.width = width * (window.devicePixelRatio || 1);
          mapCanvas.height = height * (window.devicePixelRatio || 1);
        }
        mapInstance.resize();
        mapInstance.triggerRepaint();
      }
      if (deckInstance?.canvas) {
        deckInstance.canvas.width = width * (window.devicePixelRatio || 1);
        deckInstance.canvas.height = height * (window.devicePixelRatio || 1);
      }
      if (deckInstance?.redraw) {
        deckInstance.redraw(true);
      }

      return result;
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
