import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BasemapGallery } from './BasemapGallery';
import { useMapStore, AVAILABLE_BASEMAPS } from '../../stores/mapStore';

describe('BasemapGallery', () => {
  beforeEach(() => {
    useMapStore.setState({
      currentBasemap: AVAILABLE_BASEMAPS[0],
      isBasemapGalleryOpen: false,
    });
  });

  describe('inline mode', () => {
    it('should render header with current basemap name', () => {
      render(<BasemapGallery inline />);

      expect(screen.getByText('Basemaps')).toBeInTheDocument();
      expect(screen.getByText(`Current: ${AVAILABLE_BASEMAPS[0].name}`)).toBeInTheDocument();
    });

    it('should display all available basemaps', () => {
      render(<BasemapGallery inline />);

      AVAILABLE_BASEMAPS.forEach((basemap) => {
        expect(screen.getByText(basemap.name)).toBeInTheDocument();
      });
    });

    it('should highlight the currently selected basemap', () => {
      render(<BasemapGallery inline />);

      const selectedButton = screen.getByRole('button', { pressed: true });
      expect(selectedButton).toBeInTheDocument();
      expect(selectedButton).toHaveTextContent(AVAILABLE_BASEMAPS[0].name);
    });

    it('should change basemap when a basemap is clicked', () => {
      render(<BasemapGallery inline />);

      const darkMatterButton = screen.getByText('Dark Matter').closest('button');
      fireEvent.click(darkMatterButton!);

      const state = useMapStore.getState();
      expect(state.currentBasemap.id).toBe('dark-matter');
    });

    it('should render thumbnail images for each basemap', () => {
      render(<BasemapGallery inline />);

      const images = screen.getAllByRole('img');
      expect(images.length).toBe(AVAILABLE_BASEMAPS.length);
    });

    it('should have fallback for failed thumbnail images', () => {
      render(<BasemapGallery inline />);

      const images = screen.getAllByRole('img');
      const firstImage = images[0] as HTMLImageElement;

      fireEvent.error(firstImage);

      expect(firstImage.style.display).toBe('none');
    });
  });

  describe('default mode', () => {
    it('should render nothing when not inline', () => {
      const { container } = render(<BasemapGallery />);
      expect(container.innerHTML).toBe('');
    });
  });
});
