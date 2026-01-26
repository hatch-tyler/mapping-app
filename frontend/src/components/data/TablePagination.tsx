import { Table } from '@tanstack/react-table';

interface Props<T> {
  table: Table<T>;
  totalPages: number;
  totalCount: number;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

export function TablePagination<T>({ table, totalPages, totalCount }: Props<T>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const currentPage = pageIndex + 1;

  const startRow = totalCount > 0 ? pageIndex * pageSize + 1 : 0;
  const endRow = Math.min((pageIndex + 1) * pageSize, totalCount);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white">
      {/* Left: Row info and page size selector */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">
          Showing {startRow.toLocaleString()} - {endRow.toLocaleString()} of{' '}
          {totalCount.toLocaleString()}
        </span>

        <div className="flex items-center gap-2">
          <label htmlFor="page-size" className="text-sm text-gray-600">
            Rows per page:
          </label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: Page navigation */}
      <div className="flex items-center gap-2">
        {/* First */}
        <button
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="First page"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>

        {/* Previous */}
        <button
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Previous page"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Page info */}
        <span className="px-4 text-sm text-gray-700">
          Page <span className="font-medium">{currentPage}</span> of{' '}
          <span className="font-medium">{totalPages}</span>
        </span>

        {/* Next */}
        <button
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Next page"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Last */}
        <button
          onClick={() => table.setPageIndex(totalPages - 1)}
          disabled={!table.getCanNextPage()}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Last page"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 5l7 7-7 7M5 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
