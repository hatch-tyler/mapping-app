import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FeatureTable } from './FeatureTable';
import { createMockDataset, createMockFieldMetadataResponse, createMockFeatureQueryResponse } from '../../__tests__/mockData';
import * as datasetsApi from '../../api/datasets';

// Mock the datasets API
vi.mock('../../api/datasets', () => ({
  getDatasetFields: vi.fn(),
  queryFeatures: vi.fn(),
}));

// Mock child components to simplify testing
vi.mock('./TableToolbar', () => ({
  TableToolbar: ({ totalCount }: { totalCount: number }) => (
    <div data-testid="table-toolbar">Total: {totalCount}</div>
  ),
}));

vi.mock('./TablePagination', () => ({
  TablePagination: ({ totalPages, totalCount }: { totalPages: number; totalCount: number }) => (
    <div data-testid="table-pagination">
      Pages: {totalPages}, Count: {totalCount}
    </div>
  ),
}));

describe('FeatureTable', () => {
  const mockDataset = createMockDataset({
    id: 'dataset-123',
    name: 'Test Dataset',
  });

  const mockFields = createMockFieldMetadataResponse({
    dataset_id: 'dataset-123',
    fields: [
      { name: 'name', field_type: 'string' },
      { name: 'value', field_type: 'number' },
      { name: 'active', field_type: 'boolean' },
    ],
  });

  const mockFeatures = createMockFeatureQueryResponse({
    features: [
      { id: 1, properties: { name: 'Feature 1', value: 100, active: true } },
      { id: 2, properties: { name: 'Feature 2', value: 200, active: false } },
      { id: 3, properties: { name: 'Feature 3', value: null, active: null } },
    ],
    total_count: 3,
    page: 1,
    page_size: 100,
    total_pages: 1,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state initially', () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<FeatureTable dataset={mockDataset} />);

    expect(screen.getByText('Loading features...')).toBeInTheDocument();
  });

  it('should display features after loading', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Feature 1')).toBeInTheDocument();
      expect(screen.getByText('Feature 2')).toBeInTheDocument();
      expect(screen.getByText('Feature 3')).toBeInTheDocument();
    });
  });

  it('should display column headers from field metadata', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(screen.getByText('name')).toBeInTheDocument();
      expect(screen.getByText('value')).toBeInTheDocument();
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });

  it('should display ID column', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(screen.getByText('ID')).toBeInTheDocument();
    });
  });

  it('should display boolean values as Yes/No', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Yes')).toBeInTheDocument();
      expect(screen.getByText('No')).toBeInTheDocument();
    });
  });

  it('should display null values as dash', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      // Look for dash placeholders for null values
      const dashes = screen.getAllByText('-');
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  it('should show error state when loading fails', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockRejectedValue(new Error('Network error'));

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load features')).toBeInTheDocument();
      expect(screen.getByText('Try again')).toBeInTheDocument();
    });
  });

  it('should show empty state when no features', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(
      createMockFeatureQueryResponse({
        features: [],
        total_count: 0,
        page: 1,
        page_size: 100,
        total_pages: 0,
      })
    );

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(screen.getByText('No features found')).toBeInTheDocument();
    });
  });

  it('should render TableToolbar with correct props', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-toolbar')).toBeInTheDocument();
      expect(screen.getByText('Total: 3')).toBeInTheDocument();
    });
  });

  it('should render TablePagination with correct props', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-pagination')).toBeInTheDocument();
      expect(screen.getByText('Pages: 1, Count: 3')).toBeInTheDocument();
    });
  });

  it('should call queryFeatures with correct pagination params', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(datasetsApi.queryFeatures).toHaveBeenCalledWith(
        'dataset-123',
        1, // page (pageIndex + 1)
        100, // pageSize
        undefined, // sortField
        undefined, // sortOrder
        undefined // filters
      );
    });
  });

  it('should fetch fields when dataset changes', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(datasetsApi.getDatasetFields).toHaveBeenCalledWith('dataset-123');
    });
  });

  it('should handle field loading error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(datasetsApi.getDatasetFields).mockRejectedValue(new Error('Field error'));
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  it('should render row checkboxes for selection', async () => {
    vi.mocked(datasetsApi.getDatasetFields).mockResolvedValue(mockFields);
    vi.mocked(datasetsApi.queryFeatures).mockResolvedValue(mockFeatures);

    render(<FeatureTable dataset={mockDataset} />);

    await waitFor(() => {
      // Should have checkboxes for each row plus header checkbox
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThanOrEqual(4); // 3 rows + 1 header
    });
  });
});
