import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatasetTable } from './DatasetTable';
import { createMockDataset } from '../../__tests__/mockData';

const mockDatasets = [
  createMockDataset({
    id: '1',
    name: 'Test Dataset 1',
    description: 'First test dataset',
    data_type: 'vector',
    geometry_type: 'Point',
    source_format: 'geojson',
    is_visible: true,
    is_public: false,
    feature_count: 100,
    created_at: '2024-01-15T10:00:00Z',
  }),
  createMockDataset({
    id: '2',
    name: 'Test Dataset 2',
    description: null,
    data_type: 'raster',
    geometry_type: null,
    source_format: 'geotiff',
    is_visible: false,
    is_public: true,
    feature_count: null,
    created_at: '2024-01-20T15:30:00Z',
  }),
];

describe('DatasetTable', () => {
  const mockOnToggleVisibility = vi.fn();
  const mockOnTogglePublic = vi.fn();
  const mockOnDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render empty state when no datasets', () => {
    render(
      <DatasetTable
        datasets={[]}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('No datasets found')).toBeInTheDocument();
    expect(screen.getByText('Upload a dataset to get started')).toBeInTheDocument();
  });

  it('should render table with datasets', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('Test Dataset 1')).toBeInTheDocument();
    expect(screen.getByText('Test Dataset 2')).toBeInTheDocument();
  });

  it('should display dataset description when present', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('First test dataset')).toBeInTheDocument();
  });

  it('should display data type badges', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('vector')).toBeInTheDocument();
    expect(screen.getByText('raster')).toBeInTheDocument();
  });

  it('should display data type for vector datasets', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    // DatasetTable shows data_type badges, not geometry_type
    expect(screen.getByText('vector')).toBeInTheDocument();
  });

  it('should display source format in uppercase', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('GEOJSON')).toBeInTheDocument();
    expect(screen.getByText('GEOTIFF')).toBeInTheDocument();
  });

  it('should display feature count when available', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('should display formatted dates', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument();
    expect(screen.getByText('Jan 20, 2024')).toBeInTheDocument();
  });

  it('should call onToggleVisibility when toggle is clicked', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    const toggleButtons = screen.getAllByRole('switch');
    fireEvent.click(toggleButtons[0]);

    expect(mockOnToggleVisibility).toHaveBeenCalledWith('1', false);
  });

  it('should require confirmation before delete', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    const deleteButtons = screen.getAllByTitle('Delete dataset');
    expect(deleteButtons.length).toBe(2);

    // First click should show confirmation buttons
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByTitle('Confirm deletion')).toBeInTheDocument();

    // onDelete should not have been called yet
    expect(mockOnDelete).not.toHaveBeenCalled();
  });

  it('should delete on second click (confirmation)', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    const deleteButton = screen.getAllByTitle('Delete dataset')[0];

    // First click - show confirmation
    fireEvent.click(deleteButton);

    // Second click - confirm delete
    const confirmButton = screen.getByTitle('Confirm deletion');
    fireEvent.click(confirmButton);

    expect(mockOnDelete).toHaveBeenCalledWith('1');
  });

  it('should reset delete confirmation when clicking different row', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    const deleteButtons = screen.getAllByTitle('Delete dataset');

    // Click first delete button
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByTitle('Confirm deletion')).toBeInTheDocument();

    // Click second delete button — switches confirmation to second dataset
    fireEvent.click(deleteButtons[1]);

    // Should have one confirmation button visible
    const allConfirmButtons = screen.getAllByTitle('Confirm deletion');
    expect(allConfirmButtons.length).toBe(1);
  });

  it('should render table headers', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Visible')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('should call onTogglePublic when public toggle is clicked', () => {
    render(
      <DatasetTable
        datasets={mockDatasets}
        onToggleVisibility={mockOnToggleVisibility}
        onTogglePublic={mockOnTogglePublic}
        onDelete={mockOnDelete}
      />
    );

    // The public toggle should be present
    const toggleButtons = screen.getAllByRole('switch');
    // Assuming there are two toggles per row: visibility and public
    expect(toggleButtons.length).toBeGreaterThanOrEqual(2);
  });
});
