import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayerManager } from './LayerManager';
import { useDatasetStore } from '../../stores/datasetStore';
import { useMapStore } from '../../stores/mapStore';
import { createMockDataset } from '../../__tests__/mockData';

describe('LayerManager', () => {
  const mockToggleDatasetVisibility = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useDatasetStore.setState({
      datasets: [],
    });
    useMapStore.setState({
      visibleDatasets: new Set<string>(),
      toggleDatasetVisibility: mockToggleDatasetVisibility,
    });
  });

  it('should render Layers header', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: '1', name: 'Test', is_visible: true })],
    });
    render(<LayerManager />);
    expect(screen.getByText('Layers')).toBeInTheDocument();
  });

  it('should show "No layers available" when no visible datasets', () => {
    useDatasetStore.setState({
      datasets: [],
    });
    render(<LayerManager />);
    expect(screen.getByText('No layers available')).toBeInTheDocument();
  });

  it('should show "No layers available" when all datasets are not visible', () => {
    useDatasetStore.setState({
      datasets: [
        createMockDataset({ id: '1', name: 'Hidden Dataset', is_visible: false }),
      ],
    });
    render(<LayerManager />);
    expect(screen.getByText('No layers available')).toBeInTheDocument();
  });

  it('should render visible datasets', () => {
    useDatasetStore.setState({
      datasets: [
        createMockDataset({ id: '1', name: 'Dataset 1', is_visible: true }),
        createMockDataset({ id: '2', name: 'Dataset 2', is_visible: true }),
      ],
    });
    render(<LayerManager />);
    expect(screen.getByText('Dataset 1')).toBeInTheDocument();
    expect(screen.getByText('Dataset 2')).toBeInTheDocument();
  });

  it('should filter out non-visible datasets', () => {
    useDatasetStore.setState({
      datasets: [
        createMockDataset({ id: '1', name: 'Visible Dataset', is_visible: true }),
        createMockDataset({ id: '2', name: 'Hidden Dataset', is_visible: false }),
      ],
    });
    render(<LayerManager />);
    expect(screen.getByText('Visible Dataset')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Dataset')).not.toBeInTheDocument();
  });

  it('should render checkbox for each dataset', () => {
    useDatasetStore.setState({
      datasets: [
        createMockDataset({ id: '1', name: 'Dataset 1', is_visible: true }),
        createMockDataset({ id: '2', name: 'Dataset 2', is_visible: true }),
      ],
    });
    render(<LayerManager />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
  });

  it('should check checkbox when dataset is in visibleDatasets', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: '1', name: 'Dataset 1', is_visible: true })],
    });
    useMapStore.setState({
      visibleDatasets: new Set(['1']),
      toggleDatasetVisibility: mockToggleDatasetVisibility,
    });
    render(<LayerManager />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('should not check checkbox when dataset is not in visibleDatasets', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: '1', name: 'Dataset 1', is_visible: true })],
    });
    useMapStore.setState({
      visibleDatasets: new Set<string>(),
      toggleDatasetVisibility: mockToggleDatasetVisibility,
    });
    render(<LayerManager />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  it('should call toggleDatasetVisibility when checkbox clicked', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: '1', name: 'Dataset 1', is_visible: true })],
    });
    render(<LayerManager />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(mockToggleDatasetVisibility).toHaveBeenCalledWith('1');
  });

  it('should display data type badge for vector dataset', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: '1', name: 'Vector Dataset', is_visible: true, data_type: 'vector' })],
    });
    render(<LayerManager />);
    expect(screen.getByText('vector')).toBeInTheDocument();
  });

  it('should display data type badge for raster dataset', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: '1', name: 'Raster Dataset', is_visible: true, data_type: 'raster' })],
    });
    render(<LayerManager />);
    expect(screen.getByText('raster')).toBeInTheDocument();
  });

  it('should have correct checkbox ID with dataset ID', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: 'dataset-123', name: 'Test', is_visible: true })],
    });
    render(<LayerManager />);
    const checkbox = document.getElementById('layer-dataset-123');
    expect(checkbox).toBeInTheDocument();
  });

  it('should have label associated with checkbox', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: '1', name: 'Test Dataset', is_visible: true })],
    });
    render(<LayerManager />);
    const label = screen.getByText('Test Dataset');
    expect(label.closest('label')).toHaveAttribute('for', 'layer-1');
  });
});
