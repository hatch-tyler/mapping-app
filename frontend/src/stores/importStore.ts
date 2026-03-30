import { create } from 'zustand';
import { apiClient } from '@/api/client';
import { useToastStore } from './toastStore';

interface ActiveImport {
  jobId: string;
  datasetId: string;
  datasetName: string;
  progress: number;
  status: 'polling' | 'completed' | 'failed';
}

interface ImportState {
  activeImports: Record<string, ActiveImport>;
  startImport: (datasetId: string, datasetName: string, jobId: string) => void;
  getProgress: (datasetId: string) => number | null;
  isImporting: (datasetId: string) => boolean;
}

export const useImportStore = create<ImportState>((set, get) => ({
  activeImports: {},

  startImport: (datasetId, datasetName, jobId) => {
    set((state) => ({
      activeImports: {
        ...state.activeImports,
        [datasetId]: { jobId, datasetId, datasetName, progress: 0, status: 'polling' },
      },
    }));

    // Start polling in the store (persists across navigation)
    const poll = async () => {
      while (true) { // eslint-disable-line no-constant-condition
        await new Promise((r) => setTimeout(r, 2000));
        const current = get().activeImports[datasetId];
        if (!current || current.status !== 'polling') return;

        try {
          const resp = await apiClient.get(`/upload/status/${jobId}`);
          const job = resp.data;

          set((state) => ({
            activeImports: {
              ...state.activeImports,
              [datasetId]: { ...state.activeImports[datasetId], progress: job.progress },
            },
          }));

          if (job.status === 'completed') {
            set((state) => ({
              activeImports: {
                ...state.activeImports,
                [datasetId]: { ...state.activeImports[datasetId], status: 'completed', progress: 100 },
              },
            }));
            useToastStore.getState().addToast(
              `Successfully imported "${datasetName}" to local storage`,
              'success'
            );
            // Remove after brief delay so UI can update
            setTimeout(() => {
              set((state) => {
                const { [datasetId]: _, ...rest } = state.activeImports;
                return { activeImports: rest };
              });
            }, 3000);
            return;
          }

          if (job.status === 'failed') {
            set((state) => ({
              activeImports: {
                ...state.activeImports,
                [datasetId]: { ...state.activeImports[datasetId], status: 'failed' },
              },
            }));
            useToastStore.getState().addToast(
              `Import failed: ${job.error_message || 'Unknown error'}`,
              'error'
            );
            setTimeout(() => {
              set((state) => {
                const { [datasetId]: _, ...rest } = state.activeImports;
                return { activeImports: rest };
              });
            }, 5000);
            return;
          }
        } catch {
          // Polling error — keep trying
        }
      }
    };

    poll();
  },

  getProgress: (datasetId) => {
    const imp = get().activeImports[datasetId];
    return imp ? imp.progress : null;
  },

  isImporting: (datasetId) => {
    const imp = get().activeImports[datasetId];
    return imp?.status === 'polling';
  },
}));
