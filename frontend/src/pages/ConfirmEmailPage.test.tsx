import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmEmailPage } from './ConfirmEmailPage';
import * as authApi from '../api/auth';

vi.mock('../api/auth', () => ({
  confirmEmail: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ConfirmEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderConfirmEmailPage = (search: string = '') => {
    return render(
      <MemoryRouter initialEntries={[`/confirm-email${search}`]}>
        <ConfirmEmailPage />
      </MemoryRouter>
    );
  };

  it('should render Email Confirmation header', () => {
    renderConfirmEmailPage();
    expect(screen.getByText('Email Confirmation')).toBeInTheDocument();
  });

  it('should render Go to Login link', () => {
    renderConfirmEmailPage();
    expect(screen.getByText('Go to Login')).toBeInTheDocument();
  });

  it('should show no-token message when token is missing', () => {
    renderConfirmEmailPage();
    expect(screen.getByText('Confirmation Failed')).toBeInTheDocument();
    expect(screen.getByText('No confirmation token provided.')).toBeInTheDocument();
  });

  it('should call confirmEmail API with token', async () => {
    vi.mocked(authApi.confirmEmail).mockResolvedValue({
      message: 'Success',
      email: 'test@example.com',
    });

    await act(async () => {
      renderConfirmEmailPage('?token=test-token-123');
    });

    expect(authApi.confirmEmail).toHaveBeenCalledWith('test-token-123');
  });

  it('should show success message when confirmation succeeds', async () => {
    vi.mocked(authApi.confirmEmail).mockResolvedValue({
      message: 'Your email has been confirmed successfully.',
      email: 'user@example.com',
    });

    await act(async () => {
      renderConfirmEmailPage('?token=valid-token');
    });

    expect(screen.getByText('Email Confirmed!')).toBeInTheDocument();
    expect(screen.getByText('Your email has been confirmed successfully.')).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('should show redirect message after success', async () => {
    vi.mocked(authApi.confirmEmail).mockResolvedValue({
      message: 'Your email has been confirmed.',
      email: 'user@example.com',
    });

    await act(async () => {
      renderConfirmEmailPage('?token=valid-token');
    });

    expect(screen.getByText('Redirecting to login page...')).toBeInTheDocument();
  });

  it('should show error message when confirmation fails', async () => {
    vi.mocked(authApi.confirmEmail).mockRejectedValue(new Error('Token expired'));

    await act(async () => {
      renderConfirmEmailPage('?token=invalid-token');
    });

    expect(screen.getByText('Confirmation Failed')).toBeInTheDocument();
    expect(screen.getByText('Failed to confirm email. Please try again.')).toBeInTheDocument();
  });

  it('should show API error detail when available', async () => {
    const error = {
      response: {
        data: {
          detail: 'Token has expired or is invalid.',
        },
      },
    };
    vi.mocked(authApi.confirmEmail).mockRejectedValue(error);

    await act(async () => {
      renderConfirmEmailPage('?token=expired-token');
    });

    expect(screen.getByText('Token has expired or is invalid.')).toBeInTheDocument();
  });

  it('should handle missing email in success response', async () => {
    vi.mocked(authApi.confirmEmail).mockResolvedValue({
      message: 'Email confirmed.',
      email: '',
    });

    await act(async () => {
      renderConfirmEmailPage('?token=valid-token');
    });

    expect(screen.getByText('Email Confirmed!')).toBeInTheDocument();
    expect(screen.getByText('Email confirmed.')).toBeInTheDocument();
  });

  it('should navigate to login after timeout on success', async () => {
    vi.useFakeTimers();
    vi.mocked(authApi.confirmEmail).mockResolvedValue({
      message: 'Success',
      email: 'user@example.com',
    });

    await act(async () => {
      renderConfirmEmailPage('?token=valid-token');
    });

    expect(screen.getByText('Email Confirmed!')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login');
    vi.useRealTimers();
  });
});
