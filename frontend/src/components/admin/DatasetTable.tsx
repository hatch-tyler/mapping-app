import { useState } from 'react';
import { format } from 'date-fns';
import { Dataset, StyleConfig } from '../../api/types';
import { VisibilityToggle } from './VisibilityToggle';
import { PublicToggle } from './PublicToggle';
import { ShareUrlModal } from './ShareUrlModal';
import { StyleEditor } from '../styling/StyleEditor';

interface Props {
  datasets: Dataset[];
  onToggleVisibility: (id: string, visible: boolean) => void;
  onTogglePublic: (id: string, isPublic: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, data: { name?: string; description?: string; style_config?: StyleConfig }) => void;
}

interface EditState {
  id: string;
  name: string;
  description: string;
}

export function DatasetTable({
  datasets,
  onToggleVisibility,
  onTogglePublic,
  onDelete,
  onUpdate,
}: Props) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [shareModalDataset, setShareModalDataset] = useState<Dataset | null>(null);
  const [styleModalDataset, setStyleModalDataset] = useState<Dataset | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      onDelete(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
    }
  };

  const handleEditClick = (dataset: Dataset) => {
    setEditState({
      id: dataset.id,
      name: dataset.name,
      description: dataset.description || '',
    });
  };

  const handleEditSave = () => {
    if (editState && onUpdate) {
      onUpdate(editState.id, {
        name: editState.name,
        description: editState.description || undefined,
      });
      setEditState(null);
    }
  };

  const handleEditCancel = () => {
    setEditState(null);
  };

  const handleStyleSave = (styleConfig: StyleConfig) => {
    if (styleModalDataset && onUpdate) {
      onUpdate(styleModalDataset.id, { style_config: styleConfig });
      setStyleModalDataset(null);
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
      <table className="w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <th className="w-1/4 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th className="w-16 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="w-16 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
              Format
            </th>
            <th className="w-20 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
              Features
            </th>
            <th className="w-24 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
              Created
            </th>
            <th className="w-16 px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
              Visible
            </th>
            <th className="w-16 px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
              Public
            </th>
            <th className="w-32 px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {datasets.map((dataset) => (
            <tr key={dataset.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="flex flex-col min-w-0">
                  <span
                    className="text-sm font-medium text-gray-900 truncate"
                    title={dataset.name}
                  >
                    {dataset.name}
                  </span>
                  {dataset.description && (
                    <span
                      className="text-xs text-gray-500 truncate"
                      title={dataset.description}
                    >
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
                  {onUpdate && dataset.data_type === 'vector' && (
                    <button
                      onClick={() => setStyleModalDataset(dataset)}
                      className="p-1.5 rounded text-purple-600 hover:bg-purple-50"
                      title="Edit layer style"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                      </svg>
                    </button>
                  )}
                  {onUpdate && (
                    <button
                      onClick={() => handleEditClick(dataset)}
                      className="p-1.5 rounded text-blue-600 hover:bg-blue-50"
                      title="Edit dataset"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}
                  {dataset.is_public && dataset.data_type === 'vector' && (
                    <button
                      onClick={() => setShareModalDataset(dataset)}
                      className="p-1.5 rounded text-green-600 hover:bg-green-50"
                      title="Share & Download"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(dataset.id)}
                    className={`p-1.5 rounded ${
                      deleteConfirm === dataset.id
                        ? 'bg-red-600 text-white'
                        : 'text-red-600 hover:bg-red-50'
                    }`}
                    title={deleteConfirm === dataset.id ? 'Click to confirm deletion' : 'Delete dataset'}
                  >
                    {deleteConfirm === dataset.id ? (
                      <span className="text-xs font-medium px-0.5">Confirm?</span>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
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

      {styleModalDataset && (
        <StyleEditor
          dataset={styleModalDataset}
          onSave={handleStyleSave}
          onClose={() => setStyleModalDataset(null)}
        />
      )}

      {/* Edit Modal */}
      {editState && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Edit Dataset</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label
                  htmlFor="edit-name"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Name
                </label>
                <input
                  type="text"
                  id="edit-name"
                  value={editState.name}
                  onChange={(e) =>
                    setEditState({ ...editState, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="edit-description"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Description
                </label>
                <textarea
                  id="edit-description"
                  value={editState.description}
                  onChange={(e) =>
                    setEditState({ ...editState, description: e.target.value })
                  }
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter description (optional)"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={handleEditCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={!editState.name.trim()}
                className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                  editState.name.trim()
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-gray-400 cursor-not-allowed'
                }`}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
