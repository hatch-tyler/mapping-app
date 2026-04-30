import { useState } from 'react';
import { BundleStatusResponse, BundleJobDetail } from '../../api/types';

/** Codes that represent operational (retryable) failures rather than data
 *  issues. The UI hints at retry rather than asking the user to fix data. */
const OPERATIONAL_FAILURE_CODES: ReadonlySet<string> = new Set([
  'server_restart',
  'processing_failed',
]);

function chipClass(code: string | null | undefined): string {
  if (!code) return 'bg-red-100 text-red-700';
  if (OPERATIONAL_FAILURE_CODES.has(code)) {
    return 'bg-amber-100 text-amber-800';
  }
  return 'bg-red-100 text-red-700';
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Last-resort fallback for older browsers / non-secure contexts.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
  return Promise.resolve();
}

interface Props {
  bundle: BundleStatusResponse;
  /** Header label, e.g. "Upload complete" or "Bundle from 2026-04-29 21:17". */
  title?: string;
}

/** Renders a per-dataset success/failure breakdown for a bundle.
 *
 *  Failures are listed by default (the part the user actually needs);
 *  successes are collapsed behind a count. A "Copy failed filenames"
 *  button writes the names as a newline-separated list to the clipboard
 *  so the user can paste them straight back into the upload bundle picker. */
export function BundleResultsList({ bundle, title }: Props) {
  const failed = bundle.jobs.filter((j) => j.status === 'failed');
  const completed = bundle.jobs.filter((j) => j.status === 'completed');
  const inProgress = bundle.jobs.filter(
    (j) => j.status !== 'completed' && j.status !== 'failed',
  );
  const [showSuccesses, setShowSuccesses] = useState(false);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);

  const handleCopy = async () => {
    await copyText(failed.map((j) => j.dataset_name).join('\n'));
    setCopiedAt(Date.now());
    setTimeout(() => setCopiedAt(null), 2000);
  };

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      {title && (
        <div className="bg-gray-50 px-3 py-2 text-sm text-gray-700 border-b border-gray-200">
          {title} —{' '}
          <strong className="text-green-700">{completed.length}</strong>{' '}
          succeeded
          {failed.length > 0 && (
            <>
              ,{' '}
              <strong className="text-red-700">{failed.length}</strong> failed
            </>
          )}
          {inProgress.length > 0 && (
            <>
              ,{' '}
              <strong className="text-blue-700">{inProgress.length}</strong>{' '}
              in progress
            </>
          )}
        </div>
      )}

      {failed.length > 0 && (
        <div className="border-b border-gray-200">
          <div className="flex items-center justify-between px-3 py-2 bg-red-50">
            <span className="text-sm font-medium text-red-800">
              {failed.length} failed dataset{failed.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs px-2 py-1 rounded bg-white border border-red-200 text-red-700 hover:bg-red-100"
            >
              {copiedAt ? 'Copied!' : 'Copy failed filenames'}
            </button>
          </div>
          <ul className="divide-y divide-gray-200">
            {failed.map((j) => (
              <FailureRow key={j.id} job={j} />
            ))}
          </ul>
        </div>
      )}

      {inProgress.length > 0 && (
        <ul className="divide-y divide-gray-200">
          {inProgress.map((j) => (
            <li key={j.id} className="px-3 py-2 text-sm text-gray-700">
              <span className="text-blue-700">⏳</span> {j.dataset_name}{' '}
              <span className="text-xs text-gray-500">({j.status})</span>
            </li>
          ))}
        </ul>
      )}

      {completed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowSuccesses((s) => !s)}
            className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-between"
          >
            <span>
              {showSuccesses ? '▾' : '▸'} {completed.length} succeeded
            </span>
            <span className="text-xs text-gray-400">
              {showSuccesses ? 'hide' : 'show'}
            </span>
          </button>
          {showSuccesses && (
            <ul className="divide-y divide-gray-200">
              {completed.map((j) => (
                <li key={j.id} className="px-3 py-1.5 text-sm text-gray-700">
                  <span className="text-green-700">✓</span> {j.dataset_name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FailureRow({ job }: { job: BundleJobDetail }) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="text-red-600 mt-0.5">✗</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm text-gray-900 truncate">
              {job.dataset_name}
            </code>
            {job.error_code && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${chipClass(
                  job.error_code,
                )}`}
                title={
                  OPERATIONAL_FAILURE_CODES.has(job.error_code)
                    ? 'Operational failure — re-uploading will likely succeed.'
                    : undefined
                }
              >
                {job.error_code}
              </span>
            )}
          </div>
          {job.error_message && (
            <p className="text-xs text-gray-600 mt-0.5">{job.error_message}</p>
          )}
        </div>
      </div>
    </li>
  );
}
