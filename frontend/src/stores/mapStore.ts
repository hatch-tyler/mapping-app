import { create } from 'zustand';

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface Basemap {
  id: string;
  name: string;
  url: string;
  thumbnail: string;
}

// Preview tile coordinates (z/x/y) for thumbnail generation - centered roughly on US
const PREVIEW_Z = 4;
const PREVIEW_X = 5;
const PREVIEW_Y = 6;

// Generate Carto raster tile URL for preview
const cartoPreview = (style: string) =>
  `https://a.basemaps.cartocdn.com/${style}/${PREVIEW_Z}/${PREVIEW_X}/${PREVIEW_Y}.png`;

// Generate Stadia raster tile URL for preview
const esriPreview = (service: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/${PREVIEW_Z}/${PREVIEW_Y}/${PREVIEW_X}`;

export const AVAILABLE_BASEMAPS: Basemap[] = [
  {
    id: 'positron',
    name: 'Positron',
    url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    thumbnail: cartoPreview('light_all'),
  },
  {
    id: 'dark-matter',
    name: 'Dark Matter',
    url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    thumbnail: cartoPreview('dark_all'),
  },
  {
    id: 'voyager',
    name: 'Voyager',
    url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    thumbnail: cartoPreview('rastertiles/voyager'),
  },
  {
    id: 'satellite',
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    thumbnail: esriPreview('World_Imagery'),
  },
  {
    id: 'streets',
    name: 'Streets',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    thumbnail: esriPreview('World_Street_Map'),
  },
  {
    id: 'topographic',
    name: 'Topographic',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    thumbnail: esriPreview('World_Topo_Map'),
  },
  {
    id: 'light-gray',
    name: 'Light Gray',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    thumbnail: esriPreview('Canvas/World_Light_Gray_Base'),
  },
  {
    id: 'natgeo',
    name: 'National Geographic',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    thumbnail: esriPreview('NatGeo_World_Map'),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
    thumbnail: esriPreview('Ocean/World_Ocean_Base'),
  },
];

interface MapState {
  viewState: ViewState;
  visibleDatasets: Set<string>;
  truncatedLayers: Set<string>;
  selectedFeature: unknown | null;
  currentBasemap: Basemap;
  isBasemapGalleryOpen: boolean;

  setViewState: (viewState: ViewState) => void;
  toggleDatasetVisibility: (datasetId: string) => void;
  setDatasetVisible: (datasetId: string, visible: boolean) => void;
  setVisibleDatasets: (ids: string[]) => void;
  setLayerTruncated: (datasetId: string, truncated: boolean) => void;
  zoomToBounds: (bounds: number[]) => void;
  setSelectedFeature: (feature: unknown | null) => void;
  setBasemap: (basemap: Basemap) => void;
  toggleBasemapGallery: () => void;
  setBasemapGalleryOpen: (open: boolean) => void;
  layerOrder: string[];
  setLayerOrder: (order: string[]) => void;
}

export const useMapStore = create<MapState>((set) => ({
  viewState: {
    longitude: -98.5795,
    latitude: 39.8283,
    zoom: 4,
    pitch: 0,
    bearing: 0,
  },

  visibleDatasets: new Set<string>(),
  truncatedLayers: new Set<string>(),
  selectedFeature: null,
  currentBasemap: AVAILABLE_BASEMAPS[0],
  isBasemapGalleryOpen: false,

  setViewState: (viewState) => set({ viewState }),

  toggleDatasetVisibility: (datasetId) =>
    set((state) => {
      const newSet = new Set(state.visibleDatasets);
      if (newSet.has(datasetId)) {
        newSet.delete(datasetId);
      } else {
        newSet.add(datasetId);
      }
      return { visibleDatasets: newSet };
    }),

  setDatasetVisible: (datasetId, visible) =>
    set((state) => {
      const newSet = new Set(state.visibleDatasets);
      if (visible) {
        newSet.add(datasetId);
      } else {
        newSet.delete(datasetId);
      }
      return { visibleDatasets: newSet };
    }),

  setVisibleDatasets: (ids) => set({ visibleDatasets: new Set(ids) }),

  setLayerTruncated: (datasetId, truncated) =>
    set((state) => {
      const newSet = new Set(state.truncatedLayers);
      if (truncated) {
        newSet.add(datasetId);
      } else {
        newSet.delete(datasetId);
      }
      return { truncatedLayers: newSet };
    }),

  zoomToBounds: (bounds) =>
    set((state) => {
      const [minx, miny, maxx, maxy] = bounds;
      const centerLon = (minx + maxx) / 2;
      const centerLat = (miny + maxy) / 2;
      const latDiff = maxy - miny;
      const lonDiff = maxx - minx;
      const maxDiff = Math.max(latDiff, lonDiff);
      const zoom = maxDiff > 0 ? Math.min(Math.floor(Math.log2(360 / maxDiff)), 18) : 12;
      return {
        viewState: {
          ...state.viewState,
          longitude: centerLon,
          latitude: centerLat,
          zoom: Math.max(zoom, 2),
        },
      };
    }),

  setSelectedFeature: (feature) => set({ selectedFeature: feature }),

  setBasemap: (basemap) => set({ currentBasemap: basemap, isBasemapGalleryOpen: false }),

  toggleBasemapGallery: () =>
    set((state) => ({ isBasemapGalleryOpen: !state.isBasemapGalleryOpen })),

  setBasemapGalleryOpen: (open) => set({ isBasemapGalleryOpen: open }),

  layerOrder: (() => {
    try {
      const raw = localStorage.getItem('map:layer-order');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  })(),

  setLayerOrder: (order) => {
    try { localStorage.setItem('map:layer-order', JSON.stringify(order)); } catch { /* */ }
    set({ layerOrder: order });
  },
}));
