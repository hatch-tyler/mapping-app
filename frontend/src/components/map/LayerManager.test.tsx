import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LayerManager } from './LayerManager';
import { useDatasetStore } from '../../stores/datasetStore';
import { useMapStore } from '../../stores/mapStore';
import { useAuthStore } from '../../stores/authStore';
import { createMockDataset, createMockUser } from '../../__tests__/mockData';
import * as datasetsApi from '../../api/datasets';

vi.mock('../../api/datasets', async () => {
  const actual = await vi.importActual<typeof datasetsApi>('../../api/datasets');
  return {
    ...actual,
    updateDataset: vi.fn(),
  };
});

describe('LayerManager', () => {
  const mockToggleDatasetVisibility = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Pre-expand the Reference section so test datasets (no project_id) are visible.
    localStorage.setItem('layer-panel:expanded', JSON.stringify(['_reference']));
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
    expect(screen.getByText('vec')).toBeInTheDocument();
  });

  it('should display data type badge for raster dataset', () => {
    useDatasetStore.setState({
      datasets: [createMockDataset({ id: '1', name: 'Raster Dataset', is_visible: true, data_type: 'raster' })],
    });
    render(<LayerManager />);
    expect(screen.getByText('rst')).toBeInTheDocument();
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

describe('LayerManager — style edit gating across roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('layer-panel:expanded', JSON.stringify(['_reference']));
    useDatasetStore.setState({
      datasets: [
        createMockDataset({
          id: 'd1',
          name: 'Dataset 1',
          is_visible: true,
          data_type: 'vector',
        }),
      ],
    });
    useMapStore.setState({
      visibleDatasets: new Set<string>(),
      toggleDatasetVisibility: vi.fn(),
    });
  });

  it('shows the pencil icon for an unauthenticated visitor', () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });
    render(<LayerManager />);
    expect(
      screen.getByRole('button', { name: /Customize layer style/i }),
    ).toBeInTheDocument();
  });

  it('shows the pencil icon for a viewer (was previously hidden)', () => {
    useAuthStore.setState({
      user: createMockUser({ role: 'viewer', is_admin: false }),
      isAuthenticated: true,
    });
    render(<LayerManager />);
    expect(
      screen.getByRole('button', { name: /Customize layer style/i }),
    ).toBeInTheDocument();
  });

  it('shows the pencil icon for an editor', () => {
    useAuthStore.setState({
      user: createMockUser({ role: 'editor', is_admin: false }),
      isAuthenticated: true,
    });
    render(<LayerManager />);
    expect(
      screen.getByRole('button', { name: /Edit layer style/i }),
    ).toBeInTheDocument();
  });

  it('viewer sees only Apply (no Save) when opening the editor', () => {
    useAuthStore.setState({
      user: createMockUser({ role: 'viewer', is_admin: false }),
      isAuthenticated: true,
    });
    render(<LayerManager />);
    fireEvent.click(
      screen.getByRole('button', { name: /Customize layer style/i }),
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Save for everyone/i }),
    ).not.toBeInTheDocument();
  });

  it('editor sees both Apply and Save', () => {
    useAuthStore.setState({
      user: createMockUser({ role: 'editor', is_admin: false }),
      isAuthenticated: true,
    });
    render(<LayerManager />);
    fireEvent.click(screen.getByRole('button', { name: /Edit layer style/i }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Save for everyone/i }),
    ).toBeInTheDocument();
  });

  it('viewer Apply does not call updateDataset API', () => {
    useAuthStore.setState({
      user: createMockUser({ role: 'viewer', is_admin: false }),
      isAuthenticated: true,
    });
    render(<LayerManager />);
    fireEvent.click(
      screen.getByRole('button', { name: /Customize layer style/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(datasetsApi.updateDataset).not.toHaveBeenCalled();
  });

  it('editor Save calls updateDataset API once', async () => {
    vi.mocked(datasetsApi.updateDataset).mockResolvedValue(
      createMockDataset({ id: 'd1' }),
    );
    useAuthStore.setState({
      user: createMockUser({ role: 'editor', is_admin: false }),
      isAuthenticated: true,
    });
    render(<LayerManager />);
    fireEvent.click(screen.getByRole('button', { name: /Edit layer style/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /Save for everyone/i }),
    );
    await waitFor(() =>
      expect(datasetsApi.updateDataset).toHaveBeenCalledTimes(1),
    );
    expect(datasetsApi.updateDataset).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        style_config: expect.objectContaining({ mode: 'uniform' }),
      }),
    );
  });
});
