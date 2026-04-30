import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecentUploadsModal } from './RecentUploadsModal';
import * as datasetsApi from '../../api/datasets';
import { BundleSummary, BundleStatusResponse } from '../../api/types';

vi.mock('../../api/datasets', () => ({
  listRecentBundles: vi.fn(),
  getBundleStatus: vi.fn(),
}));

const summary = (overrides: Partial<BundleSummary> = {}): BundleSummary => ({
  bundle_id: 'bundle-1',
  created_at: '2026-04-29T21:17:00Z',
  total: 29,
  completed: 25,
  failed: 4,
  in_progress: 0,
  ...overrides,
});

const detail = (failedNames: string[]): BundleStatusResponse => ({
  bundle_id: 'bundle-1',
  jobs: failedNames.map((n, i) => ({
    id: `j-${i}`,
    dataset_id: `d-${i}`,
    dataset_name: n,
    status: 'failed',
    progress: 0,
    error_message: 'oops',
    error_code: 'server_restart',
    created_at: '2026-04-29T21:17:00Z',
    completed_at: '2026-04-29T21:27:00Z',
  })),
});

describe('RecentUploadsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not open', () => {
    render(<RecentUploadsModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('loads recent bundles on open and shows their counts', async () => {
    vi.mocked(datasetsApi.listRecentBundles).mockResolvedValue([
      summary({ bundle_id: 'a', failed: 4 }),
      summary({ bundle_id: 'b', failed: 0, completed: 3, total: 3 }),
    ]);

    render(<RecentUploadsModal open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(datasetsApi.listRecentBundles).toHaveBeenCalledWith(10080);
    });
    await waitFor(() => {
      expect(screen.getByText(/4 failed/)).toBeInTheDocument();
    });
    expect(screen.getByText('25', { selector: 'strong.text-green-700' })).toBeInTheDocument();
  });

  it('lazy-loads bundle detail on row click', async () => {
    vi.mocked(datasetsApi.listRecentBundles).mockResolvedValue([
      summary({ bundle_id: 'a', failed: 4 }),
    ]);
    vi.mocked(datasetsApi.getBundleStatus).mockResolvedValue(
      detail(['EAWMD__Wells', 'EAWMD__T20_ft_Contours___3DEP_DEM']),
    );

    render(<RecentUploadsModal open={true} onClose={() => {}} />);

    const row = await screen.findByRole('button', { name: /4 failed/ });
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByText('EAWMD__Wells')).toBeInTheDocument();
      expect(screen.getByText('EAWMD__T20_ft_Contours___3DEP_DEM')).toBeInTheDocument();
    });
    expect(datasetsApi.getBundleStatus).toHaveBeenCalledTimes(1);
    expect(datasetsApi.getBundleStatus).toHaveBeenCalledWith('a');
  });

  it('does not refetch detail when collapsing and re-expanding', async () => {
    vi.mocked(datasetsApi.listRecentBundles).mockResolvedValue([
      summary({ bundle_id: 'a' }),
    ]);
    vi.mocked(datasetsApi.getBundleStatus).mockResolvedValue(detail(['X']));

    render(<RecentUploadsModal open={true} onClose={() => {}} />);
    const row = await screen.findByRole('button', { name: /failed/ });
    fireEvent.click(row); // expand
    await screen.findByText('X');
    fireEvent.click(row); // collapse
    fireEvent.click(row); // re-expand
    await screen.findByText('X');

    expect(datasetsApi.getBundleStatus).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no bundles in window', async () => {
    vi.mocked(datasetsApi.listRecentBundles).mockResolvedValue([]);
    render(<RecentUploadsModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/No bulk uploads in the last 7 days/)).toBeInTheDocument();
    });
  });

  it('calls onClose when close button clicked', async () => {
    vi.mocked(datasetsApi.listRecentBundles).mockResolvedValue([]);
    const onClose = vi.fn();
    render(<RecentUploadsModal open={true} onClose={onClose} />);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
