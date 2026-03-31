import { create } from 'zustand';
import { apiClient } from '@/api/client';
import { useToastStore } from './toastStore';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 300 * 2s = 10 minutes max
const MAX_CONSECUTIVE_ERRORS = 10;

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
  cancelImport: (datasetId: string) => void;
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
      let attempts = 0;
      let consecutiveErrors = 0;

      while (attempts < MAX_POLL_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        attempts++;

        const current = get().activeImports[datasetId];
        if (!current || current.status !== 'polling') return;

        try {
          const resp = await apiClient.get(`/upload/status/${jobId}`);
          const job = resp.data;
          consecutiveErrors = 0;

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
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            set((state) => ({
              activeImports: {
                ...state.activeImports,
                [datasetId]: { ...state.activeImports[datasetId], status: 'failed' },
              },
            }));
            useToastStore.getState().addToast(
              `Import polling failed after ${MAX_CONSECUTIVE_ERRORS} consecutive network errors`,
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
        }
      }

      // Exceeded max attempts — mark as failed
      set((state) => ({
        activeImports: {
          ...state.activeImports,
          [datasetId]: { ...state.activeImports[datasetId], status: 'failed' },
        },
      }));
      useToastStore.getState().addToast(
        `Import timed out after ${Math.round((MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60000)} minutes`,
        'error'
      );
      setTimeout(() => {
        set((state) => {
          const { [datasetId]: _, ...rest } = state.activeImports;
          return { activeImports: rest };
        });
      }, 5000);
    };

    poll();
  },

  cancelImport: (datasetId) => {
    set((state) => ({
      activeImports: {
        ...state.activeImports,
        [datasetId]: { ...state.activeImports[datasetId], status: 'failed' },
      },
    }));
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
