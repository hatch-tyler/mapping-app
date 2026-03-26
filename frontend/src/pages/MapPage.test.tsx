import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MapPage } from './MapPage';
import { useAuthStore } from '../stores/authStore';
import { useDatasetStore } from '../stores/datasetStore';
import { createMockUser } from '../__tests__/mockData';

// Mock child components
vi.mock('../components/layout/Navbar', () => ({
  Navbar: () => <nav data-testid="navbar">Navbar</nav>,
}));

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

  it('should render Navbar', () => {
    renderMapPage();

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
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

  it('should render Navbar for admin users', () => {
    useAuthStore.setState({
      user: createMockUser({ email: 'admin@example.com', is_admin: true }),
      logout: mockLogout,
    });

    renderMapPage();

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });
});
