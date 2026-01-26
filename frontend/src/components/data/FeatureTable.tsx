import { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
  RowSelectionState,
  ColumnDef,
} from '@tanstack/react-table';
import { Dataset, FeatureRow, FieldMetadata, ColumnFilter } from '../../api/types';
import { getDatasetFields, queryFeatures } from '../../api/datasets';
import { TableToolbar } from './TableToolbar';
import { TablePagination } from './TablePagination';

interface Props {
  dataset: Dataset;
}

const columnHelper = createColumnHelper<FeatureRow>();

export function FeatureTable({ dataset }: Props) {
  const [fields, setFields] = useState<FieldMetadata[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 100 });

  // Load field metadata
  useEffect(() => {
    async function loadFields() {
      try {
        const response = await getDatasetFields(dataset.id);
        setFields(response.fields);
      } catch (err) {
        console.error('Failed to load fields:', err);
        setFields([]);
      }
    }
    loadFields();
    // Reset state when dataset changes
    setSorting([]);
    setColumnFilters([]);
    setRowSelection({});
    setPagination({ pageIndex: 0, pageSize: 100 });
  }, [dataset.id]);

  // Load features with server-side pagination/sorting/filtering
  useEffect(() => {
    async function loadFeatures() {
      setLoading(true);
      setError(null);

      try {
        // Build filters from column filters
        const filters: ColumnFilter[] = columnFilters
          .filter((f) => f.value !== undefined && f.value !== '')
          .map((f) => ({
            field: f.id,
            operator: 'contains' as const,
            value: String(f.value),
          }));

        // Get sort parameters
        const sortField = sorting.length > 0 ? sorting[0].id : undefined;
        const sortOrder = sorting.length > 0 ? (sorting[0].desc ? 'desc' : 'asc') : undefined;

        const response = await queryFeatures(
          dataset.id,
          pagination.pageIndex + 1,
          pagination.pageSize,
          sortField,
          sortOrder,
          filters.length > 0 ? filters : undefined
        );

        setFeatures(response.features);
        setTotalCount(response.total_count);
        setTotalPages(response.total_pages);
      } catch (err) {
        setError('Failed to load features');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadFeatures();
  }, [dataset.id, pagination.pageIndex, pagination.pageSize, sorting, columnFilters]);

  // Generate columns dynamically from field metadata
  const columns = useMemo<ColumnDef<FeatureRow, unknown>[]>(() => {
    const cols: ColumnDef<FeatureRow, unknown>[] = [
      // Selection column
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        ),
        size: 40,
        enableSorting: false,
        enableColumnFilter: false,
      },
      // ID column
      columnHelper.accessor('id', {
        header: 'ID',
        cell: (info) => info.getValue(),
        size: 80,
      }),
    ];

    // Add columns for each field
    fields.forEach((field) => {
      cols.push({
        id: field.name,
        accessorFn: (row) => row.properties[field.name],
        header: field.name,
        cell: (info) => {
          const value = info.getValue();
          if (value === null || value === undefined) {
            return <span className="text-gray-400">-</span>;
          }
          if (typeof value === 'boolean') {
            return value ? 'Yes' : 'No';
          }
          return String(value);
        },
      });
    });

    return cols;
  }, [fields]);

  const table = useReactTable({
    data: features,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: totalPages,
    enableRowSelection: true,
    getRowId: (row) => String(row.id),
  });

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Toolbar */}
      <TableToolbar table={table} datasetId={dataset.id} totalCount={totalCount} />

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : (
                      <div className="flex flex-col gap-1">
                        <div
                          className={`flex items-center gap-1 ${
                            header.column.getCanSort() ? 'cursor-pointer select-none' : ''
                          }`}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <span className="text-gray-400">
                              {{
                                asc: ' ^',
                                desc: ' v',
                              }[header.column.getIsSorted() as string] ?? ''}
                            </span>
                          )}
                        </div>
                        {/* Column filter */}
                        {header.column.getCanFilter() && header.id !== 'select' && (
                          <input
                            type="text"
                            value={(header.column.getFilterValue() as string) ?? ''}
                            onChange={(e) => header.column.setFilterValue(e.target.value)}
                            placeholder="Filter..."
                            className="px-2 py-1 text-xs border border-gray-300 rounded w-full font-normal normal-case"
                          />
                        )}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center">
                  <div className="inline-flex items-center gap-2 text-gray-500">
                    <svg
                      className="animate-spin h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Loading features...
                  </div>
                </td>
              </tr>
            ) : features.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-500">
                  No features found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`hover:bg-gray-50 ${row.getIsSelected() ? 'bg-blue-50' : ''}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-2 text-sm text-gray-900 whitespace-nowrap"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <TablePagination table={table} totalPages={totalPages} totalCount={totalCount} />
    </div>
  );
}
