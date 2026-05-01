import { useCallback, useEffect, useState } from 'react';
import * as backupsApi from '../../api/backups';
import { BackupFileKind, BackupRecord } from '../../api/types';
import { useToastStore } from '../../stores/toastStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 2000;

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(ts: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!m) return ts;
  const [, y, mo, d, h, mi, s] = m;
  // The timestamp is UTC-encoded in the filename.
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toLocaleString();
}

function StatusChip({ status }: { status: BackupRecord['status'] }) {
  const styles: Record<BackupRecord['status'], string> = {
    completed: 'bg-green-100 text-green-800',
    in_progress: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
    partial: 'bg-yellow-100 text-yellow-800',
  };
  const label: Record<BackupRecord['status'], string> = {
    completed: 'Completed',
    in_progress: 'Running',
    failed: 'Failed',
    partial: 'Partial',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}
    >
      {label[status]}
    </span>
  );
}

/** Admin-only modal for triggering and managing backups. */
export function BackupsModal({ open, onClose }: Props) {
  const [records, setRecords] = useState<BackupRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const refresh = useCallback(async () => {
    try {
      const list = await backupsApi.listBackups();
      setRecords(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load backups.');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, refresh]);

  // Polling: while any backup is in progress, refresh every 2s. Stops
  // automatically once everything is terminal.
  useEffect(() => {
    if (!open || !records) return;
    const anyRunning = records.some((r) => r.status === 'in_progress');
    if (!anyRunning) return;
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [open, records, refresh]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await backupsApi.triggerBackup();
      addToast('Backup started.', 'success');
      await refresh();
    } catch (e: unknown) {
      const isConflict =
        typeof e === 'object' &&
        e !== null &&
        'response' in e &&
        (e as { response?: { status?: number } }).response?.status === 409;
      if (isConflict) {
        addToast('A backup is already running.', 'info');
        await refresh();
      } else {
        addToast(
          e instanceof Error ? e.message : 'Failed to start backup.',
          'error',
        );
      }
    } finally {
      setTriggering(false);
    }
  };

  const handleDownload = async (
    timestamp: string,
    kind: BackupFileKind,
  ) => {
    try {
      await backupsApi.downloadBackupFile(timestamp, kind);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : 'Download failed.',
        'error',
      );
    }
  };

  const handleDelete = async (timestamp: string) => {
    if (
      !window.confirm(
        `Delete backup ${formatTimestamp(timestamp)}? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await backupsApi.deleteBackup(timestamp);
      addToast('Backup deleted.', 'success');
      await refresh();
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : 'Failed to delete backup.',
        'error',
      );
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Backups"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Backups</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Backups include the database, uploaded files, and rasters. The
            scheduled backup runs daily at 02:00 UTC. Retention: 30 days.
          </p>
          <button
            type="button"
            onClick={handleTrigger}
            disabled={triggering}
            className="ml-4 shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {triggering ? 'Starting...' : 'Back up now'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-gray-500">Loading...</p>}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>
          )}
          {!loading && !error && records && records.length === 0 && (
            <p className="text-sm text-gray-500">No backups yet.</p>
          )}
          {records && records.length > 0 && (
            <ul className="space-y-2">
              {records.map((r) => (
                <li
                  key={r.timestamp}
                  className="border border-gray-200 rounded p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">
                          {formatTimestamp(r.timestamp)}
                        </span>
                        <StatusChip status={r.status} />
                        <span className="text-xs text-gray-500">
                          {r.source === 'manual'
                            ? 'Manual'
                            : r.source === 'scheduled'
                              ? 'Scheduled'
                              : 'Unknown source'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {formatBytes(r.total_size_bytes)}
                        {r.triggered_by && (
                          <span> · by {r.triggered_by}</span>
                        )}
                      </div>
                      {r.error_message && (
                        <p className="mt-1 text-xs text-red-600">
                          {r.error_message}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(['db', 'uploads', 'rasters'] as BackupFileKind[]).map(
                        (k) => {
                          const has =
                            k === 'db'
                              ? r.has_db
                              : k === 'uploads'
                                ? r.has_uploads
                                : r.has_rasters;
                          const label =
                            k === 'db'
                              ? 'DB'
                              : k === 'uploads'
                                ? 'Uploads'
                                : 'Rasters';
                          return (
                            <button
                              key={k}
                              type="button"
                              onClick={() => handleDownload(r.timestamp, k)}
                              disabled={!has || r.status === 'in_progress'}
                              className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={
                                has
                                  ? `Download ${label}`
                                  : `No ${label} file`
                              }
                            >
                              {label}
                            </button>
                          );
                        },
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(r.timestamp)}
                        disabled={r.status === 'in_progress'}
                        className="ml-2 text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
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
