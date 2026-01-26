// Type declarations for deck.gl modules
declare module '@deck.gl/react' {
  import { ReactNode } from 'react';

  export interface DeckGLProps {
    initialViewState?: {
      longitude: number;
      latitude: number;
      zoom: number;
      pitch?: number;
      bearing?: number;
    };
    controller?: boolean | object;
    layers?: unknown[];
    onViewStateChange?: (params: { viewState: unknown }) => void;
    style?: React.CSSProperties;
    children?: ReactNode;
    [key: string]: unknown;
  }

  export default function DeckGL(props: DeckGLProps): JSX.Element;
}
declare module '@deck.gl/layers' {
  export class GeoJsonLayer<D = unknown> {
    constructor(props: GeoJsonLayerProps<D>);
    id: string;
  }

  export class BitmapLayer {
    constructor(props: BitmapLayerProps);
  }

  export interface GeoJsonLayerProps<D = unknown> {
    id: string;
    data: string | D;
    pickable?: boolean;
    stroked?: boolean;
    filled?: boolean;
    extruded?: boolean;
    pointType?: string;
    lineWidthScale?: number;
    lineWidthMinPixels?: number;
    getFillColor?: number[] | ((d: unknown) => number[]);
    getLineColor?: number[] | ((d: unknown) => number[]);
    getLineWidth?: number | ((d: unknown) => number);
    getPointRadius?: number | ((d: unknown) => number);
    pointRadiusMinPixels?: number;
    updateTriggers?: Record<string, unknown>;
    loadOptions?: {
      fetch?: {
        headers?: Record<string, string>;
      };
    };
    [key: string]: unknown;
  }

  export interface BitmapLayerProps {
    id: string;
    bounds: number[];
    image: string;
    [key: string]: unknown;
  }
}

declare module '@deck.gl/geo-layers' {
  export class TileLayer {
    constructor(props: TileLayerProps);
    id: string;
  }

  export interface TileLayerProps {
    id: string;
    data: string;
    minZoom?: number;
    maxZoom?: number;
    tileSize?: number;
    loadOptions?: {
      fetch?: {
        headers?: Record<string, string>;
      };
    };
    renderSubLayers?: (props: TileSubLayerProps) => unknown;
    [key: string]: unknown;
  }

  export interface TileSubLayerProps {
    id: string;
    data: unknown;
    tile: {
      boundingBox: [[number, number], [number, number]];
      bbox: {
        west: number;
        south: number;
        east: number;
        north: number;
      };
    };
    [key: string]: unknown;
  }
}
