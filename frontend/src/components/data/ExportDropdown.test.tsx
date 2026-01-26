import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportDropdown } from './ExportDropdown';
import * as datasetsApi from '../../api/datasets';

// Mock the datasets API
vi.mock('../../api/datasets', () => ({
  exportSelectedFeatures: vi.fn(),
}));

describe('ExportDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render Export Selected button', () => {
    render(<ExportDropdown datasetId="123" selectedIds={[1, 2, 3]} />);

    expect(screen.getByText('Export Selected')).toBeInTheDocument();
  });

  it('should be disabled when no rows selected', () => {
    render(<ExportDropdown datasetId="123" selectedIds={[]} />);

    const button = screen.getByText('Export Selected').closest('button');
    expect(button).toBeDisabled();
    expect(button).toHaveClass('cursor-not-allowed');
  });

  it('should be enabled when rows are selected', () => {
    render(<ExportDropdown datasetId="123" selectedIds={[1, 2]} />);

    const button = screen.getByText('Export Selected').closest('button');
    expect(button).not.toBeDisabled();
  });

  it('should open dropdown when clicked', () => {
    render(<ExportDropdown datasetId="123" selectedIds={[1, 2]} />);

    const button = screen.getByText('Export Selected').closest('button');
    fireEvent.click(button!);

    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByText('GeoJSON')).toBeInTheDocument();
  });

  it('should not open dropdown when disabled', () => {
    render(<ExportDropdown datasetId="123" selectedIds={[]} />);

    const button = screen.getByText('Export Selected').closest('button');
    fireEvent.click(button!);

    expect(screen.queryByText('Spreadsheet format')).not.toBeInTheDocument();
  });

  it('should show CSV option with description', () => {
    render(<ExportDropdown datasetId="123" selectedIds={[1, 2]} />);

    const button = screen.getByText('Export Selected').closest('button');
    fireEvent.click(button!);

    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByText('Spreadsheet format')).toBeInTheDocument();
  });

  it('should show GeoJSON option with description', () => {
    render(<ExportDropdown datasetId="123" selectedIds={[1, 2]} />);

    const button = screen.getByText('Export Selected').closest('button');
    fireEvent.click(button!);

    expect(screen.getByText('GeoJSON')).toBeInTheDocument();
    expect(screen.getByText('With geometry')).toBeInTheDocument();
  });

  it('should call exportSelectedFeatures when CSV clicked', async () => {
    const mockBlob = new Blob(['test'], { type: 'text/csv' });
    vi.mocked(datasetsApi.exportSelectedFeatures).mockResolvedValue(mockBlob);

    // Mock URL and DOM methods
    const mockUrl = 'blob:test-url';
    const mockRevokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => mockUrl);
    URL.revokeObjectURL = mockRevokeObjectURL;

    render(<ExportDropdown datasetId="123" selectedIds={[1, 2]} />);

    const button = screen.getByText('Export Selected').closest('button');
    fireEvent.click(button!);

    const csvButton = screen.getByText('CSV').closest('button');
    fireEvent.click(csvButton!);

    await waitFor(() => {
      expect(datasetsApi.exportSelectedFeatures).toHaveBeenCalledWith('123', [1, 2], 'csv');
    });

    // Restore
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('should call exportSelectedFeatures when GeoJSON clicked', async () => {
    const mockBlob = new Blob(['{}'], { type: 'application/json' });
    vi.mocked(datasetsApi.exportSelectedFeatures).mockResolvedValue(mockBlob);

    const mockUrl = 'blob:test-url';
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => mockUrl);
    URL.revokeObjectURL = vi.fn();

    render(<ExportDropdown datasetId="123" selectedIds={[1, 2, 3]} />);

    const button = screen.getByText('Export Selected').closest('button');
    fireEvent.click(button!);

    const geojsonButton = screen.getByText('GeoJSON').closest('button');
    fireEvent.click(geojsonButton!);

    await waitFor(() => {
      expect(datasetsApi.exportSelectedFeatures).toHaveBeenCalledWith('123', [1, 2, 3], 'geojson');
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('should close dropdown when clicking outside', async () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <ExportDropdown datasetId="123" selectedIds={[1, 2]} />
      </div>
    );

    const button = screen.getByText('Export Selected').closest('button');
    fireEvent.click(button!);

    expect(screen.getByText('CSV')).toBeInTheDocument();

    const outside = screen.getByTestId('outside');
    fireEvent.mouseDown(outside);

    await waitFor(() => {
      expect(screen.queryByText('Spreadsheet format')).not.toBeInTheDocument();
    });
  });

  it('should handle export error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(datasetsApi.exportSelectedFeatures).mockRejectedValue(new Error('Export failed'));

    render(<ExportDropdown datasetId="123" selectedIds={[1, 2]} />);

    const button = screen.getByText('Export Selected').closest('button');
    fireEvent.click(button!);

    const csvButton = screen.getByText('CSV').closest('button');
    fireEvent.click(csvButton!);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });
});
