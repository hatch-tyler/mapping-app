import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { confirmEmail } from '../api/auth';

type ConfirmationStatus = 'loading' | 'success' | 'error' | 'no-token';

export function ConfirmEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConfirmationStatus>('loading');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('no-token');
      setMessage('No confirmation token provided.');
      return;
    }

    const verifyToken = async () => {
      try {
        const response = await confirmEmail(token);
        setStatus('success');
        setMessage(response.message);
        setEmail(response.email);

        // Redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      } catch (err: unknown) {
        setStatus('error');
        if (err && typeof err === 'object' && 'response' in err) {
          const axiosError = err as { response?: { data?: { detail?: string } } };
          setMessage(axiosError.response?.data?.detail || 'Failed to confirm email.');
        } else {
          setMessage('Failed to confirm email. Please try again.');
        }
      }
    };

    verifyToken();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Email Confirmation</h1>
        </div>

        <div className="mt-8">
          {status === 'loading' && (
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Confirming your email...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="rounded-md bg-green-50 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg
                    className="h-5 w-5 text-green-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">
                    Email Confirmed!
                  </h3>
                  <div className="mt-2 text-sm text-green-700">
                    <p>{message}</p>
                    {email && <p className="mt-1 font-medium">{email}</p>}
                  </div>
                  <div className="mt-4">
                    <p className="text-sm text-green-600">
                      Redirecting to login page...
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(status === 'error' || status === 'no-token') && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg
                    className="h-5 w-5 text-red-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    Confirmation Failed
                  </h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{message}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
