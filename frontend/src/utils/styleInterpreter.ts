import { StyleConfig, RGBAColor } from '../api/types';
import { interpolateRamp, normalizeValue } from './colorRamps';

export const DEFAULT_STYLE: StyleConfig = {
  mode: 'uniform',
  fillColor: [0, 128, 255, 180],
  lineColor: [0, 0, 0, 255],
  lineWidth: 2,
  pointRadius: 100,
  pointRadiusMinPixels: 6,
  pointRadiusMaxPixels: 30,
};

export interface StyleAccessors {
  getFillColor: RGBAColor | ((d: unknown) => RGBAColor);
  getLineColor: RGBAColor | ((d: unknown) => RGBAColor);
  getLineWidth: number;
  getPointRadius: number;
  pointRadiusMinPixels: number;
  pointRadiusMaxPixels: number;
  updateTriggers: {
    getFillColor: unknown[];
    getLineColor: unknown[];
  };
}

interface FeatureData {
  properties?: Record<string, unknown>;
}

function getStyleConfig(styleConfig: Record<string, unknown> | undefined): StyleConfig {
  return {
    ...DEFAULT_STYLE,
    ...styleConfig,
  } as StyleConfig;
}

export function createFillColorAccessor(
  styleConfig: Record<string, unknown> | undefined
): RGBAColor | ((d: unknown) => RGBAColor) {
  const config = getStyleConfig(styleConfig);
  const mode = config.mode || 'uniform';

  if (mode === 'uniform') {
    return config.fillColor;
  }

  if (mode === 'categorical') {
    const field = config.attributeField;
    const categoryColors = config.categoryColors || {};
    const defaultColor = config.defaultCategoryColor || DEFAULT_STYLE.fillColor;

    if (!field) {
      return config.fillColor;
    }

    return (d: unknown) => {
      const feature = d as FeatureData;
      const value = feature.properties?.[field];
      const key = String(value ?? '');
      return categoryColors[key] || defaultColor;
    };
  }

  if (mode === 'graduated') {
    const field = config.attributeField;
    const colorRamp = config.colorRamp;

    if (!field || !colorRamp?.name) {
      return config.fillColor;
    }

    const minValue = colorRamp.minValue ?? 0;
    const maxValue = colorRamp.maxValue ?? 100;
    const rampName = colorRamp.name;

    return (d: unknown) => {
      const feature = d as FeatureData;
      const rawValue = feature.properties?.[field];
      const numValue = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue));

      if (isNaN(numValue)) {
        return config.fillColor;
      }

      const t = normalizeValue(numValue, minValue, maxValue);
      return interpolateRamp(rampName, t);
    };
  }

  return config.fillColor;
}

export function createLineColorAccessor(
  styleConfig: Record<string, unknown> | undefined
): RGBAColor | ((d: unknown) => RGBAColor) {
  const config = getStyleConfig(styleConfig);
  return config.lineColor;
}

export function createStyleAccessors(
  styleConfig: Record<string, unknown> | undefined
): StyleAccessors {
  const config = getStyleConfig(styleConfig);
  const fillColor = createFillColorAccessor(styleConfig);
  const lineColor = createLineColorAccessor(styleConfig);

  // Build update triggers based on mode
  const fillTriggers: unknown[] = [config.fillColor, config.mode];
  if (config.mode === 'categorical') {
    fillTriggers.push(config.attributeField, JSON.stringify(config.categoryColors));
  } else if (config.mode === 'graduated') {
    fillTriggers.push(
      config.attributeField,
      config.colorRamp?.name,
      config.colorRamp?.minValue,
      config.colorRamp?.maxValue
    );
  }

  return {
    getFillColor: fillColor,
    getLineColor: lineColor,
    getLineWidth: config.lineWidth,
    getPointRadius: config.pointRadius,
    pointRadiusMinPixels: config.pointRadiusMinPixels,
    pointRadiusMaxPixels: config.pointRadiusMaxPixels,
    updateTriggers: {
      getFillColor: fillTriggers,
      getLineColor: [config.lineColor],
    },
  };
}

export function rgbaToHex(rgba: RGBAColor): string {
  const [r, g, b] = rgba;
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function hexToRgba(hex: string, alpha: number = 255): RGBAColor {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16),
      alpha,
    ];
  }
  return [128, 128, 128, alpha];
}

export function rgbaToString(rgba: RGBAColor): string {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(rgba[3] / 255).toFixed(2)})`;
}
