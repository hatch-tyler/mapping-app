import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ColumnVisibilityDropdown } from './ColumnVisibilityDropdown';

// Create mock columns
const createMockColumn = (id: string, header: string, isVisible = true) => ({
  id,
  columnDef: { header },
  getIsVisible: () => isVisible,
  getToggleVisibilityHandler: () => vi.fn(),
});

// Create a mock table with TanStack Table API
const createMockTable = (columns: ReturnType<typeof createMockColumn>[] = []) => ({
  getAllLeafColumns: () => columns,
  getIsAllColumnsVisible: () => columns.every((c) => c.getIsVisible()),
  getToggleAllColumnsVisibilityHandler: () => vi.fn(),
});

describe('ColumnVisibilityDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render Columns button', () => {
    const mockTable = createMockTable([]);
    render(<ColumnVisibilityDropdown table={mockTable as any} />);

    expect(screen.getByText('Columns')).toBeInTheDocument();
  });

  it('should open dropdown when clicked', () => {
    const columns = [
      createMockColumn('name', 'Name'),
      createMockColumn('type', 'Type'),
    ];
    const mockTable = createMockTable(columns);

    render(<ColumnVisibilityDropdown table={mockTable as any} />);

    fireEvent.click(screen.getByText('Columns'));

    expect(screen.getByText('Toggle Columns')).toBeInTheDocument();
    expect(screen.getByText('Show All')).toBeInTheDocument();
  });

  it('should display all columns as checkboxes', () => {
    const columns = [
      createMockColumn('name', 'Name'),
      createMockColumn('type', 'Type'),
      createMockColumn('features', 'Features'),
    ];
    const mockTable = createMockTable(columns);

    render(<ColumnVisibilityDropdown table={mockTable as any} />);
    fireEvent.click(screen.getByText('Columns'));

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();
  });

  it('should filter out select column', () => {
    const columns = [
      createMockColumn('select', 'Select'),
      createMockColumn('name', 'Name'),
    ];
    const mockTable = createMockTable(columns);

    render(<ColumnVisibilityDropdown table={mockTable as any} />);
    fireEvent.click(screen.getByText('Columns'));

    expect(screen.queryByText('Select')).not.toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('should show checked state for visible columns', () => {
    const columns = [
      createMockColumn('name', 'Name', true),
      createMockColumn('type', 'Type', false),
    ];
    const mockTable = createMockTable(columns);

    render(<ColumnVisibilityDropdown table={mockTable as any} />);
    fireEvent.click(screen.getByText('Columns'));

    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is "Show All"
    // Second checkbox is "Name" - should be checked
    // Third checkbox is "Type" - should not be checked
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();
  });

  it('should check "Show All" when all columns visible', () => {
    const columns = [
      createMockColumn('name', 'Name', true),
      createMockColumn('type', 'Type', true),
    ];
    const mockTable = createMockTable(columns);

    render(<ColumnVisibilityDropdown table={mockTable as any} />);
    fireEvent.click(screen.getByText('Columns'));

    const showAllCheckbox = screen.getAllByRole('checkbox')[0];
    expect(showAllCheckbox).toBeChecked();
  });

  it('should uncheck "Show All" when not all columns visible', () => {
    const columns = [
      createMockColumn('name', 'Name', true),
      createMockColumn('type', 'Type', false),
    ];
    const mockTable = createMockTable(columns);

    render(<ColumnVisibilityDropdown table={mockTable as any} />);
    fireEvent.click(screen.getByText('Columns'));

    const showAllCheckbox = screen.getAllByRole('checkbox')[0];
    expect(showAllCheckbox).not.toBeChecked();
  });

  it('should close dropdown when clicking outside', async () => {
    const mockTable = createMockTable([createMockColumn('name', 'Name')]);

    render(
      <div>
        <div data-testid="outside">Outside</div>
        <ColumnVisibilityDropdown table={mockTable as any} />
      </div>
    );

    fireEvent.click(screen.getByText('Columns'));
    expect(screen.getByText('Toggle Columns')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));

    await waitFor(() => {
      expect(screen.queryByText('Toggle Columns')).not.toBeInTheDocument();
    });
  });

  it('should toggle dropdown when button clicked multiple times', () => {
    const mockTable = createMockTable([createMockColumn('name', 'Name')]);

    render(<ColumnVisibilityDropdown table={mockTable as any} />);

    const button = screen.getByText('Columns');

    // Open
    fireEvent.click(button);
    expect(screen.getByText('Toggle Columns')).toBeInTheDocument();

    // Close
    fireEvent.click(button);
    expect(screen.queryByText('Toggle Columns')).not.toBeInTheDocument();

    // Open again
    fireEvent.click(button);
    expect(screen.getByText('Toggle Columns')).toBeInTheDocument();
  });

  it('should display column id when header is not a string', () => {
    const columnWithFnHeader = {
      id: 'custom-column',
      columnDef: { header: () => 'Header Component' }, // Function header
      getIsVisible: () => true,
      getToggleVisibilityHandler: () => vi.fn(),
    };
    const mockTable = createMockTable([columnWithFnHeader as any]);

    render(<ColumnVisibilityDropdown table={mockTable as any} />);
    fireEvent.click(screen.getByText('Columns'));

    // Should show the column id when header is not a string
    expect(screen.getByText('custom-column')).toBeInTheDocument();
  });
});
