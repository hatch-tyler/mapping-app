import { RefObject } from 'react';
import { Dataset } from '../../api/types';

interface MapControlsProps {
  showMeasure: boolean;
  onToggleMeasure: () => void;
  deckRef: RefObject<HTMLDivElement | null>;
}

export function MapControls({ showMeasure, onToggleMeasure, deckRef }: MapControlsProps) {
  return (
    <div className="absolute top-14 right-6 flex flex-col gap-1 z-10">
      <button
        onClick={onToggleMeasure}
        className={`p-2 rounded-lg shadow border ${showMeasure ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
        title="Measure distance/area"
        aria-label={showMeasure ? 'Disable measure tool' : 'Enable measure tool'}
        aria-pressed={showMeasure}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 2L2 6l16 16 4-4L6 2zm2 8l2 2m2-6l2 2m2-6l2 2" />
        </svg>
      </button>
      <button
        onClick={() => {
          const canvas = deckRef.current?.querySelector('canvas');
          if (canvas) {
            const link = document.createElement('a');
            link.download = 'map-export.png';
            link.href = (canvas as HTMLCanvasElement).toDataURL('image/png');
            link.click();
          }
        }}
        className="p-2 rounded-lg shadow border bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
        title="Export map as PNG"
        aria-label="Export map as PNG"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </button>
    </div>
  );
}

interface MapWarningsProps {
  belowMinZoomDatasets: Dataset[];
  hasVisibleTruncated: boolean;
  truncatedDataset: Dataset | undefined;
}

export function MapWarnings({ belowMinZoomDatasets, hasVisibleTruncated, truncatedDataset }: MapWarningsProps) {
  return (
    <>
      {belowMinZoomDatasets.length > 0 && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-blue-50 border border-blue-300 text-blue-800 px-4 py-2 rounded-lg shadow text-sm flex items-center gap-2 z-10" role="status">
          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          {belowMinZoomDatasets.length === 1
            ? `Zoom in to level ${belowMinZoomDatasets[0].min_zoom} to view ${belowMinZoomDatasets[0].name}`
            : `Zoom in to level ${Math.max(...belowMinZoomDatasets.map(d => d.min_zoom))} to view ${belowMinZoomDatasets.length} layers`
          }
        </div>
      )}
      {hasVisibleTruncated && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-amber-50 border border-amber-300 text-amber-800 px-4 py-2 rounded-lg shadow text-sm flex items-center gap-2 z-10" role="status">
          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {(() => {
            const featureCount = (truncatedDataset?.service_metadata as Record<string, unknown> | null)?.feature_count as number | undefined;
            return featureCount
              ? `Zoom in to see all features \u2014 layer has ${featureCount.toLocaleString()} features`
              : 'Zoom in to see all features \u2014 some layers have more data than shown';
          })()}
        </div>
      )}
    </>
  );
}
