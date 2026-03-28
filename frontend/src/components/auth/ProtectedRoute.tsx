import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import type { UserRole } from '../../api/types';

interface Props {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireRole?: UserRole[];
}

export function ProtectedRoute({ children, requireAdmin = false, requireRole }: Props) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  if (requireRole && user && !requireRole.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
