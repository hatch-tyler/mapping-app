import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegisterPage } from './RegisterPage';
import * as registrationApi from '../api/registration';

vi.mock('../api/registration', () => ({
  submitRegistrationRequest: vi.fn(),
}));

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderRegisterPage = () => {
    return render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );
  };

  it('should render registration form', () => {
    renderRegisterPage();
    expect(screen.getByText('GIS Application')).toBeInTheDocument();
    expect(screen.getByText('Request access to your account')).toBeInTheDocument();
  });

  it('should render all form fields', () => {
    renderRegisterPage();
    expect(screen.getByLabelText(/Full Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm Password/)).toBeInTheDocument();
  });

  it('should render Request Access button', () => {
    renderRegisterPage();
    expect(screen.getByRole('button', { name: 'Request Access' })).toBeInTheDocument();
  });

  it('should render sign in link', () => {
    renderRegisterPage();
    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });

  it('should update full name input', () => {
    renderRegisterPage();
    const input = screen.getByLabelText(/Full Name/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'John Doe' } });
    expect(input.value).toBe('John Doe');
  });

  it('should update email input', () => {
    renderRegisterPage();
    const input = screen.getByLabelText(/^Email/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    expect(input.value).toBe('test@example.com');
  });

  it('should update password input', () => {
    renderRegisterPage();
    const input = screen.getByLabelText(/^Password/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'password123' } });
    expect(input.value).toBe('password123');
  });

  it('should update confirm password input', () => {
    renderRegisterPage();
    const input = screen.getByLabelText(/Confirm Password/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'password123' } });
    expect(input.value).toBe('password123');
  });

  it('should show error when passwords do not match', async () => {
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'different123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
  });

  it('should show error when password is too short', async () => {
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    });
  });

  it('should show loading state when submitting', async () => {
    vi.mocked(registrationApi.submitRegistrationRequest).mockImplementation(
      () => new Promise(() => {})
    );
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Submitting...' })).toBeDisabled();
    });
  });

  it('should call submitRegistrationRequest with form data', async () => {
    vi.mocked(registrationApi.submitRegistrationRequest).mockResolvedValue({
      message: 'Registration request submitted successfully',
      email: 'test@example.com',
    });
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/Full Name/), {
      target: { value: 'John Doe' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(registrationApi.submitRegistrationRequest).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        full_name: 'John Doe',
      });
    });
  });

  it('should show success message after successful submission', async () => {
    vi.mocked(registrationApi.submitRegistrationRequest).mockResolvedValue({
      message: 'Success',
      email: 'test@example.com',
    });
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(screen.getByText('Request Submitted')).toBeInTheDocument();
    });
  });

  it('should show Back to Login link after success', async () => {
    vi.mocked(registrationApi.submitRegistrationRequest).mockResolvedValue({
      message: 'Success',
      email: 'test@example.com',
    });
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(screen.getByText('Back to Login')).toBeInTheDocument();
    });
  });

  it('should show error from API response', async () => {
    vi.mocked(registrationApi.submitRegistrationRequest).mockRejectedValue(
      new Error('Email already registered')
    );
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(screen.getByText('Email already registered')).toBeInTheDocument();
    });
  });

  it('should show generic error for non-Error exceptions', async () => {
    vi.mocked(registrationApi.submitRegistrationRequest).mockRejectedValue('Unknown error');
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(screen.getByText('An error occurred. Please try again.')).toBeInTheDocument();
    });
  });

  it('should send undefined for empty full name', async () => {
    vi.mocked(registrationApi.submitRegistrationRequest).mockResolvedValue({
      message: 'Success',
      email: 'test@example.com',
    });
    renderRegisterPage();

    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Access' }));

    await waitFor(() => {
      expect(registrationApi.submitRegistrationRequest).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        full_name: undefined,
      });
    });
  });
});
