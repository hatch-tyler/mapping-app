import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableToolbar } from './TableToolbar';

// Mock the child components
vi.mock('./ColumnVisibilityDropdown', () => ({
  ColumnVisibilityDropdown: () => <div data-testid="column-visibility">Column Visibility</div>,
}));

vi.mock('./ExportDropdown', () => ({
  ExportDropdown: ({ datasetId, selectedIds }: { datasetId: string; selectedIds: number[] }) => (
    <div data-testid="export-dropdown" data-dataset-id={datasetId} data-selected={selectedIds.join(',')}>
      Export Dropdown
    </div>
  ),
}));

// Create mock selected rows
const createMockSelectedRow = (id: number) => ({
  original: { id },
});

// Create a mock table
const createMockTable = (selectedRows: ReturnType<typeof createMockSelectedRow>[] = []) => ({
  getSelectedRowModel: () => ({
    rows: selectedRows,
  }),
  getAllLeafColumns: () => [],
});

describe('TableToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display total feature count', () => {
    const mockTable = createMockTable([]);
    render(<TableToolbar table={mockTable as any} datasetId="123" totalCount={1000} />);

    expect(screen.getByText('1,000 total features')).toBeInTheDocument();
  });

  it('should display singular "feature" when count is 1', () => {
    const mockTable = createMockTable([]);
    render(<TableToolbar table={mockTable as any} datasetId="123" totalCount={1} />);

    expect(screen.getByText('1 total feature')).toBeInTheDocument();
  });

  it('should display selected count when rows are selected', () => {
    const selectedRows = [
      createMockSelectedRow(1),
      createMockSelectedRow(2),
      createMockSelectedRow(3),
    ];
    const mockTable = createMockTable(selectedRows);
    render(<TableToolbar table={mockTable as any} datasetId="123" totalCount={1000} />);

    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('should not display selected count when no rows selected', () => {
    const mockTable = createMockTable([]);
    render(<TableToolbar table={mockTable as any} datasetId="123" totalCount={1000} />);

    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it('should render ColumnVisibilityDropdown', () => {
    const mockTable = createMockTable([]);
    render(<TableToolbar table={mockTable as any} datasetId="123" totalCount={1000} />);

    expect(screen.getByTestId('column-visibility')).toBeInTheDocument();
  });

  it('should render ExportDropdown with correct props', () => {
    const selectedRows = [createMockSelectedRow(1), createMockSelectedRow(2)];
    const mockTable = createMockTable(selectedRows);
    render(<TableToolbar table={mockTable as any} datasetId="dataset-456" totalCount={1000} />);

    const exportDropdown = screen.getByTestId('export-dropdown');
    expect(exportDropdown).toBeInTheDocument();
    expect(exportDropdown).toHaveAttribute('data-dataset-id', 'dataset-456');
    expect(exportDropdown).toHaveAttribute('data-selected', '1,2');
  });

  it('should pass empty selectedIds when no rows selected', () => {
    const mockTable = createMockTable([]);
    render(<TableToolbar table={mockTable as any} datasetId="123" totalCount={1000} />);

    const exportDropdown = screen.getByTestId('export-dropdown');
    expect(exportDropdown).toHaveAttribute('data-selected', '');
  });

  it('should format large numbers with commas', () => {
    const mockTable = createMockTable([]);
    render(<TableToolbar table={mockTable as any} datasetId="123" totalCount={1234567} />);

    expect(screen.getByText('1,234,567 total features')).toBeInTheDocument();
  });
});
