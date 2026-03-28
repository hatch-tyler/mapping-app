import { useState } from 'react';
import { useMapStore } from '@/stores/mapStore';
import { useDatasetStore } from '@/stores/datasetStore';
import { getColorRamp, interpolateRamp } from '@/utils/colorRamps';
import type { Dataset, StyleConfig, RGBAColor } from '@/api/types';

function rgbaStr(c: RGBAColor): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;
}

function ColorSwatch({ color, size = 12 }: { color: RGBAColor; size?: number }) {
  return (
    <span
      className="inline-block rounded-sm border border-gray-300 shrink-0"
      style={{ width: size, height: size, backgroundColor: rgbaStr(color) }}
    />
  );
}

function GradientBar({ rampName, minVal, maxVal }: { rampName: string; minVal: number; maxVal: number }) {
  const ramp = getColorRamp(rampName);
  if (!ramp) return null;

  const stops = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    const color = interpolateRamp(rampName, t);
    return `${rgbaStr(color)} ${(t * 100).toFixed(0)}%`;
  }).join(', ');

  return (
    <div>
      <div
        className="h-3 rounded-sm border border-gray-300"
        style={{ background: `linear-gradient(to right, ${stops})` }}
      />
      <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
        <span>{minVal.toLocaleString()}</span>
        <span>{maxVal.toLocaleString()}</span>
      </div>
    </div>
  );
}

function DatasetLegend({ dataset }: { dataset: Dataset }) {
  const [expanded, setExpanded] = useState(true);
  const config = (dataset.style_config || {}) as Partial<StyleConfig>;
  const mode = config.mode || 'uniform';

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 w-full text-left text-xs font-medium text-gray-700 hover:text-gray-900 py-0.5"
      >
        <svg
          className={`w-3 h-3 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className="truncate">{dataset.name}</span>
      </button>

      {expanded && (
        <div className="pl-4 pr-1 space-y-0.5">
          {mode === 'uniform' && (
            <div className="flex items-center gap-1.5">
              <ColorSwatch color={config.fillColor || [0, 128, 255, 180]} />
              <span className="text-[10px] text-gray-500">All features</span>
            </div>
          )}

          {mode === 'categorical' && config.categoryColors && (
            <>
              <p className="text-[9px] text-gray-400 mb-0.5">{config.attributeField}</p>
              {Object.entries(config.categoryColors).slice(0, 30).map(([value, color]) => (
                <div key={value} className="flex items-center gap-1.5">
                  <ColorSwatch color={color as RGBAColor} />
                  <span className="text-[10px] text-gray-600 truncate" title={value}>
                    {value}
                  </span>
                </div>
              ))}
              {config.defaultCategoryColor && (
                <div className="flex items-center gap-1.5">
                  <ColorSwatch color={config.defaultCategoryColor} />
                  <span className="text-[10px] text-gray-400 italic">Other</span>
                </div>
              )}
              {Object.keys(config.categoryColors).length > 30 && (
                <p className="text-[9px] text-gray-400">
                  +{Object.keys(config.categoryColors).length - 30} more
                </p>
              )}
            </>
          )}

          {mode === 'graduated' && config.colorRamp && (
            <>
              <p className="text-[9px] text-gray-400 mb-0.5">{config.attributeField}</p>
              <GradientBar
                rampName={config.colorRamp.name}
                minVal={config.colorRamp.minValue ?? 0}
                maxVal={config.colorRamp.maxValue ?? 100}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Legend() {
  const { visibleDatasets } = useMapStore();
  const { datasets } = useDatasetStore();

  const visibleStyled = datasets.filter(
    (d) => visibleDatasets.has(d.id) && d.is_visible && d.data_type === 'vector'
  );

  if (visibleStyled.length === 0) return null;

  return (
    <div>
      {visibleStyled.map((ds) => (
        <DatasetLegend key={ds.id} dataset={ds} />
      ))}
    </div>
  );
}
