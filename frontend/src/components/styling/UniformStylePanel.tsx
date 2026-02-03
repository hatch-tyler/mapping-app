import { StyleConfig } from '../../api/types';
import { ColorPicker } from './ColorPicker';

interface Props {
  styleConfig: StyleConfig;
  onChange: (config: StyleConfig) => void;
  geometryType: string | null;
}

export function UniformStylePanel({ styleConfig, onChange, geometryType }: Props) {
  const isPoint = geometryType?.toLowerCase() === 'point';
  const isLine = geometryType?.toLowerCase() === 'linestring' || geometryType?.toLowerCase() === 'multilinestring';
  const isPolygon = geometryType?.toLowerCase() === 'polygon' || geometryType?.toLowerCase() === 'multipolygon';

  return (
    <div className="space-y-6">
      {/* Fill Color - for points and polygons */}
      {(isPoint || isPolygon || !geometryType) && (
        <ColorPicker
          label="Fill Color"
          color={styleConfig.fillColor}
          onChange={(color) => onChange({ ...styleConfig, fillColor: color })}
        />
      )}

      {/* Line/Stroke Color - for all geometry types */}
      <ColorPicker
        label={isLine ? 'Line Color' : 'Outline Color'}
        color={styleConfig.lineColor}
        onChange={(color) => onChange({ ...styleConfig, lineColor: color })}
      />

      {/* Line Width */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          {isLine ? 'Line Width' : 'Outline Width'}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={styleConfig.lineWidth}
            onChange={(e) =>
              onChange({ ...styleConfig, lineWidth: parseFloat(e.target.value) })
            }
            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-sm text-gray-600 w-12 text-right">
            {styleConfig.lineWidth}px
          </span>
        </div>
      </div>

      {/* Point-specific settings */}
      {(isPoint || !geometryType) && (
        <>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Point Size (meters)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={styleConfig.pointRadius}
                onChange={(e) =>
                  onChange({ ...styleConfig, pointRadius: parseFloat(e.target.value) })
                }
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-sm text-gray-600 w-16 text-right">
                {styleConfig.pointRadius}m
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Min Size (pixels)
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={styleConfig.pointRadiusMinPixels}
                onChange={(e) =>
                  onChange({
                    ...styleConfig,
                    pointRadiusMinPixels: parseInt(e.target.value, 10) || 1,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Max Size (pixels)
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={styleConfig.pointRadiusMaxPixels}
                onChange={(e) =>
                  onChange({
                    ...styleConfig,
                    pointRadiusMaxPixels: parseInt(e.target.value, 10) || 30,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
