import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TablePagination } from './TablePagination';

// Create a mock table with TanStack Table API
const createMockTable = (overrides = {}) => ({
  getState: () => ({
    pagination: { pageIndex: 0, pageSize: 100, ...overrides },
  }),
  setPageSize: vi.fn(),
  setPageIndex: vi.fn(),
  getCanPreviousPage: () => false,
  getCanNextPage: () => true,
  previousPage: vi.fn(),
  nextPage: vi.fn(),
  ...overrides,
});

describe('TablePagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display row range and total count', () => {
    const mockTable = createMockTable();
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    // Check for the full "Showing X - Y of Z" text
    expect(screen.getByText(/Showing 1 - 100 of/)).toBeInTheDocument();
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
  });

  it('should display page info', () => {
    const mockTable = createMockTable();
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    expect(screen.getByText(/Page/)).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('should render page size selector', () => {
    const mockTable = createMockTable();
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    expect(screen.getByLabelText('Rows per page:')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('should have correct page size options', () => {
    const mockTable = createMockTable();
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    const select = screen.getByRole('combobox');
    expect(select).toContainHTML('25');
    expect(select).toContainHTML('50');
    expect(select).toContainHTML('100');
    expect(select).toContainHTML('250');
  });

  it('should call setPageSize when page size changes', () => {
    const mockTable = createMockTable();
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '50' } });

    expect(mockTable.setPageSize).toHaveBeenCalledWith(50);
  });

  it('should render navigation buttons', () => {
    const mockTable = createMockTable();
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    expect(screen.getByTitle('First page')).toBeInTheDocument();
    expect(screen.getByTitle('Previous page')).toBeInTheDocument();
    expect(screen.getByTitle('Next page')).toBeInTheDocument();
    expect(screen.getByTitle('Last page')).toBeInTheDocument();
  });

  it('should disable previous buttons on first page', () => {
    const mockTable = createMockTable({ getCanPreviousPage: () => false });
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    expect(screen.getByTitle('First page')).toBeDisabled();
    expect(screen.getByTitle('Previous page')).toBeDisabled();
  });

  it('should disable next buttons on last page', () => {
    const mockTable = createMockTable({
      getCanPreviousPage: () => true,
      getCanNextPage: () => false,
    });
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    expect(screen.getByTitle('Next page')).toBeDisabled();
    expect(screen.getByTitle('Last page')).toBeDisabled();
  });

  it('should call setPageIndex(0) when first button clicked', () => {
    const mockTable = createMockTable({ getCanPreviousPage: () => true });
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    fireEvent.click(screen.getByTitle('First page'));
    expect(mockTable.setPageIndex).toHaveBeenCalledWith(0);
  });

  it('should call previousPage when previous button clicked', () => {
    const mockTable = createMockTable({ getCanPreviousPage: () => true });
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    fireEvent.click(screen.getByTitle('Previous page'));
    expect(mockTable.previousPage).toHaveBeenCalled();
  });

  it('should call nextPage when next button clicked', () => {
    const mockTable = createMockTable({ getCanNextPage: () => true });
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    fireEvent.click(screen.getByTitle('Next page'));
    expect(mockTable.nextPage).toHaveBeenCalled();
  });

  it('should call setPageIndex(totalPages-1) when last button clicked', () => {
    const mockTable = createMockTable({ getCanNextPage: () => true });
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    fireEvent.click(screen.getByTitle('Last page'));
    expect(mockTable.setPageIndex).toHaveBeenCalledWith(9);
  });

  it('should show correct row range for middle page', () => {
    const mockTable = {
      getState: () => ({
        pagination: { pageIndex: 2, pageSize: 100 },
      }),
      setPageSize: vi.fn(),
      setPageIndex: vi.fn(),
      getCanPreviousPage: () => true,
      getCanNextPage: () => true,
      previousPage: vi.fn(),
      nextPage: vi.fn(),
    };
    render(<TablePagination table={mockTable as any} totalPages={10} totalCount={1000} />);

    // Page 3 (index 2) with 100 per page should show 201-300
    expect(screen.getByText(/Showing 201 - 300 of/)).toBeInTheDocument();
  });

  it('should handle empty results', () => {
    const mockTable = createMockTable({
      pagination: { pageIndex: 0, pageSize: 100 },
    });
    render(<TablePagination table={mockTable as any} totalPages={0} totalCount={0} />);

    expect(screen.getByText(/Showing 0/)).toBeInTheDocument();
  });
});
