import { useState } from 'react';
import { RegistrationRequests } from '../components/admin/RegistrationRequests';
import { UsersTab } from '../components/admin/UsersTab';
import { Navbar } from '@/components/layout/Navbar';

type TabType = 'registrations' | 'users';

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>('users');

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
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'registrations'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Registration Requests
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
            <RegistrationRequests />
          </div>
        )}
      </main>
    </div>
  );
}
