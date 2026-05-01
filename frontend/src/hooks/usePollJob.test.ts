import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { pollUntilDone, usePollJob } from './usePollJob';
import * as datasetsApi from '../api/datasets';
import { createMockUploadJob } from '../__tests__/mockData';

vi.mock('../api/datasets', () => ({
  getUploadJobStatus: vi.fn(),
  getBundleStatus: vi.fn(),
}));

// Helper to build an axios-like 404 error for the terminal-error classifier.
function axios404(): Error {
  // axios.isAxiosError checks an internal flag; mimic a real response error.
  const err = new Error('Request failed with status code 404') as Error & {
    isAxiosError: boolean;
    response: { status: number };
    config: object;
    toJSON: () => object;
  };
  err.isAxiosError = true;
  err.response = { status: 404 };
  err.config = {};
  err.toJSON = () => ({});
  return err;
}

function axios500(): Error {
  const err = new Error('Request failed with status code 500') as Error & {
    isAxiosError: boolean;
    response: { status: number };
    config: object;
    toJSON: () => object;
  };
  err.isAxiosError = true;
  err.response = { status: 500 };
  err.config = {};
  err.toJSON = () => ({});
  return err;
}

describe('pollUntilDone', () => {
  it('resolves with done when fn signals completion', async () => {
    const controller = new AbortController();
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: { progress: 50 } })
      .mockResolvedValueOnce({ done: true, value: { progress: 100 } });

    const result = await pollUntilDone(fn, controller.signal, {
      intervalMs: 1,
      lostConnectionBudgetMs: 1000,
    });

    expect(result.reason).toBe('done');
    expect(result.value).toEqual({ progress: 100 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns job-vanished on the first 404', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(axios404());

    const result = await pollUntilDone(fn, controller.signal, {
      intervalMs: 1,
      lostConnectionBudgetMs: 1000,
    });

    expect(result.reason).toBe('job-vanished');
    expect(fn).toHaveBeenCalledTimes(1); // first failure is terminal
  });

  it('keeps retrying on 5xx until budget elapses, then lost-connection', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(axios500());

    const result = await pollUntilDone(fn, controller.signal, {
      intervalMs: 1,
      lostConnectionBudgetMs: 30, // tiny budget for the test
    });

    expect(result.reason).toBe('lost-connection');
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2); // at least retried
  });

  it('aborts cleanly when the signal is fired', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockResolvedValue({ done: false, value: { progress: 0 } });

    const promise = pollUntilDone(fn, controller.signal, {
      intervalMs: 50,
      lostConnectionBudgetMs: 5000,
    });
    // Abort almost immediately, before the first tick.
    controller.abort();

    const result = await promise;
    expect(result.reason).toBe('done');
    expect(fn).not.toHaveBeenCalled();
  });

  it('treats non-axios errors and non-404 axios errors as transient', async () => {
    const controller = new AbortController();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce({ done: true, value: { progress: 100 } });

    const result = await pollUntilDone(fn, controller.signal, {
      intervalMs: 1,
      lostConnectionBudgetMs: 1000,
    });

    expect(result.reason).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses a custom isJobVanished classifier', async () => {
    const controller = new AbortController();
    const sentinel = new Error('gone');
    const fn = vi.fn().mockRejectedValue(sentinel);

    const result = await pollUntilDone(fn, controller.signal, {
      intervalMs: 1,
      lostConnectionBudgetMs: 1000,
      isJobVanished: (e) => e === sentinel,
    });

    expect(result.reason).toBe('job-vanished');
  });

  it('runs ticks sequentially even when fn is slow', async () => {
    const controller = new AbortController();
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = vi.fn().mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      // Stop after 3 calls.
      return fn.mock.calls.length >= 3
        ? { done: true, value: 0 }
        : { done: false, value: 0 };
    });

    await pollUntilDone(fn, controller.signal, {
      intervalMs: 1,
      lostConnectionBudgetMs: 1000,
    });

    // Sequential — never two in flight at once.
    expect(maxInFlight).toBe(1);
  });
});

describe('usePollJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('idle when jobId is null', () => {
    const { result } = renderHook(() => usePollJob(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.job).toBeNull();
  });

  it('transitions to completed when status reaches completed', async () => {
    vi.mocked(datasetsApi.getUploadJobStatus).mockResolvedValue(
      createMockUploadJob({ id: 'j-1', status: 'completed', progress: 100 }),
    );

    const { result } = renderHook(() =>
      usePollJob('j-1', { intervalMs: 5, lostConnectionBudgetMs: 1000 }),
    );

    await waitFor(() => expect(result.current.status).toBe('completed'), {
      timeout: 1000,
    });
    expect(result.current.job?.status).toBe('completed');
  });

  it('transitions to failed and exposes the job error message', async () => {
    vi.mocked(datasetsApi.getUploadJobStatus).mockResolvedValue(
      createMockUploadJob({
        id: 'j-1',
        status: 'failed',
        progress: 0,
        error_message: 'No CRS found',
      }),
    );

    const { result } = renderHook(() =>
      usePollJob('j-1', { intervalMs: 5, lostConnectionBudgetMs: 1000 }),
    );

    await waitFor(() => expect(result.current.status).toBe('failed'), {
      timeout: 1000,
    });
    expect(result.current.job?.error_message).toBe('No CRS found');
  });

  it('transitions to job-vanished on a 404 (no waiting for budget)', async () => {
    vi.mocked(datasetsApi.getUploadJobStatus).mockRejectedValue(axios404());

    const { result } = renderHook(() =>
      usePollJob('j-1', { intervalMs: 5, lostConnectionBudgetMs: 60_000 }),
    );

    // Should resolve fast — far short of the lostConnectionBudgetMs.
    await waitFor(() => expect(result.current.status).toBe('job-vanished'), {
      timeout: 500,
    });
  });

  it('transitions to lost-connection only after the budget elapses', async () => {
    vi.mocked(datasetsApi.getUploadJobStatus).mockRejectedValue(axios500());

    const { result } = renderHook(() =>
      usePollJob('j-1', { intervalMs: 5, lostConnectionBudgetMs: 50 }),
    );

    await waitFor(() => expect(result.current.status).toBe('lost-connection'), {
      timeout: 1000,
    });
  });

  it('cancels in-flight polling on unmount', async () => {
    vi.mocked(datasetsApi.getUploadJobStatus).mockImplementation(async () => {
      // Long-running call. If unmount aborts cleanly, the promise resolution
      // should be ignored and no further calls scheduled.
      await new Promise((r) => setTimeout(r, 50));
      return createMockUploadJob({ id: 'j-1', status: 'processing', progress: 10 });
    });

    const { unmount } = renderHook(() =>
      usePollJob('j-1', { intervalMs: 5, lostConnectionBudgetMs: 60_000 }),
    );

    // Let the loop schedule its first tick.
    await new Promise((r) => setTimeout(r, 20));
    unmount();
    await new Promise((r) => setTimeout(r, 100));

    const callsAfterUnmount = vi.mocked(datasetsApi.getUploadJobStatus).mock.calls
      .length;
    // Wait a bit longer to confirm no new calls land.
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(datasetsApi.getUploadJobStatus).mock.calls.length).toBe(
      callsAfterUnmount,
    );
  });
});

describe('axios.isAxiosError integration', () => {
  // Sanity: confirm our test fakes match what isAxiosError checks for.
  it('recognizes the test 404 helper as an axios error', () => {
    expect(axios.isAxiosError(axios404())).toBe(true);
    expect(axios.isAxiosError(axios500())).toBe(true);
  });
});
