import { useEffect, useRef, useState } from 'react';
import * as datasetsApi from '../api/datasets';
import { UploadJob, BundleStatusResponse } from '../api/types';

const POLL_INTERVAL_MS = 2000;
const MAX_FAILURES_BEFORE_GIVE_UP = 30;

/** Internal: drives a polling loop with bounded failure tolerance. The
 *  callback returns ``done: true`` to stop polling normally, or throws to
 *  trip the failure counter. Exits silently on unmount. */
export function usePoller<T>(
  fn: () => Promise<{ done: boolean; value: T }>,
  enabled: boolean,
  onTerminate?: (reason: 'done' | 'lost-connection') => void,
): T | null {
  const [latest, setLatest] = useState<T | null>(null);
  const failuresRef = useRef(0);
  const onTerminateRef = useRef(onTerminate);
  onTerminateRef.current = onTerminate;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    failuresRef.current = 0;

    const id = setInterval(async () => {
      if (stopped) return;
      try {
        const { done, value } = await fn();
        if (stopped) return;
        failuresRef.current = 0;
        setLatest(value);
        if (done) {
          stopped = true;
          clearInterval(id);
          onTerminateRef.current?.('done');
        }
      } catch {
        failuresRef.current += 1;
        if (failuresRef.current >= MAX_FAILURES_BEFORE_GIVE_UP) {
          stopped = true;
          clearInterval(id);
          onTerminateRef.current?.('lost-connection');
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(id);
    };
    // fn is captured at mount-time to avoid restart on every render. Callers
    // that need to re-fetch a different job/bundle should toggle ``enabled``.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return latest;
}

export interface PollJobResult {
  job: UploadJob | null;
  status: 'idle' | 'polling' | 'completed' | 'failed' | 'lost-connection';
}

/** Poll a single upload job until it completes or fails.
 *
 *  Surfaces the latest job snapshot plus a derived status. Pass
 *  ``jobId === null`` to leave the poller idle. */
export function usePollJob(jobId: string | null): PollJobResult {
  const [terminal, setTerminal] =
    useState<'completed' | 'failed' | 'lost-connection' | null>(null);

  // Reset the terminal flag when the job-id changes.
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
      if (reason === 'lost-connection') setTerminal('lost-connection');
    },
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
  status: 'idle' | 'polling' | 'completed' | 'failed' | 'lost-connection';
}

/** Poll a bundle by its bundle_id until every job has terminal status.
 *
 *  Pass ``bundleId === null`` to leave the poller idle. ``status`` becomes
 *  'completed' when at least one job succeeded, 'failed' when all failed. */
export function usePollBundle(bundleId: string | null): PollBundleResult {
  const [terminal, setTerminal] =
    useState<'completed' | 'failed' | 'lost-connection' | null>(null);

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
      if (reason === 'lost-connection') setTerminal('lost-connection');
    },
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
