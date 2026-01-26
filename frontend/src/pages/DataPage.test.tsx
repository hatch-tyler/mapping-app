import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataPage } from './DataPage';
import { useAuthStore } from '../stores/authStore';
import { createMockDataset, createMockUser } from '../__tests__/mockData';

// Mock child components
vi.mock('../components/data/DatasetList', () => ({
  DatasetList: ({ selectedDataset, onSelectDataset }: {
    selectedDataset: unknown;
    onSelectDataset: (dataset: unknown) => void;
  }) => (
    <div data-testid="dataset-list">
      <button onClick={() => onSelectDataset(createMockDataset({ id: '1', name: 'Test Dataset' }))}>
        Select Dataset
      </button>
      {selectedDataset ? 'Has selection' : 'No selection'}
    </div>
  ),
}));

vi.mock('../components/data/FeatureTable', () => ({
  FeatureTable: ({ dataset }: { dataset: { name: string } }) => (
    <div data-testid="feature-table">Feature Table: {dataset.name}</div>
  ),
}));

vi.mock('../components/data/ServiceUrlsPanel', () => ({
  ServiceUrlsPanel: ({ dataset }: { dataset: { name: string } }) => (
    <div data-testid="service-urls-panel">Service URLs: {dataset.name}</div>
  ),
}));

describe('DataPage', () => {
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      logout: mockLogout,
    });
  });

  const renderDataPage = () => {
    return render(
      <MemoryRouter>
        <DataPage />
      </MemoryRouter>
    );
  };

  it('should render header with Data Browser title', () => {
    renderDataPage();

    expect(screen.getByText('Data Browser')).toBeInTheDocument();
  });

  it('should render Back to Map link', () => {
    renderDataPage();

    expect(screen.getByText('Back to Map')).toBeInTheDocument();
  });

  it('should render Login link when not authenticated', () => {
    renderDataPage();

    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('should render user email and logout when authenticated', () => {
    useAuthStore.setState({
      user: createMockUser({ email: 'user@example.com', is_admin: false }),
      logout: mockLogout,
    });

    renderDataPage();

    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
  });

  it('should render Admin Dashboard link for admin users', () => {
    useAuthStore.setState({
      user: createMockUser({ email: 'admin@example.com', is_admin: true }),
      logout: mockLogout,
    });

    renderDataPage();

    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
  });

  it('should not render Admin Dashboard link for non-admin users', () => {
    useAuthStore.setState({
      user: createMockUser({ email: 'user@example.com', is_admin: false }),
      logout: mockLogout,
    });

    renderDataPage();

    expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
  });

  it('should call logout when logout button clicked', () => {
    useAuthStore.setState({
      user: createMockUser({ email: 'user@example.com', is_admin: false }),
      logout: mockLogout,
    });

    renderDataPage();

    fireEvent.click(screen.getByText('Logout'));

    expect(mockLogout).toHaveBeenCalled();
  });

  it('should render DatasetList component', () => {
    renderDataPage();

    expect(screen.getByTestId('dataset-list')).toBeInTheDocument();
  });

  it('should show empty state when no dataset selected', () => {
    renderDataPage();

    expect(screen.getByText('Select a Dataset')).toBeInTheDocument();
    expect(screen.getByText('Choose a dataset from the list to view its features')).toBeInTheDocument();
  });

  it('should show FeatureTable when dataset is selected', () => {
    renderDataPage();

    // Select a dataset
    fireEvent.click(screen.getByText('Select Dataset'));

    expect(screen.getByTestId('feature-table')).toBeInTheDocument();
    expect(screen.getByText('Feature Table: Test Dataset')).toBeInTheDocument();
  });

  it('should show dataset name header when dataset is selected', () => {
    renderDataPage();

    fireEvent.click(screen.getByText('Select Dataset'));

    expect(screen.getByText('Test Dataset')).toBeInTheDocument();
  });

  it('should show ServiceUrlsPanel when dataset is selected', () => {
    renderDataPage();

    fireEvent.click(screen.getByText('Select Dataset'));

    expect(screen.getByTestId('service-urls-panel')).toBeInTheDocument();
  });

  it('should have Service URLs toggle button', () => {
    renderDataPage();

    fireEvent.click(screen.getByText('Select Dataset'));

    expect(screen.getByText('Service URLs')).toBeInTheDocument();
  });

  it('should toggle ServiceUrlsPanel visibility when toggle clicked', () => {
    renderDataPage();

    fireEvent.click(screen.getByText('Select Dataset'));
    expect(screen.getByTestId('service-urls-panel')).toBeInTheDocument();

    // Toggle off
    fireEvent.click(screen.getByText('Service URLs'));
    expect(screen.queryByTestId('service-urls-panel')).not.toBeInTheDocument();

    // Toggle on
    fireEvent.click(screen.getByText('Service URLs'));
    expect(screen.getByTestId('service-urls-panel')).toBeInTheDocument();
  });
});
