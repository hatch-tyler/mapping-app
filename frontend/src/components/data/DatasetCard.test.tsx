import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatasetCard } from './DatasetCard';
import { createMockDataset } from '../../__tests__/mockData';

describe('DatasetCard', () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dataset name', () => {
    const dataset = createMockDataset({ name: 'Test Dataset' });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    expect(screen.getByText('Test Dataset')).toBeInTheDocument();
  });

  it('should render dataset description when present', () => {
    const dataset = createMockDataset({ description: 'Test description' });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('should not render description when not present', () => {
    const dataset = createMockDataset({ description: null });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    expect(screen.queryByText('Test description')).not.toBeInTheDocument();
  });

  it('should render data type badge', () => {
    const dataset = createMockDataset({ data_type: 'vector' });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    expect(screen.getByText('vector')).toBeInTheDocument();
  });

  it('should render feature count when available', () => {
    const dataset = createMockDataset({ feature_count: 1234 });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    expect(screen.getByText('1,234 features')).toBeInTheDocument();
  });

  it('should not render feature count when null', () => {
    const dataset = createMockDataset({ feature_count: null });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    expect(screen.queryByText(/features$/)).not.toBeInTheDocument();
  });

  it('should render Public badge when dataset is public', () => {
    const dataset = createMockDataset({ is_public: true });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  it('should not render Public badge when dataset is not public', () => {
    const dataset = createMockDataset({ is_public: false });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    expect(screen.queryByText('Public')).not.toBeInTheDocument();
  });

  it('should call onSelect when clicked', () => {
    const dataset = createMockDataset();
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(mockOnSelect).toHaveBeenCalledTimes(1);
  });

  it('should have selected styling when isSelected is true', () => {
    const dataset = createMockDataset();
    render(<DatasetCard dataset={dataset} isSelected={true} onSelect={mockOnSelect} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('border-blue-500');
    expect(button).toHaveClass('bg-blue-50');
  });

  it('should have default styling when isSelected is false', () => {
    const dataset = createMockDataset();
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('border-gray-200');
    expect(button).not.toHaveClass('border-blue-500');
  });

  it('should render raster icon for raster datasets', () => {
    const dataset = createMockDataset({ data_type: 'raster' });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    // Should render raster grid icon (multiple rect elements)
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('should render point icon for Point geometry', () => {
    const dataset = createMockDataset({ data_type: 'vector', geometry_type: 'Point' });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    // Should render point icon (circle element)
    const circles = document.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('should render polygon icon for Polygon geometry', () => {
    const dataset = createMockDataset({ data_type: 'vector', geometry_type: 'Polygon' });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    // Should render polygon icon
    const polygons = document.querySelectorAll('polygon');
    expect(polygons.length).toBeGreaterThan(0);
  });

  it('should render line icon for LineString geometry', () => {
    const dataset = createMockDataset({ data_type: 'vector', geometry_type: 'LineString' });
    render(<DatasetCard dataset={dataset} isSelected={false} onSelect={mockOnSelect} />);

    // Should render line icon (path element without fill)
    const paths = document.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });
});
