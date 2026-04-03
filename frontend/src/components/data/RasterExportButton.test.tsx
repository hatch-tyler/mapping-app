import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RasterExportButton } from './RasterExportButton';

// Mock tokenService
vi.mock('../../api/tokenService', () => ({
  getAccessToken: () => 'test-token',
}));

describe('RasterExportButton', () => {
  it('should render download button', () => {
    render(<RasterExportButton datasetId="123" datasetName="Test Raster" />);
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it('should open dropdown on click', () => {
    render(<RasterExportButton datasetId="123" datasetName="Test Raster" />);
    fireEvent.click(screen.getByText('Download'));
    expect(screen.getByText('GeoTIFF')).toBeInTheDocument();
    expect(screen.getByText('PNG')).toBeInTheDocument();
    expect(screen.getByText('JPEG')).toBeInTheDocument();
  });

  it('should show format descriptions', () => {
    render(<RasterExportButton datasetId="123" datasetName="Test Raster" />);
    fireEvent.click(screen.getByText('Download'));
    expect(screen.getByText('Full quality with CRS')).toBeInTheDocument();
    expect(screen.getByText('Lossless image')).toBeInTheDocument();
    expect(screen.getByText('Compressed image')).toBeInTheDocument();
  });

  it('should close dropdown on outside click', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <RasterExportButton datasetId="123" datasetName="Test Raster" />
      </div>
    );
    fireEvent.click(screen.getByText('Download'));
    expect(screen.getByText('GeoTIFF')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('GeoTIFF')).not.toBeInTheDocument();
  });
});
