import { create } from 'zustand';
import { Dataset, DatasetFilters } from '../api/types';
import * as datasetsApi from '../api/datasets';

interface DatasetState {
  datasets: Dataset[];
  loading: boolean;
  error: string | null;
  filters: DatasetFilters;

  fetchDatasets: (filters?: DatasetFilters) => Promise<void>;
  setFilters: (filters: DatasetFilters) => void;
  addDataset: (dataset: Dataset) => void;
  updateDataset: (id: string, updates: Partial<Dataset>) => void;
  removeDataset: (id: string) => void;
  toggleVisibility: (id: string) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useDatasetStore = create<DatasetState>((set, get) => ({
  datasets: [],
  loading: false,
  error: null,
  filters: {},

  fetchDatasets: async (filters?: DatasetFilters) => {
    set({ loading: true, error: null });
    try {
      const activeFilters = filters ?? get().filters;
      const response = await datasetsApi.getDatasets(0, 500, false, activeFilters);
      set({ datasets: response.datasets, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch datasets',
        loading: false,
      });
    }
  },

  setFilters: (filters) => {
    set({ filters });
    get().fetchDatasets(filters);
  },

  addDataset: (dataset) =>
    set((state) => ({
      datasets: [dataset, ...state.datasets],
    })),

  updateDataset: (id, updates) =>
    set((state) => ({
      datasets: state.datasets.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      ),
    })),

  removeDataset: (id) =>
    set((state) => ({
      datasets: state.datasets.filter((d) => d.id !== id),
    })),

  toggleVisibility: async (id) => {
    const dataset = get().datasets.find((d) => d.id === id);
    if (!dataset) return;

    try {
      const updated = await datasetsApi.toggleVisibility(id, !dataset.is_visible);
      set((state) => ({
        datasets: state.datasets.map((d) => (d.id === id ? updated : d)),
      }));
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to toggle visibility',
      });
    }
  },

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
