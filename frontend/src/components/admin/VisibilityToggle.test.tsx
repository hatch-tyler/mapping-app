import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisibilityToggle } from './VisibilityToggle';

describe('VisibilityToggle', () => {
  it('should render with visible state', () => {
    render(<VisibilityToggle visible={true} onChange={vi.fn()} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('should render with hidden state', () => {
    render(<VisibilityToggle visible={false} onChange={vi.fn()} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('should call onChange with false when visible is true', () => {
    const mockOnChange = vi.fn();
    render(<VisibilityToggle visible={true} onChange={mockOnChange} />);

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(mockOnChange).toHaveBeenCalledWith(false);
  });

  it('should call onChange with true when visible is false', () => {
    const mockOnChange = vi.fn();
    render(<VisibilityToggle visible={false} onChange={mockOnChange} />);

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(mockOnChange).toHaveBeenCalledWith(true);
  });

  it('should be disabled when disabled prop is true', () => {
    render(<VisibilityToggle visible={true} onChange={vi.fn()} disabled={true} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDisabled();
  });

  it('should not call onChange when disabled', () => {
    const mockOnChange = vi.fn();
    render(
      <VisibilityToggle visible={true} onChange={mockOnChange} disabled={true} />
    );

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('should have correct styling when visible', () => {
    render(<VisibilityToggle visible={true} onChange={vi.fn()} />);

    const toggle = screen.getByRole('switch');
    expect(toggle.className).toContain('bg-blue-600');
  });

  it('should have correct styling when not visible', () => {
    render(<VisibilityToggle visible={false} onChange={vi.fn()} />);

    const toggle = screen.getByRole('switch');
    expect(toggle.className).toContain('bg-gray-200');
  });

  it('should have disabled styling when disabled', () => {
    render(<VisibilityToggle visible={true} onChange={vi.fn()} disabled={true} />);

    const toggle = screen.getByRole('switch');
    expect(toggle.className).toContain('opacity-50');
    expect(toggle.className).toContain('cursor-not-allowed');
  });

  it('should have switch knob with correct position when visible', () => {
    const { container } = render(
      <VisibilityToggle visible={true} onChange={vi.fn()} />
    );

    const knob = container.querySelector('span.inline-block');
    expect(knob?.className).toContain('translate-x-6');
  });

  it('should have switch knob with correct position when not visible', () => {
    const { container } = render(
      <VisibilityToggle visible={false} onChange={vi.fn()} />
    );

    const knob = container.querySelector('span.inline-block');
    expect(knob?.className).toContain('translate-x-1');
  });
});
