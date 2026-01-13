import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BasemapGallery } from './BasemapGallery';
import { useMapStore, AVAILABLE_BASEMAPS } from '../../stores/mapStore';

describe('BasemapGallery', () => {
  beforeEach(() => {
    // Reset store state before each test
    useMapStore.setState({
      currentBasemap: AVAILABLE_BASEMAPS[0],
      isBasemapGalleryOpen: false,
    });
  });

  describe('toggle button', () => {
    it('should render toggle button', () => {
      render(<BasemapGallery />);

      const button = screen.getByRole('button', { name: /open basemap gallery/i });
      expect(button).toBeInTheDocument();
    });

    it('should open gallery when toggle button is clicked', () => {
      render(<BasemapGallery />);

      const button = screen.getByRole('button', { name: /open basemap gallery/i });
      fireEvent.click(button);

      expect(screen.getByText('Basemap Gallery')).toBeInTheDocument();
    });

    it('should close gallery when toggle button is clicked while open', () => {
      useMapStore.setState({ isBasemapGalleryOpen: true });
      render(<BasemapGallery />);

      expect(screen.getByText('Basemap Gallery')).toBeInTheDocument();

      const button = screen.getByRole('button', { name: /open basemap gallery/i });
      fireEvent.click(button);

      expect(screen.queryByText('Basemap Gallery')).not.toBeInTheDocument();
    });
  });

  describe('gallery panel', () => {
    beforeEach(() => {
      useMapStore.setState({ isBasemapGalleryOpen: true });
    });

    it('should display all available basemaps', () => {
      render(<BasemapGallery />);

      AVAILABLE_BASEMAPS.forEach((basemap) => {
        expect(screen.getByText(basemap.name)).toBeInTheDocument();
      });
    });

    it('should highlight the currently selected basemap', () => {
      render(<BasemapGallery />);

      const selectedButton = screen.getByRole('button', { pressed: true });
      expect(selectedButton).toBeInTheDocument();
      expect(selectedButton).toHaveTextContent(AVAILABLE_BASEMAPS[0].name);
    });

    it('should change basemap when a basemap is clicked', () => {
      render(<BasemapGallery />);

      const darkMatterButton = screen.getByText('Dark Matter').closest('button');
      fireEvent.click(darkMatterButton!);

      const state = useMapStore.getState();
      expect(state.currentBasemap.id).toBe('dark-matter');
    });

    it('should close gallery when a basemap is selected', () => {
      render(<BasemapGallery />);

      const voyagerButton = screen.getByText('Voyager').closest('button');
      fireEvent.click(voyagerButton!);

      expect(screen.queryByText('Basemap Gallery')).not.toBeInTheDocument();
    });

    it('should close gallery when close button is clicked', () => {
      render(<BasemapGallery />);

      const closeButton = screen.getByRole('button', { name: /close basemap gallery/i });
      fireEvent.click(closeButton);

      expect(screen.queryByText('Basemap Gallery')).not.toBeInTheDocument();
    });
  });

  describe('keyboard interaction', () => {
    it('should close gallery when Escape key is pressed', () => {
      useMapStore.setState({ isBasemapGalleryOpen: true });
      render(<BasemapGallery />);

      expect(screen.getByText('Basemap Gallery')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByText('Basemap Gallery')).not.toBeInTheDocument();
    });
  });

  describe('click outside', () => {
    it('should close gallery when clicking outside', () => {
      useMapStore.setState({ isBasemapGalleryOpen: true });
      const { container } = render(
        <div>
          <div data-testid="outside">Outside</div>
          <BasemapGallery />
        </div>
      );

      expect(screen.getByText('Basemap Gallery')).toBeInTheDocument();

      const outsideElement = screen.getByTestId('outside');
      fireEvent.mouseDown(outsideElement);

      expect(screen.queryByText('Basemap Gallery')).not.toBeInTheDocument();
    });
  });

  describe('basemap thumbnails', () => {
    it('should render thumbnail images for each basemap', () => {
      useMapStore.setState({ isBasemapGalleryOpen: true });
      render(<BasemapGallery />);

      const images = screen.getAllByRole('img');
      expect(images.length).toBe(AVAILABLE_BASEMAPS.length);
    });

    it('should have fallback for failed thumbnail images', () => {
      useMapStore.setState({ isBasemapGalleryOpen: true });
      render(<BasemapGallery />);

      const images = screen.getAllByRole('img');
      const firstImage = images[0] as HTMLImageElement;

      // Trigger error handler
      fireEvent.error(firstImage);

      // Should have a data URI as fallback
      expect(firstImage.src).toContain('data:image/svg+xml');
    });
  });
});
