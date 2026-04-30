import { useEffect, useState } from 'react';
import * as datasetsApi from '../../api/datasets';
import { BundleStatusResponse, BundleSummary } from '../../api/types';
import { BundleResultsList } from './BundleResultsList';

const SEVEN_DAYS_MIN = 10080;

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Modal showing the last 7 days of bulk uploads with per-dataset detail
 *  on demand.
 *
 *  The use case: a user finishes a bulk upload, navigates away, and later
 *  realizes "X datasets failed" without recalling which ones. They open
 *  this modal, find the bundle, click it, and see the per-dataset
 *  breakdown via BundleResultsList. */
export function RecentUploadsModal({ open, onClose }: Props) {
  const [summaries, setSummaries] = useState<BundleSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-bundle detail cache; lazy-loaded when a bundle is expanded.
  const [details, setDetails] = useState<Record<string, BundleStatusResponse>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    datasetsApi
      .listRecentBundles(SEVEN_DAYS_MIN)
      .then((s) => {
        if (!cancelled) setSummaries(s);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load recent uploads.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleToggle = async (bundleId: string) => {
    if (expanded === bundleId) {
      setExpanded(null);
      return;
    }
    setExpanded(bundleId);
    if (!details[bundleId]) {
      try {
        const detail = await datasetsApi.getBundleStatus(bundleId);
        setDetails((prev) => ({ ...prev, [bundleId]: detail }));
      } catch (e) {
        console.warn('Failed to load bundle detail:', e);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Recent uploads"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Recent uploads</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-gray-500">Loading...</p>}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>
          )}
          {!loading && !error && summaries && summaries.length === 0 && (
            <p className="text-sm text-gray-500">
              No bulk uploads in the last 7 days.
            </p>
          )}
          {summaries && summaries.length > 0 && (
            <ul className="space-y-2">
              {summaries.map((s) => (
                <li
                  key={s.bundle_id}
                  className="border border-gray-200 rounded"
                >
                  <button
                    type="button"
                    onClick={() => handleToggle(s.bundle_id)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <span className="text-sm">
                      <span className="text-gray-700">
                        {new Date(s.created_at).toLocaleString()}
                      </span>
                      <span className="ml-3 text-gray-500">
                        <strong className="text-green-700">{s.completed}</strong>
                        {' / '}
                        {s.total}
                        {s.failed > 0 && (
                          <>
                            {' '}·{' '}
                            <strong className="text-red-700">
                              {s.failed} failed
                            </strong>
                          </>
                        )}
                        {s.in_progress > 0 && (
                          <>
                            {' '}·{' '}
                            <span className="text-blue-700">
                              {s.in_progress} in progress
                            </span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="text-xs text-gray-400">
                      {expanded === s.bundle_id ? '▾' : '▸'}
                    </span>
                  </button>
                  {expanded === s.bundle_id && (
                    <div className="border-t border-gray-200 p-3">
                      {details[s.bundle_id] ? (
                        <BundleResultsList bundle={details[s.bundle_id]} />
                      ) : (
                        <p className="text-xs text-gray-500">Loading detail...</p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex justify-end px-4 py-3 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
