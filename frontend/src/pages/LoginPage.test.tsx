import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '../stores/authStore';
import * as authApi from '../api/auth';

// Mock the auth API
vi.mock('../api/auth', () => ({
  resendConfirmation: vi.fn(),
}));

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isLoginLoading: false,
      error: null,
    });
    mockNavigate.mockClear();
  });

  const renderLoginPage = () => {
    return render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
  };

  it('should render login form', () => {
    renderLoginPage();

    expect(screen.getByText('GIS Application')).toBeInTheDocument();
    expect(screen.getByText('Sign in to your account')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('should render registration link', () => {
    renderLoginPage();

    expect(screen.getByText(/Don't have an account?/)).toBeInTheDocument();
    expect(screen.getByText('Request Access')).toBeInTheDocument();
  });

  it('should render public data link', () => {
    renderLoginPage();

    expect(screen.getByText('Browse Public Data')).toBeInTheDocument();
  });

  it('should update email input', () => {
    renderLoginPage();

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    expect(emailInput).toHaveValue('test@example.com');
  });

  it('should update password input', () => {
    renderLoginPage();

    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: 'password123' } });

    expect(passwordInput).toHaveValue('password123');
  });

  it('should call login on form submit', async () => {
    const mockLogin = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      login: mockLogin,
      isLoginLoading: false,
      error: null,
      clearError: vi.fn(),
    });

    renderLoginPage();

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const submitButton = screen.getByRole('button', { name: 'Sign In' });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('should navigate after successful login', async () => {
    const mockLogin = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      login: mockLogin,
      isLoginLoading: false,
      error: null,
      clearError: vi.fn(),
    });

    renderLoginPage();

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const submitButton = screen.getByRole('button', { name: 'Sign In' });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('should show loading state during login', () => {
    useAuthStore.setState({
      isLoginLoading: true,
      error: null,
    });

    renderLoginPage();

    expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
  });

  it('should display error message', () => {
    useAuthStore.setState({
      isLoginLoading: false,
      error: 'Invalid email or password',
    });

    renderLoginPage();

    expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
  });

  it('should show resend confirmation button for inactive account', () => {
    useAuthStore.setState({
      isLoginLoading: false,
      error: 'Your account is inactive. Please confirm your email.',
    });

    renderLoginPage();

    expect(screen.getByText('Resend confirmation email')).toBeInTheDocument();
  });

  it('should call resendConfirmation when resend button clicked', async () => {
    vi.mocked(authApi.resendConfirmation).mockResolvedValue({
      message: 'Confirmation email sent',
    });

    useAuthStore.setState({
      isLoginLoading: false,
      error: 'Your account is inactive',
    });

    renderLoginPage();

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    const resendButton = screen.getByText('Resend confirmation email');
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(authApi.resendConfirmation).toHaveBeenCalledWith('test@example.com');
    });
  });

  it('should show resend message after clicking resend', async () => {
    vi.mocked(authApi.resendConfirmation).mockResolvedValue({
      message: 'Confirmation email sent successfully',
    });

    useAuthStore.setState({
      isLoginLoading: false,
      error: 'Your account is inactive',
    });

    renderLoginPage();

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    const resendButton = screen.getByText('Resend confirmation email');
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(screen.getByText('Confirmation email sent successfully')).toBeInTheDocument();
    });
  });

  it('should show error when resend fails', async () => {
    vi.mocked(authApi.resendConfirmation).mockRejectedValue(new Error('Network error'));

    useAuthStore.setState({
      isLoginLoading: false,
      error: 'Your account is inactive',
    });

    renderLoginPage();

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    const resendButton = screen.getByText('Resend confirmation email');
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(
        screen.getByText('Failed to resend confirmation email. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('should prompt for email before resending', async () => {
    useAuthStore.setState({
      isLoginLoading: false,
      error: 'Your account is inactive',
    });

    renderLoginPage();

    const resendButton = screen.getByText('Resend confirmation email');
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(screen.getByText('Please enter your email address first.')).toBeInTheDocument();
    });
  });
});
