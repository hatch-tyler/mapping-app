import { useState, FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { resendConfirmation } from '../api/auth';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const { login, isLoginLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';
  const isInactiveError = error?.toLowerCase().includes('inactive');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setResendMessage(null);

    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch {
      // Error is handled by the store
    }
  };

  const handleResendConfirmation = async () => {
    if (!email) {
      setResendMessage('Please enter your email address first.');
      return;
    }
    setIsResending(true);
    try {
      const response = await resendConfirmation(email);
      setResendMessage(response.message);
    } catch {
      setResendMessage('Failed to resend confirmation email. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">GIS Application</h1>
          <p className="text-gray-600 mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
              <p>{error}</p>
              {isInactiveError && (
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={isResending}
                  className="mt-2 text-blue-600 hover:text-blue-800 underline text-sm"
                >
                  {isResending ? 'Sending...' : 'Resend confirmation email'}
                </button>
              )}
            </div>
          )}

          {resendMessage && (
            <div className="text-green-600 text-sm bg-green-50 p-3 rounded-md">
              {resendMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoginLoading}
            className={`w-full py-2 px-4 rounded-md font-medium text-white transition-colors ${
              isLoginLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isLoginLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-gray-600">
            Don't have an account?{' '}
            <Link
              to="/register"
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Request Access
            </Link>
          </p>
          <p className="text-sm text-gray-500">
            or{' '}
            <Link
              to="/data"
              className="text-blue-600 hover:text-blue-800"
            >
              Browse Public Data
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
