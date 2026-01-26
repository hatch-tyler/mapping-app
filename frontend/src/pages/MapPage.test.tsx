import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MapPage } from './MapPage';
import { useAuthStore } from '../stores/authStore';
import { useDatasetStore } from '../stores/datasetStore';
import { createMockUser } from '../__tests__/mockData';

// Mock child components
vi.mock('../components/map/MapContainer', () => ({
  MapContainer: () => <div data-testid="map-container">Map Container</div>,
}));

vi.mock('../components/map/LayerManager', () => ({
  LayerManager: () => <div data-testid="layer-manager">Layer Manager</div>,
}));

describe('MapPage', () => {
  const mockLogout = vi.fn();
  const mockFetchDatasets = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: createMockUser({ email: 'user@example.com', is_admin: false }),
      logout: mockLogout,
    });
    useDatasetStore.setState({
      fetchDatasets: mockFetchDatasets,
    });
  });

  const renderMapPage = () => {
    return render(
      <MemoryRouter>
        <MapPage />
      </MemoryRouter>
    );
  };

  it('should render header with GIS Application title', () => {
    renderMapPage();

    expect(screen.getByText('GIS Application')).toBeInTheDocument();
  });

  it('should render Data Browser link', () => {
    renderMapPage();

    expect(screen.getByText('Data Browser')).toBeInTheDocument();
  });

  it('should render user email', () => {
    renderMapPage();

    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('should render Logout button', () => {
    renderMapPage();

    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('should call logout when Logout button clicked', () => {
    renderMapPage();

    fireEvent.click(screen.getByText('Logout'));

    expect(mockLogout).toHaveBeenCalled();
  });

  it('should render MapContainer', () => {
    renderMapPage();

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('should render LayerManager', () => {
    renderMapPage();

    expect(screen.getByTestId('layer-manager')).toBeInTheDocument();
  });

  it('should call fetchDatasets on mount', () => {
    renderMapPage();

    expect(mockFetchDatasets).toHaveBeenCalled();
  });

  it('should render Admin Dashboard link for admin users', () => {
    useAuthStore.setState({
      user: createMockUser({ email: 'admin@example.com', is_admin: true }),
      logout: mockLogout,
    });

    renderMapPage();

    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
  });

  it('should not render Admin Dashboard link for non-admin users', () => {
    useAuthStore.setState({
      user: createMockUser({ email: 'user@example.com', is_admin: false }),
      logout: mockLogout,
    });

    renderMapPage();

    expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
  });
});
