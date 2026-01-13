import { describe, it, expect, beforeEach } from 'vitest';
import { useMapStore, AVAILABLE_BASEMAPS } from './mapStore';

describe('mapStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useMapStore.setState({
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
    });
  });

  describe('initial state', () => {
    it('should have correct initial view state', () => {
      const state = useMapStore.getState();

      expect(state.viewState.longitude).toBe(-98.5795);
      expect(state.viewState.latitude).toBe(39.8283);
      expect(state.viewState.zoom).toBe(4);
      expect(state.viewState.pitch).toBe(0);
      expect(state.viewState.bearing).toBe(0);
    });

    it('should have empty visible datasets set', () => {
      const state = useMapStore.getState();

      expect(state.visibleDatasets.size).toBe(0);
    });

    it('should have null selected feature', () => {
      const state = useMapStore.getState();

      expect(state.selectedFeature).toBeNull();
    });
  });

  describe('setViewState', () => {
    it('should update view state', () => {
      const newViewState = {
        longitude: -122.4,
        latitude: 37.8,
        zoom: 12,
        pitch: 45,
        bearing: 90,
      };

      useMapStore.getState().setViewState(newViewState);

      const state = useMapStore.getState();
      expect(state.viewState).toEqual(newViewState);
    });

    it('should replace entire view state', () => {
      const newViewState = {
        longitude: 0,
        latitude: 0,
        zoom: 1,
        pitch: 0,
        bearing: 0,
      };

      useMapStore.getState().setViewState(newViewState);

      expect(useMapStore.getState().viewState.longitude).toBe(0);
      expect(useMapStore.getState().viewState.latitude).toBe(0);
    });
  });

  describe('toggleDatasetVisibility', () => {
    it('should add dataset to visible set when not present', () => {
      useMapStore.getState().toggleDatasetVisibility('dataset-1');

      expect(useMapStore.getState().visibleDatasets.has('dataset-1')).toBe(true);
    });

    it('should remove dataset from visible set when present', () => {
      // First add the dataset
      useMapStore.getState().toggleDatasetVisibility('dataset-1');
      expect(useMapStore.getState().visibleDatasets.has('dataset-1')).toBe(true);

      // Toggle again to remove
      useMapStore.getState().toggleDatasetVisibility('dataset-1');
      expect(useMapStore.getState().visibleDatasets.has('dataset-1')).toBe(false);
    });

    it('should handle multiple datasets independently', () => {
      useMapStore.getState().toggleDatasetVisibility('dataset-1');
      useMapStore.getState().toggleDatasetVisibility('dataset-2');
      useMapStore.getState().toggleDatasetVisibility('dataset-3');

      const visibleDatasets = useMapStore.getState().visibleDatasets;
      expect(visibleDatasets.size).toBe(3);
      expect(visibleDatasets.has('dataset-1')).toBe(true);
      expect(visibleDatasets.has('dataset-2')).toBe(true);
      expect(visibleDatasets.has('dataset-3')).toBe(true);

      // Toggle one off
      useMapStore.getState().toggleDatasetVisibility('dataset-2');
      expect(useMapStore.getState().visibleDatasets.has('dataset-2')).toBe(false);
      expect(useMapStore.getState().visibleDatasets.size).toBe(2);
    });
  });

  describe('setDatasetVisible', () => {
    it('should add dataset when visible is true', () => {
      useMapStore.getState().setDatasetVisible('dataset-1', true);

      expect(useMapStore.getState().visibleDatasets.has('dataset-1')).toBe(true);
    });

    it('should remove dataset when visible is false', () => {
      // First add it
      useMapStore.getState().setDatasetVisible('dataset-1', true);
      expect(useMapStore.getState().visibleDatasets.has('dataset-1')).toBe(true);

      // Then remove it
      useMapStore.getState().setDatasetVisible('dataset-1', false);
      expect(useMapStore.getState().visibleDatasets.has('dataset-1')).toBe(false);
    });

    it('should not add duplicate when setting visible true twice', () => {
      useMapStore.getState().setDatasetVisible('dataset-1', true);
      useMapStore.getState().setDatasetVisible('dataset-1', true);

      expect(useMapStore.getState().visibleDatasets.size).toBe(1);
    });

    it('should handle removing non-existent dataset', () => {
      useMapStore.getState().setDatasetVisible('non-existent', false);

      expect(useMapStore.getState().visibleDatasets.size).toBe(0);
    });
  });

  describe('setVisibleDatasets', () => {
    it('should replace visible datasets with new set', () => {
      // Add some initial datasets
      useMapStore.getState().toggleDatasetVisibility('old-1');
      useMapStore.getState().toggleDatasetVisibility('old-2');

      // Replace with new set
      useMapStore.getState().setVisibleDatasets(['new-1', 'new-2', 'new-3']);

      const visibleDatasets = useMapStore.getState().visibleDatasets;
      expect(visibleDatasets.size).toBe(3);
      expect(visibleDatasets.has('old-1')).toBe(false);
      expect(visibleDatasets.has('old-2')).toBe(false);
      expect(visibleDatasets.has('new-1')).toBe(true);
      expect(visibleDatasets.has('new-2')).toBe(true);
      expect(visibleDatasets.has('new-3')).toBe(true);
    });

    it('should handle empty array', () => {
      useMapStore.getState().toggleDatasetVisibility('dataset-1');
      useMapStore.getState().setVisibleDatasets([]);

      expect(useMapStore.getState().visibleDatasets.size).toBe(0);
    });

    it('should deduplicate array entries', () => {
      useMapStore.getState().setVisibleDatasets(['dataset-1', 'dataset-1', 'dataset-2']);

      expect(useMapStore.getState().visibleDatasets.size).toBe(2);
    });
  });

  describe('setSelectedFeature', () => {
    it('should set selected feature', () => {
      const feature = {
        type: 'Feature',
        properties: { name: 'Test Feature' },
        geometry: { type: 'Point', coordinates: [0, 0] },
      };

      useMapStore.getState().setSelectedFeature(feature);

      expect(useMapStore.getState().selectedFeature).toEqual(feature);
    });

    it('should clear selected feature with null', () => {
      const feature = { id: 'test' };
      useMapStore.getState().setSelectedFeature(feature);
      expect(useMapStore.getState().selectedFeature).not.toBeNull();

      useMapStore.getState().setSelectedFeature(null);
      expect(useMapStore.getState().selectedFeature).toBeNull();
    });

    it('should replace previous selected feature', () => {
      useMapStore.getState().setSelectedFeature({ id: 'first' });
      useMapStore.getState().setSelectedFeature({ id: 'second' });

      expect(useMapStore.getState().selectedFeature).toEqual({ id: 'second' });
    });
  });

  describe('basemap functionality', () => {
    it('should have default basemap set to first available basemap', () => {
      const state = useMapStore.getState();

      expect(state.currentBasemap).toEqual(AVAILABLE_BASEMAPS[0]);
      expect(state.currentBasemap.id).toBe('positron');
    });

    it('should have basemap gallery closed by default', () => {
      const state = useMapStore.getState();

      expect(state.isBasemapGalleryOpen).toBe(false);
    });

    it('should change basemap when setBasemap is called', () => {
      const darkMatterBasemap = AVAILABLE_BASEMAPS.find((b) => b.id === 'dark-matter')!;

      useMapStore.getState().setBasemap(darkMatterBasemap);

      const state = useMapStore.getState();
      expect(state.currentBasemap.id).toBe('dark-matter');
      expect(state.currentBasemap.name).toBe('Dark Matter');
    });

    it('should close gallery when basemap is selected', () => {
      // Open gallery first
      useMapStore.getState().toggleBasemapGallery();
      expect(useMapStore.getState().isBasemapGalleryOpen).toBe(true);

      // Select a basemap
      useMapStore.getState().setBasemap(AVAILABLE_BASEMAPS[1]);

      // Gallery should be closed
      expect(useMapStore.getState().isBasemapGalleryOpen).toBe(false);
    });

    it('should toggle basemap gallery open and closed', () => {
      expect(useMapStore.getState().isBasemapGalleryOpen).toBe(false);

      useMapStore.getState().toggleBasemapGallery();
      expect(useMapStore.getState().isBasemapGalleryOpen).toBe(true);

      useMapStore.getState().toggleBasemapGallery();
      expect(useMapStore.getState().isBasemapGalleryOpen).toBe(false);
    });

    it('should set basemap gallery open state directly', () => {
      useMapStore.getState().setBasemapGalleryOpen(true);
      expect(useMapStore.getState().isBasemapGalleryOpen).toBe(true);

      useMapStore.getState().setBasemapGalleryOpen(false);
      expect(useMapStore.getState().isBasemapGalleryOpen).toBe(false);
    });
  });

  describe('AVAILABLE_BASEMAPS', () => {
    it('should have multiple basemaps available', () => {
      expect(AVAILABLE_BASEMAPS.length).toBeGreaterThan(1);
    });

    it('should have required properties for each basemap', () => {
      AVAILABLE_BASEMAPS.forEach((basemap) => {
        expect(basemap).toHaveProperty('id');
        expect(basemap).toHaveProperty('name');
        expect(basemap).toHaveProperty('url');
        expect(basemap).toHaveProperty('thumbnail');
        expect(typeof basemap.id).toBe('string');
        expect(typeof basemap.name).toBe('string');
        expect(typeof basemap.url).toBe('string');
        expect(typeof basemap.thumbnail).toBe('string');
      });
    });

    it('should have unique ids for each basemap', () => {
      const ids = AVAILABLE_BASEMAPS.map((b) => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include a satellite/aerial imagery basemap', () => {
      const satelliteBasemap = AVAILABLE_BASEMAPS.find((b) => b.id === 'satellite');
      expect(satelliteBasemap).toBeDefined();
      expect(satelliteBasemap!.name).toBe('Satellite');
      expect(satelliteBasemap!.url).toContain('World_Imagery');
    });
  });
});
