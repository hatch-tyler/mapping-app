import { useState, useCallback } from 'react';

interface MeasurePoint {
  longitude: number;
  latitude: number;
}

function haversineDistance(p1: MeasurePoint, p2: MeasurePoint): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (p2.latitude - p1.latitude) * Math.PI / 180;
  const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.latitude * Math.PI / 180) * Math.cos(p2.latitude * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polygonArea(points: MeasurePoint[]): number {
  if (points.length < 3) return 0;
  // Spherical excess formula (approximate)
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const p1 = points[i];
    const p2 = points[j];
    area += (p2.longitude - p1.longitude) * Math.PI / 180 *
      (2 + Math.sin(p1.latitude * Math.PI / 180) + Math.sin(p2.latitude * Math.PI / 180));
  }
  return Math.abs(area * R * R / 2);
}

function formatDistance(meters: number): string {
  if (meters >= 1609.34) {
    return `${(meters / 1609.34).toFixed(2)} mi`;
  }
  return `${meters.toFixed(0)} ft (${(meters * 3.28084).toFixed(0)} ft)`;
}

function formatArea(sqMeters: number): string {
  const acres = sqMeters / 4046.856;
  if (acres >= 640) {
    return `${(acres / 640).toFixed(2)} sq mi (${acres.toFixed(0)} acres)`;
  }
  return `${acres.toFixed(2)} acres`;
}

interface Props {
  onClose: () => void;
  onMapClick: (handler: ((info: { coordinate?: [number, number] }) => void) | null) => void;
}

export function MeasureTool({ onClose, onMapClick }: Props) {
  const [mode, setMode] = useState<'distance' | 'area'>('distance');
  const [points, setPoints] = useState<MeasurePoint[]>([]);

  const handleClick = useCallback((info: { coordinate?: [number, number] }) => {
    if (info.coordinate) {
      const [longitude, latitude] = info.coordinate;
      setPoints(prev => [...prev, { longitude, latitude }]);
    }
  }, []);

  const activate = (newMode: 'distance' | 'area') => {
    setMode(newMode);
    setPoints([]);
    onMapClick(handleClick);
  };

  const clear = () => {
    setPoints([]);
    onMapClick(null);
  };

  const close = () => {
    clear();
    onClose();
  };

  // Calculate measurements
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += haversineDistance(points[i - 1], points[i]);
  }
  const area = mode === 'area' && points.length >= 3 ? polygonArea(points) : 0;

  return (
    <div className="absolute top-14 right-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 z-10 w-56">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Measure</span>
        <button onClick={close} className="text-gray-400 hover:text-gray-600">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex gap-1">
          <button
            onClick={() => activate('distance')}
            className={`flex-1 px-2 py-1 text-xs rounded ${mode === 'distance' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Distance
          </button>
          <button
            onClick={() => activate('area')}
            className={`flex-1 px-2 py-1 text-xs rounded ${mode === 'area' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Area
          </button>
        </div>

        <p className="text-[10px] text-gray-500">Click on the map to add measurement points</p>

        {points.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-gray-600">
              Points: {points.length}
            </p>
            {totalDistance > 0 && (
              <p className="text-sm font-medium text-gray-900">
                Distance: {formatDistance(totalDistance)}
              </p>
            )}
            {area > 0 && (
              <p className="text-sm font-medium text-gray-900">
                Area: {formatArea(area)}
              </p>
            )}
            <button
              onClick={clear}
              className="text-xs text-red-600 hover:text-red-700"
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
