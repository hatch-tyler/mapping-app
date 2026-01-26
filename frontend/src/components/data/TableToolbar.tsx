import { Table } from '@tanstack/react-table';
import { FeatureRow } from '../../api/types';
import { ColumnVisibilityDropdown } from './ColumnVisibilityDropdown';
import { ExportDropdown } from './ExportDropdown';

interface Props {
  table: Table<FeatureRow>;
  datasetId: string;
  totalCount: number;
}

export function TableToolbar({ table, datasetId, totalCount }: Props) {
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedIds = selectedRows.map((row) => row.original.id);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">
          {totalCount.toLocaleString()} total feature{totalCount !== 1 ? 's' : ''}
        </span>
        {selectedRows.length > 0 && (
          <span className="text-sm font-medium text-blue-600">
            {selectedRows.length} selected
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ColumnVisibilityDropdown table={table} />
        <ExportDropdown datasetId={datasetId} selectedIds={selectedIds} />
      </div>
    </div>
  );
}
