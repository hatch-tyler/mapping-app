import { useCallback, useEffect, useRef } from 'react';
import { useMapStore, AVAILABLE_BASEMAPS, Basemap } from '../../stores/mapStore';

export function BasemapGallery() {
  const {
    currentBasemap,
    isBasemapGalleryOpen,
    setBasemap,
    toggleBasemapGallery,
    setBasemapGalleryOpen,
  } = useMapStore();

  const galleryRef = useRef<HTMLDivElement>(null);

  // Close gallery when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        galleryRef.current &&
        !galleryRef.current.contains(event.target as Node)
      ) {
        setBasemapGalleryOpen(false);
      }
    }

    if (isBasemapGalleryOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isBasemapGalleryOpen, setBasemapGalleryOpen]);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setBasemapGalleryOpen(false);
      }
    }

    if (isBasemapGalleryOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isBasemapGalleryOpen, setBasemapGalleryOpen]);

  const handleBasemapSelect = useCallback(
    (basemap: Basemap) => {
      setBasemap(basemap);
    },
    [setBasemap]
  );

  return (
    <div ref={galleryRef} className="basemap-gallery-container">
      {/* Toggle Button */}
      <button
        onClick={toggleBasemapGallery}
        className="basemap-toggle-btn"
        title="Change basemap"
        aria-label="Open basemap gallery"
        aria-expanded={isBasemapGalleryOpen}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      </button>

      {/* Gallery Panel */}
      {isBasemapGalleryOpen && (
        <div className="basemap-gallery-panel">
          <div className="basemap-gallery-header">
            <h3>Basemap Gallery</h3>
            <button
              onClick={() => setBasemapGalleryOpen(false)}
              className="basemap-gallery-close"
              aria-label="Close basemap gallery"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="basemap-gallery-grid">
            {AVAILABLE_BASEMAPS.map((basemap) => (
              <button
                key={basemap.id}
                onClick={() => handleBasemapSelect(basemap)}
                className={`basemap-item ${
                  currentBasemap.id === basemap.id ? 'basemap-item-selected' : ''
                }`}
                aria-pressed={currentBasemap.id === basemap.id}
              >
                <div className="basemap-thumbnail">
                  <img
                    src={basemap.thumbnail}
                    alt={basemap.name}
                    onError={(e) => {
                      // Fallback for failed thumbnails
                      (e.target as HTMLImageElement).src =
                        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Crect fill="%23e5e7eb" width="100" height="100"/%3E%3Ctext x="50" y="50" text-anchor="middle" dy=".3em" fill="%236b7280" font-size="12"%3EMap%3C/text%3E%3C/svg%3E';
                    }}
                  />
                </div>
                <span className="basemap-name">{basemap.name}</span>
                {currentBasemap.id === basemap.id && (
                  <div className="basemap-check">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
