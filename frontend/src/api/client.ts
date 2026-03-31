import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './tokenService';

const API_URL = import.meta.env.VITE_API_URL ?? '';

export const apiClient = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 30000, // 30 seconds timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Separate client for file uploads (no default Content-Type)
export const uploadClient = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 600000, // 10 minutes for large file uploads
});

// Add auth token to upload client
uploadClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Request interceptor to add auth token and handle FormData
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Remove Content-Type for FormData to let browser set it with boundary
    if (config.data instanceof FormData) {
      config.headers['Content-Type'] = undefined;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Token refresh queue — prevents concurrent refresh attempts
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token');
  }

  const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
    refresh_token: refreshToken,
  });

  const { access_token, refresh_token: newRefreshToken } = response.data;
  setTokens(access_token, newRefreshToken);
  return access_token;
}

// Response interceptor for token refresh — shared by both clients
function createRefreshInterceptor(client: typeof apiClient) {
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          if (!refreshPromise) {
            refreshPromise = refreshAccessToken().finally(() => {
              refreshPromise = null;
            });
          }

          const newToken = await refreshPromise;
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return client(originalRequest);
        } catch {
          clearTokens();
          window.location.href = '/login';
        }
      }

      return Promise.reject(error);
    }
  );
}

createRefreshInterceptor(apiClient);
createRefreshInterceptor(uploadClient);

export { API_URL };
