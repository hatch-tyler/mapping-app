import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import * as datasetsApi from '../api/datasets';
import { UploadJob, BundleStatusResponse } from '../api/types';

/** Default tick cadence between status calls. */
const DEFAULT_INTERVAL_MS = 2000;
/** Default budget: how long to keep retrying without a single successful
 *  status response before declaring the connection lost. 90 s comfortably
 *  rides out a brief network blip while staying short enough that a stuck
 *  poll is surfaced to the user before they wander off. */
const DEFAULT_LOST_CONNECTION_MS = 90_000;

/** Reasons a poll loop terminates. ``done`` = the work-unit reached its
 *  natural terminal state (e.g. job ``completed``/``failed``). ``job-vanished``
 *  = the work-unit no longer exists on the server (HTTP 404), which means
 *  the upload was rejected and rolled back before tracking could begin —
 *  surfaced to the user as a distinct failure mode from a network outage.
 *  ``lost-connection`` = the configured budget elapsed with no successful
 *  status response (genuine connectivity problem). */
export type PollTerminateReason = 'done' | 'job-vanished' | 'lost-connection';

export interface PollOptions {
  intervalMs?: number;
  lostConnectionBudgetMs?: number;
  /** Predicate that classifies an error as a permanent "the resource we are
   *  polling is gone" condition (terminate immediately), as opposed to a
   *  transient network/server hiccup (retry until the budget expires).
   *  Default: HTTP 404. HTTP 401 is intentionally NOT treated as terminal —
   *  the axios refresh interceptor handles it transparently. */
  isJobVanished?: (err: unknown) => boolean;
}

const defaultIsJobVanished = (err: unknown): boolean =>
  axios.isAxiosError(err) && err.response?.status === 404;

/** Drive an async polling loop with sequential ticks, an elapsed-time
 *  "lost connection" budget, and clean cancellation via AbortSignal.
 *
 *  The loop awaits each ``fn()`` before scheduling the next tick (no
 *  overlapping in-flight calls if the server is slow). Returns a Promise
 *  that resolves with the termination reason and the most recent value
 *  observed (if any). Aborts via ``signal.aborted`` resolve with ``done``
 *  silently — callers should check ``signal.aborted`` to distinguish
 *  cancellation from a normal completion.
 */
export async function pollUntilDone<T>(
  fn: (signal: AbortSignal) => Promise<{ done: boolean; value: T }>,
  signal: AbortSignal,
  options?: PollOptions,
): Promise<{ reason: PollTerminateReason; value: T | null }> {
  const interval = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const budget = options?.lostConnectionBudgetMs ?? DEFAULT_LOST_CONNECTION_MS;
  const isVanished = options?.isJobVanished ?? defaultIsJobVanished;

  let lastSuccessAt = Date.now();
  let latest: T | null = null;

  // First tick fires after a delay so the caller doesn't observe two
  // back-to-back requests (the upload POST itself just returned).
  while (!signal.aborted) {
    await sleep(interval, signal);
    if (signal.aborted) return { reason: 'done', value: latest };

    try {
      const { done, value } = await fn(signal);
      latest = value;
      lastSuccessAt = Date.now();
      if (done) return { reason: 'done', value: latest };
    } catch (err) {
      if (signal.aborted) return { reason: 'done', value: latest };
      if (isVanished(err)) return { reason: 'job-vanished', value: latest };
      if (Date.now() - lastSuccessAt >= budget) {
        return { reason: 'lost-connection', value: latest };
      }
      // otherwise keep going — transient error, ride it out
    }
  }
  return { reason: 'done', value: latest };
}

/** Resolves after ``ms`` or when ``signal`` aborts (whichever comes first). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Internal: drives a polling loop with bounded failure tolerance.
 *
 *  Sequential — only one ``fn()`` is in flight at any time. Cancels in-flight
 *  requests on unmount via AbortController (callers that hit network must
 *  forward the signal to honour cancellation; status fetches that don't take
 *  the signal will simply have their settle ignored after unmount). */
