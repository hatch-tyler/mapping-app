import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { useAuthStore } from '@/stores/authStore';
import { User, UserRole } from '@/api/types';
import * as usersApi from '@/api/users';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-800',
  editor: 'bg-blue-100 text-blue-800',
  viewer: 'bg-gray-100 text-gray-800',
};

export function UsersTab() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: usersApi.UserListParams = {};
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      const data = await usersApi.getUsers(params);
      setUsers(data);
    } catch (err) {
      setError('Failed to load users');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [roleFilter]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchUsers();
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      setProcessingId(userId);
      const updated = await usersApi.updateUser(userId, { role: newRole });
      setUsers(users.map((u) => (u.id === userId ? updated : u)));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to update role';
      setError(message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      setProcessingId(userId);
      const updated = await usersApi.updateUser(userId, { is_active: isActive });
      setUsers(users.map((u) => (u.id === userId ? updated : u)));
    } catch (err) {
      setError('Failed to update user status');
      console.error(err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      setProcessingId(userId);
      await usersApi.deleteUser(userId);
      setUsers(users.filter((u) => u.id !== userId));
      setDeleteConfirmId(null);
    } catch (err) {
      setError('Failed to delete user');
      console.error(err);
    } finally {
      setProcessingId(null);
    }
  };

  const isSelf = (userId: string) => currentUser?.id === userId;

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 mx-4 text-red-600 bg-red-50 p-4 rounded-md flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            &times;
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name..."
          className="flex-1 max-w-sm px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>

      {users.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg mx-4 mt-4">
          <p className="text-gray-500">No users found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-gray-50 ${isSelf(u.id) ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm text-gray-900">
                      {u.full_name || '-'}
                    </span>
                    {isSelf(u.id) && (
                      <span className="ml-2 text-xs text-blue-600 font-medium">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm text-gray-600">{u.email}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    {isSelf(u.id) ? (
                      <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${ROLE_COLORS[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                        disabled={processingId === u.id}
                        className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <button
                      onClick={() => handleToggleActive(u.id, !u.is_active)}
                      disabled={isSelf(u.id) || processingId === u.id}
                      className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                        u.is_active
                          ? 'bg-green-100 text-green-800 hover:bg-green-200'
                          : 'bg-red-100 text-red-800 hover:bg-red-200'
                      }`}
                    >
                      {u.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 hidden sm:table-cell">
                    {format(new Date(u.created_at), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {!isSelf(u.id) && (
                      <button
                        onClick={() => setDeleteConfirmId(u.id)}
                        disabled={processingId === u.id}
                        className="px-3 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Delete User
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete{' '}
              <strong>
                {users.find((u) => u.id === deleteConfirmId)?.email}
              </strong>
              ? This action cannot be undone. Their datasets will be preserved but
              will no longer be associated with this user.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                disabled={processingId !== null}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
              >
                {processingId ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
