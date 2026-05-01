import { create } from 'zustand';
import { apiClient } from '@/api/client';
import { useToastStore } from './toastStore';
import { pollUntilDone } from '@/hooks/usePollJob';

/** Hard ceiling on wall-clock time for an external import. The backend
 *  task runs independently; this is a UI safety net so the toast doesn't
 *  spin forever if the backend dies in a way the polling can't detect. */
const MAX_TOTAL_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const TICK_INTERVAL_MS = 2000;

interface ActiveImport {
  jobId: string;
  datasetId: string;
  datasetName: string;
  progress: number;
  status: 'polling' | 'completed' | 'failed';
}

interface ImportState {
  activeImports: Record<string, ActiveImport>;
  /** AbortController per active import so cancelImport / overwrite can stop
   *  the polling loop cleanly. Kept off the public state — these are not
   *  part of the rendered Zustand snapshot. */
  startImport: (datasetId: string, datasetName: string, jobId: string) => void;
  cancelImport: (datasetId: string) => void;
  getProgress: (datasetId: string) => number | null;
  isImporting: (datasetId: string) => boolean;
}

const _abortControllers = new Map<string, AbortController>();

export const useImportStore = create<ImportState>((set, get) => ({
  activeImports: {},

  startImport: (datasetId, datasetName, jobId) => {
    // Cancel any prior polling for this dataset before kicking off a new one.
    _abortControllers.get(datasetId)?.abort();

    set((state) => ({
      activeImports: {
        ...state.activeImports,
        [datasetId]: { jobId, datasetId, datasetName, progress: 0, status: 'polling' },
      },
    }));

    const controller = new AbortController();
    _abortControllers.set(datasetId, controller);

    // Hard cap on total wall-clock duration. Aborts the controller, which
    // pollUntilDone interprets as a clean stop.
    const totalTimeout = setTimeout(() => controller.abort(), MAX_TOTAL_DURATION_MS);

    const removeAfter = (ms: number) => {
      setTimeout(() => {
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [datasetId]: _removed, ...rest } = state.activeImports;
          return { activeImports: rest };
        });
      }, ms);
    };

    (async () => {
      const result = await pollUntilDone<{ progress: number; status: string; error_message?: string | null }>(
        async () => {
          const current = get().activeImports[datasetId];
          if (!current || current.status !== 'polling') {
            return { done: true, value: { progress: 0, status: 'cancelled' } };
          }
          const resp = await apiClient.get(`/upload/status/${jobId}`);
          const job = resp.data as {
            progress: number;
            status: string;
            error_message?: string | null;
          };
          set((state) => ({
            activeImports: {
              ...state.activeImports,
              [datasetId]: { ...state.activeImports[datasetId], progress: job.progress },
            },
          }));
          const done = job.status === 'completed' || job.status === 'failed';
          return { done, value: job };
        },
        controller.signal,
        {
          intervalMs: TICK_INTERVAL_MS,
          // Generous budget for external imports — the network leg can stall
          // for tens of seconds when fetching big external datasets.
          lostConnectionBudgetMs: 120_000,
        },
      );
      clearTimeout(totalTimeout);
      _abortControllers.delete(datasetId);

      if (controller.signal.aborted) return; // user cancelled or duration cap

      const job = result.value;
      const toast = useToastStore.getState();

      if (result.reason === 'job-vanished') {
        set((state) => ({
          activeImports: {
            ...state.activeImports,
            [datasetId]: { ...state.activeImports[datasetId], status: 'failed' },
          },
        }));
        toast.addToast(
          `Import of "${datasetName}" was rejected before tracking could begin — please retry`,
          'error',
        );
        removeAfter(5000);
        return;
      }

      if (result.reason === 'lost-connection') {
        set((state) => ({
          activeImports: {
            ...state.activeImports,
            [datasetId]: { ...state.activeImports[datasetId], status: 'failed' },
          },
        }));
        toast.addToast(
          `Lost connection while importing "${datasetName}" — refresh the catalog to check status`,
          'error',
        );
        removeAfter(5000);
        return;
      }

      // result.reason === 'done' — terminal job state observed
      if (job?.status === 'completed') {
        set((state) => ({
          activeImports: {
            ...state.activeImports,
            [datasetId]: { ...state.activeImports[datasetId], status: 'completed', progress: 100 },
          },
        }));
        toast.addToast(`Successfully imported "${datasetName}" to local storage`, 'success');
        removeAfter(3000);
      } else if (job?.status === 'failed') {
        set((state) => ({
          activeImports: {
            ...state.activeImports,
            [datasetId]: { ...state.activeImports[datasetId], status: 'failed' },
          },
        }));
        toast.addToast(
          `Import failed: ${job.error_message || 'Unknown error'}`,
          'error',
        );
        removeAfter(5000);
      }
    })();
  },

  cancelImport: (datasetId) => {
    _abortControllers.get(datasetId)?.abort();
    _abortControllers.delete(datasetId);
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
