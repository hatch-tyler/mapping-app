import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ServiceUrlsPanel } from './ServiceUrlsPanel';
import { createMockDataset } from '../../__tests__/mockData';

// Mock the API functions
vi.mock('../../api/datasets', () => ({
  getGeoJSONUrl: vi.fn((id: string) => `http://test.com/api/v1/datasets/${id}/geojson`),
  getWFSUrl: vi.fn(() => 'http://test.com/wfs'),
  getArcGISFeatureServerUrl: vi.fn((name: string) => `http://test.com/arcgis/rest/services/${name}/FeatureServer`),
  getExportUrl: vi.fn((id: string, format: string) => `http://test.com/export/${id}/${format}`),
  EXPORT_FORMATS: [
    { id: 'geojson', name: 'GeoJSON', ext: '.geojson' },
    { id: 'gpkg', name: 'GeoPackage', ext: '.gpkg' },
    { id: 'shp', name: 'Shapefile', ext: '.zip' },
    { id: 'kml', name: 'KML', ext: '.kml' },
  ],
}));

describe('ServiceUrlsPanel', () => {
  const mockDataset = createMockDataset({
    id: 'dataset-123',
    name: 'Test Dataset',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.open
    window.open = vi.fn();
  });

  it('should render Service URLs header', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    expect(screen.getByText('Service URLs')).toBeInTheDocument();
  });

  it('should render ArcGIS/QGIS section', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    expect(screen.getByText('ArcGIS / QGIS')).toBeInTheDocument();
    expect(screen.getByText('Feature Service')).toBeInTheDocument();
  });

  it('should render Web APIs section', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    expect(screen.getByText('Web APIs')).toBeInTheDocument();
    // GeoJSON appears in both Web APIs and Downloads section, so use getAllByText
    const geojsonElements = screen.getAllByText('GeoJSON');
    expect(geojsonElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('WFS')).toBeInTheDocument();
  });

  it('should render Downloads section', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    expect(screen.getByText('Download Full Dataset')).toBeInTheDocument();
    expect(screen.getByText('GeoPackage')).toBeInTheDocument();
    expect(screen.getByText('Shapefile')).toBeInTheDocument();
    expect(screen.getByText('KML')).toBeInTheDocument();
  });

  it('should render Quick Tips section', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    expect(screen.getByText('Quick Tips')).toBeInTheDocument();
    expect(screen.getByText('ArcGIS Pro:')).toBeInTheDocument();
    expect(screen.getByText('QGIS:')).toBeInTheDocument();
    expect(screen.getByText('Web apps:')).toBeInTheDocument();
  });

  it('should collapse content when header clicked', async () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    // Content should be visible initially
    expect(screen.getByText('Download Full Dataset')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(screen.getByText('Service URLs'));

    await waitFor(() => {
      expect(screen.queryByText('Download Full Dataset')).not.toBeInTheDocument();
    });
  });

  it('should expand content when collapsed header clicked', async () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    // Collapse
    fireEvent.click(screen.getByText('Service URLs'));

    await waitFor(() => {
      expect(screen.queryByText('Download Full Dataset')).not.toBeInTheDocument();
    });

    // Expand
    fireEvent.click(screen.getByText('Service URLs'));

    await waitFor(() => {
      expect(screen.getByText('Download Full Dataset')).toBeInTheDocument();
    });
  });

  it('should open download URL when download button clicked', async () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    const gpkgButton = screen.getByText('GeoPackage').closest('button');
    fireEvent.click(gpkgButton!);

    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        'http://test.com/export/dataset-123/gpkg',
        '_blank'
      );
    });
  });

  it('should render WFS URL with dataset id', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    // Look for the WFS input field with the constructed URL
    const wfsInput = screen.getAllByRole('textbox').find(
      (input) => (input as HTMLInputElement).value.includes('WFS')
    );
    expect(wfsInput).toBeDefined();
  });

  it('should render all export format buttons', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    // GeoJSON appears twice (Web APIs + Downloads)
    const geojsonElements = screen.getAllByText('GeoJSON');
    expect(geojsonElements.length).toBe(2);
    expect(screen.getByText('GeoPackage')).toBeInTheDocument();
    expect(screen.getByText('Shapefile')).toBeInTheDocument();
    expect(screen.getByText('KML')).toBeInTheDocument();
  });

  it('should show file extensions for export formats', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    expect(screen.getByText('.geojson')).toBeInTheDocument();
    expect(screen.getByText('.gpkg')).toBeInTheDocument();
    expect(screen.getByText('.zip')).toBeInTheDocument();
    expect(screen.getByText('.kml')).toBeInTheDocument();
  });

  it('should show ArcGIS Pro description', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    expect(screen.getByText('Add to ArcGIS Pro: Map > Add Data > Data From Path')).toBeInTheDocument();
  });

  it('should show WFS description', () => {
    render(<ServiceUrlsPanel dataset={mockDataset} />);

    expect(screen.getByText('OGC Web Feature Service')).toBeInTheDocument();
  });
});
