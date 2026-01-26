import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import {
  getRegistrationRequests,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  RegistrationRequestItem,
} from '../../api/registration';

export function RegistrationRequests() {
  const [requests, setRequests] = useState<RegistrationRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showAll, setShowAll] = useState(false);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getRegistrationRequests(!showAll);
      setRequests(data.requests);
      setTotal(data.total);
    } catch (err) {
      setError('Failed to load registration requests');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [showAll]);

  const handleApprove = async (id: string) => {
    try {
      setProcessingId(id);
      await approveRegistrationRequest(id);
      // Remove from list or refresh
      setRequests(requests.filter((r) => r.id !== id));
      setTotal(total - 1);
    } catch (err) {
      setError('Failed to approve request');
      console.error(err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModalId) return;

    try {
      setProcessingId(rejectModalId);
      await rejectRegistrationRequest(rejectModalId, rejectReason || undefined);
      // Remove from list or refresh
      setRequests(requests.filter((r) => r.id !== rejectModalId));
      setTotal(total - 1);
      setRejectModalId(null);
      setRejectReason('');
    } catch (err) {
      setError('Failed to reject request');
      console.error(err);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 text-red-600 bg-red-50 p-4 rounded-md">{error}</div>
      )}

      <div className="flex items-center justify-between mb-4 px-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Show all requests (including processed)
        </label>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg mx-4">
          <p className="text-gray-500">No pending registration requests</p>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                  Submitted
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {requests.map((request) => (
                <tr key={request.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm text-gray-900">
                      {request.full_name || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm text-gray-600">{request.email}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 hidden sm:table-cell">
                    {format(new Date(request.created_at), 'MMM d, yyyy HH:mm')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                        request.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : request.status === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {request.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {request.status === 'pending' && (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleApprove(request.id)}
                          disabled={processingId === request.id}
                          className="px-3 py-1 rounded text-xs font-medium text-green-600 hover:bg-green-50 disabled:opacity-50"
                        >
                          {processingId === request.id ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => setRejectModalId(request.id)}
                          disabled={processingId === request.id}
                          className="px-3 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModalId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Reject Registration Request
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Optionally provide a reason for rejection. This will be sent to the
              applicant.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Reason for rejection (optional)"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => {
                  setRejectModalId(null);
                  setRejectReason('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={processingId !== null}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
              >
                {processingId ? 'Rejecting...' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
