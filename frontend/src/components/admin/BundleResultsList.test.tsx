import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BundleResultsList } from './BundleResultsList';
import { BundleStatusResponse, BundleJobDetail } from '../../api/types';

function makeJob(overrides: Partial<BundleJobDetail> = {}): BundleJobDetail {
  return {
    id: 'job-1',
    dataset_id: 'ds-1',
    dataset_name: 'My Dataset',
    status: 'completed',
    progress: 100,
    error_message: null,
    error_code: null,
    created_at: '2026-04-30T00:00:00Z',
    completed_at: '2026-04-30T00:01:00Z',
    ...overrides,
  };
}

function makeBundle(jobs: BundleJobDetail[]): BundleStatusResponse {
  return { bundle_id: 'bundle-1', jobs };
}

describe('BundleResultsList', () => {
  it('renders only the success collapse when nothing failed', () => {
    const bundle = makeBundle([
      makeJob({ id: 'a', dataset_name: 'A', status: 'completed' }),
      makeJob({ id: 'b', dataset_name: 'B', status: 'completed' }),
    ]);
    render(<BundleResultsList bundle={bundle} />);
    expect(
      screen.getByRole('button', { name: /2 succeeded/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed dataset/)).not.toBeInTheDocument();
  });

  it('lists failed datasets with name and error code', () => {
    const bundle = makeBundle([
      makeJob({ id: 'a', dataset_name: 'Good', status: 'completed' }),
      makeJob({
        id: 'b',
        dataset_name: 'Bad',
        status: 'failed',
        error_code: 'missing_crs',
        error_message: 'No CRS found',
      }),
    ]);
    render(<BundleResultsList bundle={bundle} />);
    expect(screen.getByText('1 failed dataset')).toBeInTheDocument();
    expect(screen.getByText('Bad')).toBeInTheDocument();
    expect(screen.getByText('missing_crs')).toBeInTheDocument();
    expect(screen.getByText('No CRS found')).toBeInTheDocument();
  });

  it('expands successes when toggle clicked', () => {
    const bundle = makeBundle([
      makeJob({ id: 'a', dataset_name: 'A', status: 'completed' }),
    ]);
    render(<BundleResultsList bundle={bundle} />);
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /1 succeeded/ }));
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('copies failed filenames to clipboard newline-separated', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const bundle = makeBundle([
      makeJob({ id: 'b', dataset_name: 'Failed_One', status: 'failed' }),
      makeJob({ id: 'c', dataset_name: 'Failed_Two', status: 'failed' }),
    ]);
    render(<BundleResultsList bundle={bundle} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy failed filenames/ }));

    expect(writeText).toHaveBeenCalledWith('Failed_One\nFailed_Two');
  });

  it('renders the title header with counts when title given', () => {
    const bundle = makeBundle([
      makeJob({ id: 'a', dataset_name: 'A', status: 'completed' }),
      makeJob({ id: 'b', dataset_name: 'B', status: 'failed' }),
    ]);
    render(<BundleResultsList bundle={bundle} title="My upload" />);
    expect(screen.getByText(/My upload/)).toBeInTheDocument();
    // Both counts should be visible (the title row uses fragments).
    expect(screen.getByText('1', { selector: 'strong.text-green-700' })).toBeInTheDocument();
    expect(screen.getByText('1', { selector: 'strong.text-red-700' })).toBeInTheDocument();
  });

  it('shows in-progress jobs distinctly', () => {
    const bundle = makeBundle([
      makeJob({ id: 'a', dataset_name: 'WIP', status: 'processing' }),
      makeJob({ id: 'b', dataset_name: 'Done', status: 'completed' }),
    ]);
    render(<BundleResultsList bundle={bundle} title="x" />);
    expect(screen.getByText('WIP')).toBeInTheDocument();
    expect(screen.getByText(/processing/)).toBeInTheDocument();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
});
