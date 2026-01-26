import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ServiceUrlCard } from './ServiceUrlCard';

describe('ServiceUrlCard', () => {
  const mockUrl = 'https://example.com/api/dataset/123';
  const mockLabel = 'API URL';
  const mockDescription = 'Use this URL to access the data';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('should render label and URL', () => {
    render(<ServiceUrlCard label={mockLabel} url={mockUrl} />);

    expect(screen.getByText(mockLabel)).toBeInTheDocument();
    expect(screen.getByDisplayValue(mockUrl)).toBeInTheDocument();
  });

  it('should render description when provided', () => {
    render(
      <ServiceUrlCard label={mockLabel} url={mockUrl} description={mockDescription} />
    );

    expect(screen.getByText(mockDescription)).toBeInTheDocument();
  });

  it('should not render description when not provided', () => {
    render(<ServiceUrlCard label={mockLabel} url={mockUrl} />);

    expect(screen.queryByText(mockDescription)).not.toBeInTheDocument();
  });

  it('should render Copy button', () => {
    render(<ServiceUrlCard label={mockLabel} url={mockUrl} />);

    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('should copy URL to clipboard when Copy button is clicked', async () => {
    render(<ServiceUrlCard label={mockLabel} url={mockUrl} />);

    const copyButton = screen.getByText('Copy');
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockUrl);
  });

  it('should show "Copied!" after clicking Copy', async () => {
    render(<ServiceUrlCard label={mockLabel} url={mockUrl} />);

    const copyButton = screen.getByText('Copy');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('should have readonly input field', () => {
    render(<ServiceUrlCard label={mockLabel} url={mockUrl} />);

    const input = screen.getByDisplayValue(mockUrl);
    expect(input).toHaveAttribute('readonly');
  });

  it('should handle clipboard error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Clipboard error')),
      },
    });

    render(<ServiceUrlCard label={mockLabel} url={mockUrl} />);

    const copyButton = screen.getByText('Copy');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });
});
