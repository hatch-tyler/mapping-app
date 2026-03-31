import { useState, useEffect, useCallback } from 'react';
import { RegistrationRequests } from '../components/admin/RegistrationRequests';
import { UsersTab } from '../components/admin/UsersTab';
import { Navbar } from '@/components/layout/Navbar';
import { getRegistrationRequests } from '../api/registration';

type TabType = 'registrations' | 'users';

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const data = await getRegistrationRequests(true, 0, 1);
        setPendingCount(data.total);
      } catch (err) {
        console.warn('Failed to fetch pending registrations:', err);
      }
    };
    fetchPending();
    const interval = setInterval(fetchPending, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleCountChange = useCallback((count: number) => {
    setPendingCount(count);
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('users')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'users'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Users
            </button>
            <button
              onClick={() => setActiveTab('registrations')}
              className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
                activeTab === 'registrations'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Registration Requests
              {pendingCount > 0 && (
                <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-red-500 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'users' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                User Management
              </h2>
            </div>
            <UsersTab />
          </div>
        )}

        {activeTab === 'registrations' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Registration Requests
              </h2>
            </div>
            <RegistrationRequests onCountChange={handleCountChange} />
          </div>
        )}
      </main>
    </div>
  );
}
