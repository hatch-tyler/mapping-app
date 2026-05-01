import { apiClient, API_URL } from './client';
import { BackupFileKind, BackupRecord } from './types';
import { getAccessToken } from './tokenService';

export async function listBackups(): Promise<BackupRecord[]> {
  const response = await apiClient.get<BackupRecord[]>('/admin/backups/');
  return response.data;
}

export async function triggerBackup(): Promise<BackupRecord> {
  const response = await apiClient.post<BackupRecord>('/admin/backups/');
  return response.data;
}

export async function getBackup(timestamp: string): Promise<BackupRecord> {
  const response = await apiClient.get<BackupRecord>(
    `/admin/backups/${timestamp}`
  );
  return response.data;
}

export async function deleteBackup(timestamp: string): Promise<void> {
  await apiClient.delete(`/admin/backups/${timestamp}`);
}

/** Trigger a browser download of one backup file via a hidden anchor.
 *  Streamed by the backend; we don't load it into JS memory. The auth
 *  token is appended via header through a fetch + blob fallback because
 *  a plain anchor can't carry the Authorization header. */
export async function downloadBackupFile(
  timestamp: string,
  kind: BackupFileKind
): Promise<void> {
  const token = getAccessToken();
  const url = `${API_URL}/api/v1/admin/backups/${timestamp}/files/${kind}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const filename = filenameFor(timestamp, kind);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

function filenameFor(timestamp: string, kind: BackupFileKind): string {
  const ext = kind === 'db' ? 'sql.gz' : 'tar.gz';
  return `${kind}_${timestamp}.${ext}`;
}
