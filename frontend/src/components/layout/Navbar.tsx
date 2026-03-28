import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { ChangePasswordModal } from '@/components/common/ChangePasswordModal';

interface NavbarProps {
  variant?: 'standard' | 'overlay';
}

export function Navbar({ variant = 'standard' }: NavbarProps) {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuthStore();

  const baseClasses = 'h-12 border-b flex items-center';
  const variantClasses =
    variant === 'overlay'
      ? 'absolute top-0 left-0 right-0 z-20 bg-white/80 backdrop-blur-sm border-gray-200/50'
      : 'bg-white shadow-sm border-gray-200';

  const navLinks = [
    { to: '/', label: 'Map' },
    { to: '/catalog', label: 'Catalog' },
    { to: '/data', label: 'Data' },
  ];

  if (user?.role === 'editor' || user?.role === 'admin') {
    navLinks.push({ to: '/upload', label: 'Manage' });
  }

  if (user?.role === 'admin') {
    navLinks.push({ to: '/admin', label: 'Admin' });
  }

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <>
      <nav className={`${baseClasses} ${variantClasses}`}>
        <div className="max-w-full w-full px-4 flex items-center">
          {/* App name */}
          <Link to="/" className="font-semibold text-gray-900">
            GIS Mapping
          </Link>

          {/* Nav links */}
          <div className="ml-8 flex gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                  isActive(link.to)
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right section */}
          <div className="ml-auto flex items-center gap-3">
            {isAuthenticated && user ? (
              <>
                <span className="text-sm text-gray-500">{user.email}</span>
                <button
                  onClick={() => setShowChangePassword(true)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Change Password
                </button>
                <button
                  onClick={() => logout()}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </nav>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </>
  );
}
