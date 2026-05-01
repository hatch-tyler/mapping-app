import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BackupsModal } from './BackupsModal';
import * as backupsApi from '../../api/backups';
import { BackupRecord } from '../../api/types';

vi.mock('../../api/backups', () => ({
  listBackups: vi.fn(),
  triggerBackup: vi.fn(),
  deleteBackup: vi.fn(),
  downloadBackupFile: vi.fn(),
}));

const addToast = vi.fn();
vi.mock('../../stores/toastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: { addToast: typeof addToast }) => unknown) =>
      selector({ addToast }),
    { getState: () => ({ addToast }) },
  ),
}));

const record = (over: Partial<BackupRecord> = {}): BackupRecord => ({
  timestamp: '20260301_010101',
  status: 'completed',
  source: 'manual',
  created_at: '2026-03-01T01:01:01+00:00',
  total_size_bytes: 12345,
  has_db: true,
  has_uploads: true,
  has_rasters: false,
  error_message: null,
  triggered_by: 'admin@example.com',
  ...over,
});

describe('BackupsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addToast.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when closed', () => {
    render(<BackupsModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows empty state when no backups', async () => {
    vi.mocked(backupsApi.listBackups).mockResolvedValue([]);
    render(<BackupsModal open={true} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('No backups yet.')).toBeInTheDocument(),
    );
  });

  it('lists backup records with status, size, source, and triggered_by', async () => {
    vi.mocked(backupsApi.listBackups).mockResolvedValue([record()]);
    render(<BackupsModal open={true} onClose={() => {}} />);
    await screen.findByText('Completed');
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();
  });

  it('triggers a backup and refreshes the list', async () => {
    vi.mocked(backupsApi.listBackups)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([record({ status: 'in_progress' })]);
    vi.mocked(backupsApi.triggerBackup).mockResolvedValue(
      record({ status: 'in_progress' }),
    );

    render(<BackupsModal open={true} onClose={() => {}} />);
    await screen.findByText('No backups yet.');

    fireEvent.click(screen.getByRole('button', { name: /Back up now/i }));

    await waitFor(() => {
      expect(backupsApi.triggerBackup).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument();
    });
    expect(addToast).toHaveBeenCalledWith('Backup started.', 'success');
  });

  it('toasts a friendly message on 409 conflict', async () => {
    vi.mocked(backupsApi.listBackups).mockResolvedValue([]);
    vi.mocked(backupsApi.triggerBackup).mockRejectedValue({
      response: { status: 409 },
    });

    render(<BackupsModal open={true} onClose={() => {}} />);
    await screen.findByText('No backups yet.');

    fireEvent.click(screen.getByRole('button', { name: /Back up now/i }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        'A backup is already running.',
        'info',
      ),
    );
  });

  it('downloads a file when a download button is clicked', async () => {
    vi.mocked(backupsApi.listBackups).mockResolvedValue([record()]);
    vi.mocked(backupsApi.downloadBackupFile).mockResolvedValue();

    render(<BackupsModal open={true} onClose={() => {}} />);
    await screen.findByText('Completed');

    fireEvent.click(screen.getByRole('button', { name: 'DB' }));

    await waitFor(() => {
      expect(backupsApi.downloadBackupFile).toHaveBeenCalledWith(
        '20260301_010101',
        'db',
      );
    });
  });

  it('disables download for missing files', async () => {
    vi.mocked(backupsApi.listBackups).mockResolvedValue([
      record({ has_rasters: false }),
    ]);
    render(<BackupsModal open={true} onClose={() => {}} />);
    await screen.findByText('Completed');

    const rastersBtn = screen.getByRole('button', { name: 'Rasters' });
    expect(rastersBtn).toBeDisabled();
  });

  it('confirms before deleting and refreshes', async () => {
    vi.mocked(backupsApi.listBackups)
      .mockResolvedValueOnce([record()])
      .mockResolvedValueOnce([]);
    vi.mocked(backupsApi.deleteBackup).mockResolvedValue();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<BackupsModal open={true} onClose={() => {}} />);
    await screen.findByText('Completed');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(backupsApi.deleteBackup).toHaveBeenCalledWith('20260301_010101');
    });
    await waitFor(() =>
      expect(screen.getByText('No backups yet.')).toBeInTheDocument(),
    );
  });

  it('does not delete when user cancels the confirm', async () => {
    vi.mocked(backupsApi.listBackups).mockResolvedValue([record()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<BackupsModal open={true} onClose={() => {}} />);
    await screen.findByText('Completed');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(backupsApi.deleteBackup).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', async () => {
    vi.mocked(backupsApi.listBackups).mockResolvedValue([]);
    const onClose = vi.fn();
    render(<BackupsModal open={true} onClose={onClose} />);
    await screen.findByText('No backups yet.');
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
