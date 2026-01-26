import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegistrationRequests } from './RegistrationRequests';
import * as registrationApi from '../../api/registration';

// Mock the registration API
vi.mock('../../api/registration', () => ({
  getRegistrationRequests: vi.fn(),
  approveRegistrationRequest: vi.fn(),
  rejectRegistrationRequest: vi.fn(),
}));

const mockRequests = [
  {
    id: '1',
    email: 'user1@example.com',
    full_name: 'User One',
    status: 'pending',
    rejection_reason: null,
    created_at: '2024-01-15T10:00:00Z',
    processed_at: null,
  },
  {
    id: '2',
    email: 'user2@example.com',
    full_name: null,
    status: 'pending',
    rejection_reason: null,
    created_at: '2024-01-16T14:30:00Z',
    processed_at: null,
  },
];

describe('RegistrationRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state initially', () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockImplementation(
      () => new Promise(() => {})
    );

    render(<RegistrationRequests />);

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should display registration requests after loading', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('user1@example.com')).toBeInTheDocument();
      expect(screen.getByText('user2@example.com')).toBeInTheDocument();
    });
  });

  it('should display full name when available', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('User One')).toBeInTheDocument();
    });
  });

  it('should display dash when full name is null', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      const dashes = screen.getAllByText('-');
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  it('should show empty state when no requests', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: [],
      total: 0,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('No pending registration requests')).toBeInTheDocument();
    });
  });

  it('should show error state when loading fails', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockRejectedValue(
      new Error('Network error')
    );

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load registration requests')).toBeInTheDocument();
    });
  });

  it('should render approve and reject buttons for pending requests', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      const approveButtons = screen.getAllByText('Approve');
      const rejectButtons = screen.getAllByText('Reject');
      expect(approveButtons.length).toBe(2);
      expect(rejectButtons.length).toBe(2);
    });
  });

  it('should call approveRegistrationRequest when approve is clicked', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });
    vi.mocked(registrationApi.approveRegistrationRequest).mockResolvedValue({
      ...mockRequests[0],
      status: 'approved',
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('user1@example.com')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByText('Approve');
    fireEvent.click(approveButtons[0]);

    await waitFor(() => {
      expect(registrationApi.approveRegistrationRequest).toHaveBeenCalledWith('1');
    });
  });

  it('should open reject modal when reject is clicked', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('user1@example.com')).toBeInTheDocument();
    });

    const rejectButtons = screen.getAllByText('Reject');
    fireEvent.click(rejectButtons[0]);

    expect(screen.getByText('Reject Registration Request')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Reason for rejection (optional)')).toBeInTheDocument();
  });

  it('should call rejectRegistrationRequest when reject modal is confirmed', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });
    vi.mocked(registrationApi.rejectRegistrationRequest).mockResolvedValue({
      ...mockRequests[0],
      status: 'rejected',
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('user1@example.com')).toBeInTheDocument();
    });

    // Open reject modal
    const rejectButtons = screen.getAllByText('Reject');
    fireEvent.click(rejectButtons[0]);

    // Enter reason
    const textarea = screen.getByPlaceholderText('Reason for rejection (optional)');
    fireEvent.change(textarea, { target: { value: 'Invalid domain' } });

    // Click confirm reject
    const confirmButton = screen.getByText('Reject Request');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(registrationApi.rejectRegistrationRequest).toHaveBeenCalledWith(
        '1',
        'Invalid domain'
      );
    });
  });

  it('should close reject modal when cancel is clicked', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('user1@example.com')).toBeInTheDocument();
    });

    // Open reject modal
    const rejectButtons = screen.getAllByText('Reject');
    fireEvent.click(rejectButtons[0]);

    expect(screen.getByText('Reject Registration Request')).toBeInTheDocument();

    // Click cancel
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(screen.queryByText('Reject Registration Request')).not.toBeInTheDocument();
  });

  it('should toggle show all requests checkbox', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('user1@example.com')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Should fetch again with showAll=true
    await waitFor(() => {
      expect(registrationApi.getRegistrationRequests).toHaveBeenCalledWith(false);
    });
  });

  it('should display pending status badge', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      const statusBadges = screen.getAllByText('pending');
      expect(statusBadges.length).toBe(2);
    });
  });

  it('should render table headers', async () => {
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Submitted')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  it('should handle approve error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(registrationApi.getRegistrationRequests).mockResolvedValue({
      requests: mockRequests,
      total: 2,
    });
    vi.mocked(registrationApi.approveRegistrationRequest).mockRejectedValue(
      new Error('Approval failed')
    );

    render(<RegistrationRequests />);

    await waitFor(() => {
      expect(screen.getByText('user1@example.com')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByText('Approve');
    fireEvent.click(approveButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Failed to approve request')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});
