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
const stadiaPreview = (style: string) =>
  `https://tiles.stadiamaps.com/tiles/${style}/${PREVIEW_Z}/${PREVIEW_X}/${PREVIEW_Y}.png`;

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
    thumbnail: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${PREVIEW_Z}/${PREVIEW_Y}/${PREVIEW_X}`,
  },
  {
    id: 'osm-bright',
    name: 'OSM Bright',
    url: 'https://tiles.stadiamaps.com/styles/osm_bright.json',
    thumbnail: stadiaPreview('osm_bright'),
  },
  {
    id: 'alidade-smooth',
    name: 'Alidade Smooth',
    url: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
    thumbnail: stadiaPreview('alidade_smooth'),
  },
  {
    id: 'alidade-smooth-dark',
    name: 'Alidade Dark',
    url: 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json',
    thumbnail: stadiaPreview('alidade_smooth_dark'),
  },
  {
    id: 'outdoors',
    name: 'Outdoors',
    url: 'https://tiles.stadiamaps.com/styles/outdoors.json',
    thumbnail: stadiaPreview('outdoors'),
  },
  {
    id: 'stamen-toner',
    name: 'Stamen Toner',
    url: 'https://tiles.stadiamaps.com/styles/stamen_toner.json',
    thumbnail: stadiaPreview('stamen_toner'),
  },
];

interface MapState {
  viewState: ViewState;
  visibleDatasets: Set<string>;
  selectedFeature: unknown | null;
  currentBasemap: Basemap;
  isBasemapGalleryOpen: boolean;

  setViewState: (viewState: ViewState) => void;
  toggleDatasetVisibility: (datasetId: string) => void;
  setDatasetVisible: (datasetId: string, visible: boolean) => void;
  setVisibleDatasets: (ids: string[]) => void;
  setSelectedFeature: (feature: unknown | null) => void;
  setBasemap: (basemap: Basemap) => void;
  toggleBasemapGallery: () => void;
  setBasemapGalleryOpen: (open: boolean) => void;
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

  setSelectedFeature: (feature) => set({ selectedFeature: feature }),

  setBasemap: (basemap) => set({ currentBasemap: basemap, isBasemapGalleryOpen: false }),

  toggleBasemapGallery: () =>
    set((state) => ({ isBasemapGalleryOpen: !state.isBasemapGalleryOpen })),

  setBasemapGalleryOpen: (open) => set({ isBasemapGalleryOpen: open }),
}));
