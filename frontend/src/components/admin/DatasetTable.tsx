import { useState } from 'react';
import { format } from 'date-fns';
import { Dataset } from '../../api/types';
import { VisibilityToggle } from './VisibilityToggle';
import { PublicToggle } from './PublicToggle';
import { ShareUrlModal } from './ShareUrlModal';

interface Props {
  datasets: Dataset[];
  onToggleVisibility: (id: string, visible: boolean) => void;
  onTogglePublic: (id: string, isPublic: boolean) => void;
  onDelete: (id: string) => void;
}

export function DatasetTable({
  datasets,
  onToggleVisibility,
  onTogglePublic,
  onDelete,
}: Props) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [shareModalDataset, setShareModalDataset] = useState<Dataset | null>(null);

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      onDelete(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
    }
  };

  if (datasets.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg">
        <p className="text-gray-500">No datasets found</p>
        <p className="text-gray-400 text-sm mt-1">
          Upload a dataset to get started
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
              Format
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
              Features
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
              Created
            </th>
            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
              Visible
            </th>
            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
              Public
            </th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {datasets.map((dataset) => (
            <tr key={dataset.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {dataset.name}
                  </span>
                  {dataset.description && (
                    <span className="text-xs text-gray-500 truncate">
                      {dataset.description}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 whitespace-nowrap">
                <span
                  className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                    dataset.data_type === 'vector'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  {dataset.data_type}
                </span>
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 hidden sm:table-cell">
                {dataset.source_format.toUpperCase()}
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell">
                {dataset.feature_count?.toLocaleString() ?? '-'}
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 hidden lg:table-cell">
                {format(new Date(dataset.created_at), 'MMM d, yyyy')}
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-center">
                <VisibilityToggle
                  visible={dataset.is_visible}
                  onChange={(visible) => onToggleVisibility(dataset.id, visible)}
                />
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-center">
                <PublicToggle
                  isPublic={dataset.is_public}
                  onChange={(isPublic) => onTogglePublic(dataset.id, isPublic)}
                />
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-right">
                <div className="flex justify-end gap-1">
                  {dataset.is_public && dataset.data_type === 'vector' && (
                    <button
                      onClick={() => setShareModalDataset(dataset)}
                      className="px-2 py-1 rounded text-xs font-medium text-green-600 hover:bg-green-50"
                      title="Share & Download"
                    >
                      Share
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(dataset.id)}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      deleteConfirm === dataset.id
                        ? 'bg-red-600 text-white'
                        : 'text-red-600 hover:bg-red-50'
                    }`}
                  >
                    {deleteConfirm === dataset.id ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shareModalDataset && (
        <ShareUrlModal
          dataset={shareModalDataset}
          onClose={() => setShareModalDataset(null)}
        />
      )}
    </div>
  );
}
