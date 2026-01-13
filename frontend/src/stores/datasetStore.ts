import { create } from 'zustand';
import { Dataset } from '../api/types';
import * as datasetsApi from '../api/datasets';

interface DatasetState {
  datasets: Dataset[];
  loading: boolean;
  error: string | null;

  fetchDatasets: () => Promise<void>;
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

  fetchDatasets: async () => {
    set({ loading: true, error: null });
    try {
      const response = await datasetsApi.getDatasets();
      set({ datasets: response.datasets, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch datasets',
        loading: false,
      });
    }
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
