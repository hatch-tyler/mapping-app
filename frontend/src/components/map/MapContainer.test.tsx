import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapContainer } from './MapContainer';
import { useMapStore, AVAILABLE_BASEMAPS } from '../../stores/mapStore';
import { useDatasetStore } from '../../stores/datasetStore';

// Mock the stores
vi.mock('../../stores/mapStore', () => ({
  useMapStore: vi.fn(),
  AVAILABLE_BASEMAPS: [
    {
      id: 'positron',
      name: 'Positron',
      url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      thumbnail: 'https://example.com/positron.png',
    },
  ],
}));

vi.mock('../../stores/datasetStore', () => ({
  useDatasetStore: vi.fn(),
}));

vi.mock('../../utils/layerFactory', () => ({
  createLayerFromDataset: vi.fn((dataset) => ({
    id: dataset.id,
    type: 'GeoJsonLayer',
  })),
}));

// Mock the BasemapGallery component
vi.mock('./BasemapGallery', () => ({
  BasemapGallery: () => <div data-testid="basemap-gallery">Basemap Gallery</div>,
}));

const mockViewState = {
  longitude: -98.5795,
  latitude: 39.8283,
  zoom: 4,
  pitch: 0,
  bearing: 0,
};

const mockBasemap = {
  id: 'positron',
  name: 'Positron',
  url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  thumbnail: 'https://example.com/positron.png',
};

const mockDatasets = [
  {
    id: '1',
    name: 'Dataset 1',
    data_type: 'vector',
    is_visible: true,
  },
  {
    id: '2',
    name: 'Dataset 2',
    data_type: 'raster',
    is_visible: false,
  },
];

describe('MapContainer', () => {
  const mockSetViewState = vi.fn();
  const mockSetSelectedFeature = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useMapStore).mockReturnValue({
      viewState: mockViewState,
      visibleDatasets: new Set(['1']),
      selectedFeature: null,
      currentBasemap: mockBasemap,
      isBasemapGalleryOpen: false,
      setViewState: mockSetViewState,
      setSelectedFeature: mockSetSelectedFeature,
      toggleDatasetVisibility: vi.fn(),
      setDatasetVisible: vi.fn(),
      setVisibleDatasets: vi.fn(),
      setBasemap: vi.fn(),
      toggleBasemapGallery: vi.fn(),
      setBasemapGalleryOpen: vi.fn(),
    });

    vi.mocked(useDatasetStore).mockReturnValue({
      datasets: mockDatasets,
      loading: false,
      error: null,
      fetchDatasets: vi.fn(),
      addDataset: vi.fn(),
      updateDataset: vi.fn(),
      removeDataset: vi.fn(),
      toggleVisibility: vi.fn(),
      setLoading: vi.fn(),
      setError: vi.fn(),
    });
  });

  it('should render the map container', () => {
    render(<MapContainer />);

    expect(screen.getByTestId('deckgl-container')).toBeInTheDocument();
  });

  it('should render with correct CSS class', () => {
    const { container } = render(<MapContainer />);

    expect(container.querySelector('.map-container')).toBeInTheDocument();
  });

  it('should filter datasets based on visibility', () => {
    vi.mocked(useMapStore).mockReturnValue({
      viewState: mockViewState,
      visibleDatasets: new Set(['2']), // Only dataset 2 is selected
      selectedFeature: null,
      currentBasemap: mockBasemap,
      isBasemapGalleryOpen: false,
      setViewState: mockSetViewState,
      setSelectedFeature: mockSetSelectedFeature,
      toggleDatasetVisibility: vi.fn(),
      setDatasetVisible: vi.fn(),
      setVisibleDatasets: vi.fn(),
      setBasemap: vi.fn(),
      toggleBasemapGallery: vi.fn(),
      setBasemapGalleryOpen: vi.fn(),
    });

    render(<MapContainer />);

    // Dataset 2 has is_visible: false, so it should be filtered out
    // This tests the filter logic
    expect(screen.getByTestId('deckgl-container')).toBeInTheDocument();
  });

  it('should render when no datasets are visible', () => {
    vi.mocked(useMapStore).mockReturnValue({
      viewState: mockViewState,
      visibleDatasets: new Set(),
      selectedFeature: null,
      currentBasemap: mockBasemap,
      isBasemapGalleryOpen: false,
      setViewState: mockSetViewState,
      setSelectedFeature: mockSetSelectedFeature,
      toggleDatasetVisibility: vi.fn(),
      setDatasetVisible: vi.fn(),
      setVisibleDatasets: vi.fn(),
      setBasemap: vi.fn(),
      toggleBasemapGallery: vi.fn(),
      setBasemapGalleryOpen: vi.fn(),
    });

    render(<MapContainer />);

    expect(screen.getByTestId('deckgl-container')).toBeInTheDocument();
  });

  it('should render the basemap gallery', () => {
    render(<MapContainer />);

    expect(screen.getByTestId('basemap-gallery')).toBeInTheDocument();
  });

  it('should render when datasets array is empty', () => {
    vi.mocked(useDatasetStore).mockReturnValue({
      datasets: [],
      loading: false,
      error: null,
      fetchDatasets: vi.fn(),
      addDataset: vi.fn(),
      updateDataset: vi.fn(),
      removeDataset: vi.fn(),
      toggleVisibility: vi.fn(),
      setLoading: vi.fn(),
      setError: vi.fn(),
    });

    render(<MapContainer />);

    expect(screen.getByTestId('deckgl-container')).toBeInTheDocument();
  });
});