export function usePoller<T>(
  fn: (signal: AbortSignal) => Promise<{ done: boolean; value: T }>,
  enabled: boolean,
  onTerminate?: (reason: PollTerminateReason) => void,
  options?: PollOptions,
): T | null {
  const [latest, setLatest] = useState<T | null>(null);
  const onTerminateRef = useRef(onTerminate);
  onTerminateRef.current = onTerminate;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    (async () => {
      const { reason } = await pollUntilDone<T>(
        async (signal) => {
          const r = await fnRef.current(signal);
          if (!controller.signal.aborted) setLatest(r.value);
          return r;
        },
        controller.signal,
        optionsRef.current,
      );
      if (controller.signal.aborted) return;
      onTerminateRef.current?.(reason);
    })();

    return () => controller.abort();
    // fn / options are captured via refs so callers don't need to memoize.
    // To re-fetch a different job/bundle, toggle ``enabled`` (or change keys
    // upstream so the parent recreates the hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return latest;
}

export interface PollJobResult {
  job: UploadJob | null;
  status: 'idle' | 'polling' | 'completed' | 'failed' | 'job-vanished' | 'lost-connection';
}

/** Poll a single upload job until it completes or fails.
 *
 *  Surfaces the latest job snapshot plus a derived status. Pass
 *  ``jobId === null`` to leave the poller idle. */
export function usePollJob(
  jobId: string | null,
  options?: PollOptions,
): PollJobResult {
  const [terminal, setTerminal] = useState<PollJobResult['status'] | null>(null);

  useEffect(() => {
    setTerminal(null);
  }, [jobId]);

  const job = usePoller<UploadJob>(
    async () => {
      if (!jobId) return { done: true, value: null as unknown as UploadJob };
      const j = await datasetsApi.getUploadJobStatus(jobId);
      const done = j.status === 'completed' || j.status === 'failed';
      if (done) setTerminal(j.status === 'completed' ? 'completed' : 'failed');
      return { done, value: j };
    },
    jobId !== null,
    (reason) => {
      if (reason === 'job-vanished') setTerminal('job-vanished');
      else if (reason === 'lost-connection') setTerminal('lost-connection');
    },
    options,
  );

  let status: PollJobResult['status'] = 'idle';
  if (jobId !== null) {
    status = terminal ?? 'polling';
  }
  return { job, status };
}

export interface PollBundleSummary {
  total: number;
  completed: number;
  failed: number;
}

export interface PollBundleResult {
  detail: BundleStatusResponse | null;
  summary: PollBundleSummary;
  status: 'idle' | 'polling' | 'completed' | 'failed' | 'job-vanished' | 'lost-connection';
}

/** Poll a bundle by its bundle_id until every job has terminal status.
 *
 *  Pass ``bundleId === null`` to leave the poller idle. ``status`` becomes
 *  'completed' when at least one job succeeded, 'failed' when all failed. */
export function usePollBundle(
  bundleId: string | null,
  options?: PollOptions,
): PollBundleResult {
  const [terminal, setTerminal] = useState<PollBundleResult['status'] | null>(null);

  useEffect(() => {
    setTerminal(null);
  }, [bundleId]);

  const detail = usePoller<BundleStatusResponse>(
    async () => {
      if (!bundleId) {
        return { done: true, value: null as unknown as BundleStatusResponse };
      }
      const d = await datasetsApi.getBundleStatus(bundleId);
      const allDone = d.jobs.every(
        (j) => j.status === 'completed' || j.status === 'failed',
      );
      if (allDone) {
        const anyOk = d.jobs.some((j) => j.status === 'completed');
        setTerminal(anyOk ? 'completed' : 'failed');
      }
      return { done: allDone, value: d };
    },
    bundleId !== null,
    (reason) => {
      if (reason === 'job-vanished') setTerminal('job-vanished');
      else if (reason === 'lost-connection') setTerminal('lost-connection');
    },
    options,
  );

  const summary: PollBundleSummary = detail
    ? {
        total: detail.jobs.length,
        completed: detail.jobs.filter((j) => j.status === 'completed').length,
        failed: detail.jobs.filter((j) => j.status === 'failed').length,
      }
    : { total: 0, completed: 0, failed: 0 };

  let status: PollBundleResult['status'] = 'idle';
  if (bundleId !== null) status = terminal ?? 'polling';

  return { detail, summary, status };
}
