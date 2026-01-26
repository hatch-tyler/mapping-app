import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DatasetList } from './DatasetList';
import { createMockDataset } from '../../__tests__/mockData';
import * as datasetsApi from '../../api/datasets';

// Mock the datasets API
vi.mock('../../api/datasets', () => ({
  getBrowsableDatasets: vi.fn(),
}));

const mockVectorDatasets = [
  createMockDataset({
    id: '1',
    name: 'Vector Dataset 1',
    description: 'First vector dataset',
    data_type: 'vector',
    geometry_type: 'Point',
  }),
  createMockDataset({
    id: '2',
    name: 'Vector Dataset 2',
    description: 'Second vector dataset',
    data_type: 'vector',
    geometry_type: 'Polygon',
  }),
];

const mockRasterDataset = createMockDataset({
  id: '3',
  name: 'Raster Dataset',
  description: 'A raster dataset',
  data_type: 'raster',
  geometry_type: null,
});

describe('DatasetList', () => {
  const mockOnSelectDataset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state initially', () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    // Should show loading spinner
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should render datasets after loading', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: mockVectorDatasets,
      total: 2,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Vector Dataset 1')).toBeInTheDocument();
      expect(screen.getByText('Vector Dataset 2')).toBeInTheDocument();
    });
  });

  it('should only show vector datasets', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: [...mockVectorDatasets, mockRasterDataset],
      total: 3,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Vector Dataset 1')).toBeInTheDocument();
      expect(screen.getByText('Vector Dataset 2')).toBeInTheDocument();
      expect(screen.queryByText('Raster Dataset')).not.toBeInTheDocument();
    });
  });

  it('should show error state when loading fails', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockRejectedValue(new Error('Network error'));

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load datasets')).toBeInTheDocument();
      expect(screen.getByText('Try again')).toBeInTheDocument();
    });
  });

  it('should show empty state when no datasets', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: [],
      total: 0,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('No datasets available')).toBeInTheDocument();
    });
  });

  it('should filter datasets by search query', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: mockVectorDatasets,
      total: 2,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Vector Dataset 1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search datasets...');
    fireEvent.change(searchInput, { target: { value: 'Dataset 1' } });

    expect(screen.getByText('Vector Dataset 1')).toBeInTheDocument();
    expect(screen.queryByText('Vector Dataset 2')).not.toBeInTheDocument();
  });

  it('should show message when search has no results', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: mockVectorDatasets,
      total: 2,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Vector Dataset 1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search datasets...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.getByText('No datasets match your search')).toBeInTheDocument();
  });

  it('should search by description as well', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: mockVectorDatasets,
      total: 2,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Vector Dataset 1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search datasets...');
    fireEvent.change(searchInput, { target: { value: 'Second' } });

    expect(screen.queryByText('Vector Dataset 1')).not.toBeInTheDocument();
    expect(screen.getByText('Vector Dataset 2')).toBeInTheDocument();
  });

  it('should call onSelectDataset when a dataset card is clicked', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: mockVectorDatasets,
      total: 2,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Vector Dataset 1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Vector Dataset 1'));

    expect(mockOnSelectDataset).toHaveBeenCalledWith(mockVectorDatasets[0]);
  });

  it('should show dataset count in footer', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: mockVectorDatasets,
      total: 2,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('2 datasets available')).toBeInTheDocument();
    });
  });

  it('should show singular "dataset" when only one', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: [mockVectorDatasets[0]],
      total: 1,
    });

    render(<DatasetList selectedDataset={null} onSelectDataset={mockOnSelectDataset} />);

    await waitFor(() => {
      expect(screen.getByText('1 dataset available')).toBeInTheDocument();
    });
  });

  it('should highlight selected dataset', async () => {
    vi.mocked(datasetsApi.getBrowsableDatasets).mockResolvedValue({
      datasets: mockVectorDatasets,
      total: 2,
    });

    render(
      <DatasetList
        selectedDataset={mockVectorDatasets[0]}
        onSelectDataset={mockOnSelectDataset}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Vector Dataset 1')).toBeInTheDocument();
    });

    // The selected dataset should have the selected styling
    const buttons = screen.getAllByRole('button');
    const selectedButton = buttons.find((btn) =>
      btn.textContent?.includes('Vector Dataset 1')
    );
    expect(selectedButton).toHaveClass('border-blue-500');
  });
});
