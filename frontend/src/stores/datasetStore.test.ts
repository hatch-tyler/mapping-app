import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDatasetStore } from './datasetStore';
import * as datasetsApi from '../api/datasets';
import { createMockDataset } from '../__tests__/mockData';

// Mock the datasets API module
vi.mock('../api/datasets', () => ({
  getDatasets: vi.fn(),
  toggleVisibility: vi.fn(),
}));

const mockDatasets = [
  createMockDataset({
    id: '1',
    name: 'Dataset 1',
    description: 'First dataset',
    data_type: 'vector',
    geometry_type: 'Point',
    source_format: 'geojson',
    is_visible: true,
    created_at: '2024-01-01T00:00:00Z',
  }),
  createMockDataset({
    id: '2',
    name: 'Dataset 2',
    description: 'Second dataset',
    data_type: 'raster',
    geometry_type: null,
    source_format: 'geotiff',
    is_visible: false,
    created_at: '2024-01-02T00:00:00Z',
  }),
];

describe('datasetStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useDatasetStore.setState({
      datasets: [],
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useDatasetStore.getState();

      expect(state.datasets).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('fetchDatasets', () => {
    it('should fetch and store datasets successfully', async () => {
      vi.mocked(datasetsApi.getDatasets).mockResolvedValue({
        datasets: mockDatasets,
        total: 2,
      });

      await useDatasetStore.getState().fetchDatasets();

      const state = useDatasetStore.getState();
      expect(state.datasets).toEqual(mockDatasets);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set loading state during fetch', async () => {
      vi.mocked(datasetsApi.getDatasets).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ datasets: [], total: 0 }), 100)
          )
      );

      const fetchPromise = useDatasetStore.getState().fetchDatasets();

      // Loading should be true during fetch
      expect(useDatasetStore.getState().loading).toBe(true);

      await fetchPromise;

      expect(useDatasetStore.getState().loading).toBe(false);
    });

    it('should handle fetch error', async () => {
      vi.mocked(datasetsApi.getDatasets).mockRejectedValue(new Error('Network error'));

      await useDatasetStore.getState().fetchDatasets();

      const state = useDatasetStore.getState();
      expect(state.datasets).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBe('Network error');
    });

    it('should handle non-Error rejection', async () => {
      vi.mocked(datasetsApi.getDatasets).mockRejectedValue('Some string error');

      await useDatasetStore.getState().fetchDatasets();

      expect(useDatasetStore.getState().error).toBe('Failed to fetch datasets');
    });

    it('should clear previous error on new fetch', async () => {
      useDatasetStore.setState({ error: 'Previous error' });

      vi.mocked(datasetsApi.getDatasets).mockResolvedValue({
        datasets: [],
        total: 0,
      });

      await useDatasetStore.getState().fetchDatasets();

      expect(useDatasetStore.getState().error).toBeNull();
    });
  });

  describe('addDataset', () => {
    it('should add dataset to the beginning of the list', () => {
      useDatasetStore.setState({ datasets: [mockDatasets[1]] });

      useDatasetStore.getState().addDataset(mockDatasets[0]);

      const datasets = useDatasetStore.getState().datasets;
      expect(datasets.length).toBe(2);
      expect(datasets[0].id).toBe('1');
      expect(datasets[1].id).toBe('2');
    });

    it('should add dataset to empty list', () => {
      useDatasetStore.getState().addDataset(mockDatasets[0]);

      expect(useDatasetStore.getState().datasets.length).toBe(1);
      expect(useDatasetStore.getState().datasets[0]).toEqual(mockDatasets[0]);
    });
  });

  describe('updateDataset', () => {
    it('should update specific dataset', () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      useDatasetStore.getState().updateDataset('1', { name: 'Updated Name' });

      const dataset = useDatasetStore.getState().datasets.find((d) => d.id === '1');
      expect(dataset?.name).toBe('Updated Name');
    });

    it('should not modify other datasets', () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      useDatasetStore.getState().updateDataset('1', { name: 'Updated Name' });

      const dataset2 = useDatasetStore.getState().datasets.find((d) => d.id === '2');
      expect(dataset2?.name).toBe('Dataset 2');
    });

    it('should handle updating non-existent dataset', () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      useDatasetStore.getState().updateDataset('non-existent', { name: 'New Name' });

      // Datasets should remain unchanged
      expect(useDatasetStore.getState().datasets).toEqual(mockDatasets);
    });

    it('should merge updates with existing properties', () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      useDatasetStore.getState().updateDataset('1', { description: 'New description' });

      const dataset = useDatasetStore.getState().datasets.find((d) => d.id === '1');
      expect(dataset?.name).toBe('Dataset 1'); // Original name preserved
      expect(dataset?.description).toBe('New description'); // New description
    });
  });

  describe('removeDataset', () => {
    it('should remove dataset by id', () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      useDatasetStore.getState().removeDataset('1');

      const datasets = useDatasetStore.getState().datasets;
      expect(datasets.length).toBe(1);
      expect(datasets[0].id).toBe('2');
    });

    it('should handle removing non-existent dataset', () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      useDatasetStore.getState().removeDataset('non-existent');

      expect(useDatasetStore.getState().datasets.length).toBe(2);
    });

    it('should handle removing from empty list', () => {
      useDatasetStore.getState().removeDataset('1');

      expect(useDatasetStore.getState().datasets.length).toBe(0);
    });
  });

  describe('toggleVisibility', () => {
    it('should toggle dataset visibility via API', async () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      const updatedDataset = { ...mockDatasets[0], is_visible: false };
      vi.mocked(datasetsApi.toggleVisibility).mockResolvedValue(updatedDataset);

      await useDatasetStore.getState().toggleVisibility('1');

      expect(datasetsApi.toggleVisibility).toHaveBeenCalledWith('1', false);
      const dataset = useDatasetStore.getState().datasets.find((d) => d.id === '1');
      expect(dataset?.is_visible).toBe(false);
    });

    it('should toggle from false to true', async () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      const updatedDataset = { ...mockDatasets[1], is_visible: true };
      vi.mocked(datasetsApi.toggleVisibility).mockResolvedValue(updatedDataset);

      await useDatasetStore.getState().toggleVisibility('2');

      expect(datasetsApi.toggleVisibility).toHaveBeenCalledWith('2', true);
      const dataset = useDatasetStore.getState().datasets.find((d) => d.id === '2');
      expect(dataset?.is_visible).toBe(true);
    });

    it('should handle API error', async () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      vi.mocked(datasetsApi.toggleVisibility).mockRejectedValue(new Error('API Error'));

      await useDatasetStore.getState().toggleVisibility('1');

      expect(useDatasetStore.getState().error).toBe('API Error');
      // Dataset should remain unchanged
      const dataset = useDatasetStore.getState().datasets.find((d) => d.id === '1');
      expect(dataset?.is_visible).toBe(true);
    });

    it('should handle non-Error rejection', async () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      vi.mocked(datasetsApi.toggleVisibility).mockRejectedValue('String error');

      await useDatasetStore.getState().toggleVisibility('1');

      expect(useDatasetStore.getState().error).toBe('Failed to toggle visibility');
    });

    it('should do nothing for non-existent dataset', async () => {
      useDatasetStore.setState({ datasets: [...mockDatasets] });

      await useDatasetStore.getState().toggleVisibility('non-existent');

      expect(datasetsApi.toggleVisibility).not.toHaveBeenCalled();
    });
  });

  describe('setLoading', () => {
    it('should set loading state to true', () => {
      useDatasetStore.getState().setLoading(true);

      expect(useDatasetStore.getState().loading).toBe(true);
    });

    it('should set loading state to false', () => {
      useDatasetStore.setState({ loading: true });
      useDatasetStore.getState().setLoading(false);

      expect(useDatasetStore.getState().loading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      useDatasetStore.getState().setError('Test error');

      expect(useDatasetStore.getState().error).toBe('Test error');
    });

    it('should clear error with null', () => {
      useDatasetStore.setState({ error: 'Previous error' });
      useDatasetStore.getState().setError(null);

      expect(useDatasetStore.getState().error).toBeNull();
    });
  });
});
