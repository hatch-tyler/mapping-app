import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BundleDatasetList, BundleDatasetRow, rowsFromDetected } from './BundleDatasetList';
import { DetectedDataset } from '../../utils/zipInspector';

function makeRow(overrides: Partial<BundleDatasetRow> = {}): BundleDatasetRow {
  return {
    primaryFile: 'a.shp',
    dataType: 'vector',
    format: 'shapefile',
    include: true,
    name: 'A',
    description: '',
    warnings: [],
    ...overrides,
  };
}

describe('rowsFromDetected', () => {
  it('defaults include=true when no blocking warnings', () => {
    const detected: DetectedDataset[] = [
      {
        suggestedName: 'a',
        dataType: 'vector',
        format: 'shapefile',
        primaryFile: 'a.shp',
        memberFiles: ['a.shp', 'a.shx', 'a.dbf'],
        warnings: [],
      },
    ];
    const rows = rowsFromDetected(detected);
    expect(rows[0].include).toBe(true);
    expect(rows[0].name).toBe('a');
  });

  it('defaults include=false when required-files warning is present', () => {
    const detected: DetectedDataset[] = [
      {
        suggestedName: 'a',
        dataType: 'vector',
        format: 'shapefile',
        primaryFile: 'a.shp',
        memberFiles: ['a.shp'],
        warnings: ['Shapefile is missing required files: .shx, .dbf'],
      },
    ];
    const rows = rowsFromDetected(detected);
    expect(rows[0].include).toBe(false);
  });
});

describe('BundleDatasetList', () => {
  it('renders rows with primary filename and type badge', () => {
    const rows = [
      makeRow({ primaryFile: 'counties.shp', dataType: 'vector', format: 'shapefile' }),
      makeRow({ primaryFile: 'elev.tif', dataType: 'raster', format: 'geotiff', name: 'Elevation' }),
    ];
    render(<BundleDatasetList rows={rows} onChange={() => {}} />);
    expect(screen.getByText('counties.shp')).toBeInTheDocument();
    expect(screen.getByText('elev.tif')).toBeInTheDocument();
    expect(screen.getByText('vector · shapefile')).toBeInTheDocument();
    expect(screen.getByText('raster · geotiff')).toBeInTheDocument();
  });

  it('shows selected count in header', () => {
    const rows = [
      makeRow({ primaryFile: 'a.shp', include: true }),
      makeRow({ primaryFile: 'b.shp', include: false }),
    ];
    render(<BundleDatasetList rows={rows} onChange={() => {}} />);
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  });

  it('calls onChange when include checkbox toggles', () => {
    const onChange = vi.fn();
    const rows = [makeRow({ primaryFile: 'a.shp', include: true })];
    render(<BundleDatasetList rows={rows} onChange={onChange} />);
    const checkbox = screen.getByLabelText('Include a.shp') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ primaryFile: 'a.shp', include: false }),
    ]);
  });

  it('calls onChange when name changes', () => {
    const onChange = vi.fn();
    const rows = [makeRow({ primaryFile: 'a.shp', name: 'Old' })];
    render(<BundleDatasetList rows={rows} onChange={onChange} />);
    const inputs = screen.getAllByDisplayValue('Old');
    fireEvent.change(inputs[0], { target: { value: 'New' } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ primaryFile: 'a.shp', name: 'New' }),
    ]);
  });

  it('disables checkbox when blocking warning is present', () => {
    const rows = [
      makeRow({
        primaryFile: 'a.shp',
        warnings: ['Shapefile is missing required files: .shx'],
        include: false,
      }),
    ];
    render(<BundleDatasetList rows={rows} onChange={() => {}} />);
    const checkbox = screen.getByLabelText('Include a.shp') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('renders warnings with appropriate color', () => {
    const rows = [
      makeRow({
        primaryFile: 'a.shp',
        warnings: [
          'Missing .prj — projection will be assumed WGS84 (EPSG:4326)',
        ],
      }),
    ];
    render(<BundleDatasetList rows={rows} onChange={() => {}} />);
    expect(screen.getByText(/Missing \.prj/)).toBeInTheDocument();
  });
});
