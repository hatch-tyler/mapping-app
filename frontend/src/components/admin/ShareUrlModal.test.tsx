import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ShareUrlModal } from './ShareUrlModal';
import { createMockDataset } from '../../__tests__/mockData';

// Mock the datasets API
vi.mock('../../api/datasets', () => ({
  getGeoJSONUrl: vi.fn((id: string) => `http://test.com/api/v1/datasets/${id}/geojson`),
  getArcGISFeatureServerUrl: vi.fn((name: string) => `http://test.com/arcgis/rest/services/${name}/FeatureServer`),
  getExportUrl: vi.fn((id: string, format: string) => `http://test.com/export/${id}/${format}`),
  EXPORT_FORMATS: [
    { id: 'geojson', name: 'GeoJSON', description: 'Standard format', ext: '.geojson' },
    { id: 'gpkg', name: 'GeoPackage', description: 'SQLite format', ext: '.gpkg' },
    { id: 'shp', name: 'Shapefile', description: 'Legacy format', ext: '.zip' },
    { id: 'kml', name: 'KML', description: 'Google Earth', ext: '.kml' },
  ],
}));

describe('ShareUrlModal', () => {
  const mockDataset = createMockDataset({
    id: 'dataset-123',
    name: 'Test Dataset',
  });
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    window.open = vi.fn();
  });

  it('should render modal with dataset name in title', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    expect(screen.getByText('Share "Test Dataset"')).toBeInTheDocument();
  });

  it('should render Download Data section', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    expect(screen.getByText('Download Data')).toBeInTheDocument();
  });

  it('should render all export format buttons', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    expect(screen.getByText('GeoJSON')).toBeInTheDocument();
    expect(screen.getByText('GeoPackage')).toBeInTheDocument();
    expect(screen.getByText('Shapefile')).toBeInTheDocument();
    expect(screen.getByText('KML')).toBeInTheDocument();
  });

  it('should render ArcGIS Pro / QGIS section', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    expect(screen.getByText('ArcGIS Pro / QGIS')).toBeInTheDocument();
    expect(screen.getByText('Feature Service URL')).toBeInTheDocument();
  });

  it('should render Web API Access section', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    expect(screen.getByText('Web API Access')).toBeInTheDocument();
    expect(screen.getByText('GeoJSON Endpoint')).toBeInTheDocument();
  });

  it('should render code examples section', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    expect(screen.getByText('View code examples')).toBeInTheDocument();
  });

  it('should render usage tips section', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    expect(screen.getByText('Recommended Workflows')).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    const closeButtons = screen.getAllByRole('button').filter(
      btn => btn.textContent === 'Close' || btn.querySelector('svg')
    );
    fireEvent.click(closeButtons[0]);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should call onClose when footer Close button is clicked', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    const closeButton = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should copy ArcGIS URL when copy button is clicked', async () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    const copyButtons = screen.getAllByText('Copy');
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
  });

  it('should show "Copied!" after copying', async () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    const copyButtons = screen.getAllByText('Copy');
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('should open download URL when download button is clicked', async () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    const gpkgButton = screen.getByText('GeoPackage').closest('button');
    fireEvent.click(gpkgButton!);

    await waitFor(() => {
      expect(window.open).toHaveBeenCalled();
    });
  });

  it('should render ArcGIS URL input field', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    const inputs = screen.getAllByRole('textbox');
    expect(inputs[0]).toHaveAttribute('readonly');
    const arcgisValue = (inputs[0] as HTMLInputElement).value;
    expect(arcgisValue).toContain('FeatureServer');
  });

  it('should render GeoJSON URL input field', () => {
    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    const inputs = screen.getAllByRole('textbox');
    expect(inputs[1]).toHaveAttribute('readonly');
    const geojsonValue = (inputs[1] as HTMLInputElement).value;
    expect(geojsonValue).toContain('geojson');
  });

  it('should handle clipboard error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Clipboard error')),
      },
    });

    render(<ShareUrlModal dataset={mockDataset} onClose={mockOnClose} />);

    const copyButtons = screen.getAllByText('Copy');
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });
});
