import { useCallback } from 'react';
import { useMapStore, AVAILABLE_BASEMAPS, Basemap } from '../../stores/mapStore';

interface BasemapGalleryProps {
  inline?: boolean;
}

export function BasemapGallery({ inline = false }: BasemapGalleryProps) {
  const { currentBasemap, setBasemap } = useMapStore();

  const handleBasemapSelect = useCallback(
    (basemap: Basemap) => {
      setBasemap(basemap);
    },
    [setBasemap]
  );

  const gridContent = (
    <div className={inline ? "grid grid-cols-2 gap-3 p-3" : "basemap-gallery-grid"}>
      {AVAILABLE_BASEMAPS.map((basemap) => (
        <button
          key={basemap.id}
          onClick={() => handleBasemapSelect(basemap)}
          className={inline
            ? `flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-colors ${
                currentBasemap.id === basemap.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-transparent hover:bg-gray-50'
              }`
            : `basemap-item ${currentBasemap.id === basemap.id ? 'basemap-item-selected' : ''}`
          }
          aria-pressed={currentBasemap.id === basemap.id}
        >
          <div className={inline ? "w-full aspect-[16/10] rounded overflow-hidden bg-gray-100" : "basemap-thumbnail"}>
            <img
              src={basemap.thumbnail}
              alt={basemap.name}
              crossOrigin="anonymous"
              loading="lazy"
              className={inline ? "w-full h-full object-cover" : undefined}
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
                const parent = el.parentElement;
                if (parent && !parent.querySelector('.basemap-fallback')) {
                  const fallback = document.createElement('div');
                  fallback.className = 'basemap-fallback';
                  fallback.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#e5e7eb;border-radius:6px;font-size:11px;color:#6b7280;font-weight:500;';
                  fallback.textContent = basemap.name;
                  parent.appendChild(fallback);
                }
              }}
            />
          </div>
          <span className={inline ? "text-xs font-medium text-gray-700" : "basemap-name"}>{basemap.name}</span>
          {currentBasemap.id === basemap.id && (
            <div className={inline ? "absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center" : "basemap-check"}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          )}
        </button>
      ))}
    </div>
  );

  if (inline) {
    return (
      <div className="absolute top-12 left-11 bottom-0 w-[340px] bg-white/95 backdrop-blur-sm border-r border-gray-200 z-10 flex flex-col">
        <div className="px-3 py-2 border-b border-gray-200 shrink-0">
          <h3 className="text-sm font-semibold text-gray-800">Basemaps</h3>
          <p className="text-xs text-gray-500 mt-0.5">Current: {currentBasemap.name}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {gridContent}
        </div>
      </div>
    );
  }

  // Legacy floating mode (not used when toolbar is active)
  return null;
}
