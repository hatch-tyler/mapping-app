import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from './AdminPage';
import { useDatasetStore } from '../stores/datasetStore';
import { useAuthStore } from '../stores/authStore';
import * as datasetsApi from '../api/datasets';
import { createMockDataset, createMockUser } from '../__tests__/mockData';

// Mock child components
vi.mock('../components/admin/DatasetTable', () => ({
  DatasetTable: ({
    datasets,
    onToggleVisibility,
    onTogglePublic,
    onDelete,
  }: {
    datasets: unknown[];
    onToggleVisibility: (id: string, visible: boolean) => void;
    onTogglePublic: (id: string, isPublic: boolean) => void;
    onDelete: (id: string) => void;
  }) => (
    <div data-testid="dataset-table">
      <div>Dataset count: {datasets.length}</div>
      <button onClick={() => onToggleVisibility('1', true)}>Toggle Visibility</button>
      <button onClick={() => onTogglePublic('1', true)}>Toggle Public</button>
      <button onClick={() => onDelete('1')}>Delete Dataset</button>
    </div>
  ),
}));

vi.mock('../components/admin/UploadForm', () => ({
  UploadForm: ({ onSuccess }: { onSuccess: () => void }) => (
    <div data-testid="upload-form">
      <button onClick={onSuccess}>Upload Success</button>
    </div>
  ),
}));

vi.mock('../components/admin/RegistrationRequests', () => ({
  RegistrationRequests: () => (
    <div data-testid="registration-requests">Registration Requests Component</div>
  ),
}));

vi.mock('../api/datasets', () => ({
  toggleVisibility: vi.fn(),
  togglePublicStatus: vi.fn(),
  deleteDataset: vi.fn(),
}));

describe('AdminPage', () => {
  const mockDatasets = [
    createMockDataset({ id: '1', name: 'Dataset 1' }),
    createMockDataset({ id: '2', name: 'Dataset 2' }),
  ];
  const mockFetchDatasets = vi.fn();
  const mockUpdateDataset = vi.fn();
  const mockRemoveDataset = vi.fn();
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useDatasetStore.setState({
      datasets: mockDatasets,
      loading: false,
      error: null,
      fetchDatasets: mockFetchDatasets,
      updateDataset: mockUpdateDataset,
      removeDataset: mockRemoveDataset,
    });
    useAuthStore.setState({
      user: createMockUser({ email: 'admin@example.com', is_admin: true }),
      logout: mockLogout,
    });
  });

  const renderAdminPage = () => {
    return render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );
  };

  it('should render Admin Dashboard header', () => {
    renderAdminPage();
    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
  });

  it('should render Back to Map link', () => {
    renderAdminPage();
    expect(screen.getByText('Back to Map')).toBeInTheDocument();
  });

  it('should render user email', () => {
    renderAdminPage();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
  });

  it('should call logout when Logout button clicked', () => {
    renderAdminPage();
    fireEvent.click(screen.getByText('Logout'));
    expect(mockLogout).toHaveBeenCalled();
  });

  it('should call fetchDatasets on mount', () => {
    renderAdminPage();
    expect(mockFetchDatasets).toHaveBeenCalled();
  });

  it('should render Datasets tab by default', () => {
    renderAdminPage();
    expect(screen.getByTestId('dataset-table')).toBeInTheDocument();
    expect(screen.getByTestId('upload-form')).toBeInTheDocument();
  });

  it('should show datasets count', () => {
    renderAdminPage();
    expect(screen.getByText('Datasets (2)')).toBeInTheDocument();
  });

  it('should switch to Registration Requests tab when clicked', () => {
    renderAdminPage();
    fireEvent.click(screen.getByText('Registration Requests'));
    expect(screen.getByTestId('registration-requests')).toBeInTheDocument();
    expect(screen.queryByTestId('dataset-table')).not.toBeInTheDocument();
  });

  it('should switch back to Datasets tab', () => {
    renderAdminPage();
    fireEvent.click(screen.getByText('Registration Requests'));
    fireEvent.click(screen.getByText('Datasets'));
    expect(screen.getByTestId('dataset-table')).toBeInTheDocument();
  });

  it('should show loading spinner when loading', () => {
    useDatasetStore.setState({
      datasets: [],
      loading: true,
      error: null,
      fetchDatasets: mockFetchDatasets,
      updateDataset: mockUpdateDataset,
      removeDataset: mockRemoveDataset,
    });
    renderAdminPage();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should show error message when error occurs', () => {
    useDatasetStore.setState({
      datasets: [],
      loading: false,
      error: 'Failed to load datasets',
      fetchDatasets: mockFetchDatasets,
      updateDataset: mockUpdateDataset,
      removeDataset: mockRemoveDataset,
    });
    renderAdminPage();
    expect(screen.getByText('Failed to load datasets')).toBeInTheDocument();
  });

  it('should call toggleVisibility API and update store', async () => {
    const updatedDataset = createMockDataset({ id: '1', name: 'Dataset 1', is_visible: true });
    vi.mocked(datasetsApi.toggleVisibility).mockResolvedValue(updatedDataset);
    renderAdminPage();

    fireEvent.click(screen.getByText('Toggle Visibility'));

    await waitFor(() => {
      expect(datasetsApi.toggleVisibility).toHaveBeenCalledWith('1', true);
      expect(mockUpdateDataset).toHaveBeenCalledWith('1', updatedDataset);
    });
  });

  it('should handle toggleVisibility error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(datasetsApi.toggleVisibility).mockRejectedValue(new Error('API error'));
    renderAdminPage();

    fireEvent.click(screen.getByText('Toggle Visibility'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });

  it('should call togglePublicStatus API and update store', async () => {
    const updatedDataset = createMockDataset({ id: '1', name: 'Dataset 1', is_public: true });
    vi.mocked(datasetsApi.togglePublicStatus).mockResolvedValue(updatedDataset);
    renderAdminPage();

    fireEvent.click(screen.getByText('Toggle Public'));

    await waitFor(() => {
      expect(datasetsApi.togglePublicStatus).toHaveBeenCalledWith('1', true);
      expect(mockUpdateDataset).toHaveBeenCalledWith('1', updatedDataset);
    });
  });

  it('should handle togglePublicStatus error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(datasetsApi.togglePublicStatus).mockRejectedValue(new Error('API error'));
    renderAdminPage();

    fireEvent.click(screen.getByText('Toggle Public'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });

  it('should call deleteDataset API and remove from store', async () => {
    vi.mocked(datasetsApi.deleteDataset).mockResolvedValue(undefined);
    renderAdminPage();

    fireEvent.click(screen.getByText('Delete Dataset'));

    await waitFor(() => {
      expect(datasetsApi.deleteDataset).toHaveBeenCalledWith('1');
      expect(mockRemoveDataset).toHaveBeenCalledWith('1');
    });
  });

  it('should handle deleteDataset error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(datasetsApi.deleteDataset).mockRejectedValue(new Error('API error'));
    renderAdminPage();

    fireEvent.click(screen.getByText('Delete Dataset'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });

  it('should call fetchDatasets when upload succeeds', () => {
    renderAdminPage();
    fireEvent.click(screen.getByText('Upload Success'));
    expect(mockFetchDatasets).toHaveBeenCalledTimes(2); // Once on mount, once on success
  });
});
