import {
  createFillColorAccessor,
  createLineColorAccessor,
  createStyleAccessors,
  rgbaToHex,
  hexToRgba,
  rgbaToString,
  DEFAULT_STYLE,
} from './styleInterpreter';

describe('styleInterpreter', () => {
  describe('createFillColorAccessor', () => {
    it('returns default fill color for undefined config', () => {
      const result = createFillColorAccessor(undefined);
      expect(result).toEqual(DEFAULT_STYLE.fillColor);
    });

    it('returns static RGBA for uniform mode', () => {
      const result = createFillColorAccessor({ mode: 'uniform', fillColor: [255, 0, 0, 200] });
      expect(result).toEqual([255, 0, 0, 200]);
    });

    it('returns fillColor when mode is categorical but no attributeField', () => {
      const result = createFillColorAccessor({
        mode: 'categorical',
        fillColor: [10, 20, 30, 255],
      });
      expect(result).toEqual([10, 20, 30, 255]);
    });

    it('returns function for categorical mode with field', () => {
      const accessor = createFillColorAccessor({
        mode: 'categorical',
        fillColor: [0, 0, 0, 255],
        attributeField: 'type',
        categoryColors: {
          residential: [255, 0, 0, 255],
          commercial: [0, 255, 0, 255],
        },
      });
      expect(typeof accessor).toBe('function');
    });

    it('categorical accessor maps field values to colors', () => {
      const accessor = createFillColorAccessor({
        mode: 'categorical',
        fillColor: [0, 0, 0, 255],
        attributeField: 'type',
        categoryColors: {
          residential: [255, 0, 0, 255],
          commercial: [0, 255, 0, 255],
        },
      }) as (d: unknown) => number[];

      const result = accessor({ properties: { type: 'residential' } });
      expect(result).toEqual([255, 0, 0, 255]);
    });

    it('categorical accessor falls back to defaultCategoryColor for unknown values', () => {
      const accessor = createFillColorAccessor({
        mode: 'categorical',
        fillColor: [0, 0, 0, 255],
        attributeField: 'type',
        categoryColors: { a: [255, 0, 0, 255] },
        defaultCategoryColor: [100, 100, 100, 255],
      }) as (d: unknown) => number[];

      const result = accessor({ properties: { type: 'unknown_val' } });
      expect(result).toEqual([100, 100, 100, 255]);
    });

    it('categorical accessor handles null/undefined property values', () => {
      const accessor = createFillColorAccessor({
        mode: 'categorical',
        fillColor: [0, 0, 0, 255],
        attributeField: 'type',
        categoryColors: {},
        defaultCategoryColor: [50, 50, 50, 255],
      }) as (d: unknown) => number[];

      const result = accessor({ properties: {} });
      expect(result).toEqual([50, 50, 50, 255]);
    });

    it('returns fillColor when graduated mode has no field', () => {
      const result = createFillColorAccessor({
        mode: 'graduated',
        fillColor: [10, 20, 30, 255],
      });
      expect(result).toEqual([10, 20, 30, 255]);
    });

    it('returns fillColor when graduated mode has no colorRamp name', () => {
      const result = createFillColorAccessor({
        mode: 'graduated',
        fillColor: [10, 20, 30, 255],
        attributeField: 'value',
        colorRamp: {},
      });
      expect(result).toEqual([10, 20, 30, 255]);
    });

    it('returns function for graduated mode with field and ramp', () => {
      const accessor = createFillColorAccessor({
        mode: 'graduated',
        fillColor: [0, 0, 0, 255],
        attributeField: 'value',
        colorRamp: { name: 'viridis', minValue: 0, maxValue: 100 },
      });
      expect(typeof accessor).toBe('function');
    });

    it('graduated accessor returns fillColor for NaN values', () => {
      const accessor = createFillColorAccessor({
        mode: 'graduated',
        fillColor: [99, 99, 99, 255],
        attributeField: 'value',
        colorRamp: { name: 'viridis', minValue: 0, maxValue: 100 },
      }) as (d: unknown) => number[];

      const result = accessor({ properties: { value: 'not a number' } });
      expect(result).toEqual([99, 99, 99, 255]);
    });

    it('graduated accessor interpolates numeric values', () => {
      const accessor = createFillColorAccessor({
        mode: 'graduated',
        fillColor: [0, 0, 0, 255],
        attributeField: 'value',
        colorRamp: { name: 'viridis', minValue: 0, maxValue: 100 },
      }) as (d: unknown) => number[];

      const result = accessor({ properties: { value: 50 } });
      // Should return a color from the viridis ramp, not fillColor
      expect(result).not.toEqual([0, 0, 0, 255]);
      expect(result).toHaveLength(4);
    });

    it('returns default fill for unknown mode', () => {
      const result = createFillColorAccessor({
        mode: 'something_else',
        fillColor: [1, 2, 3, 4],
      });
      expect(result).toEqual([1, 2, 3, 4]);
    });
  });

  describe('createLineColorAccessor', () => {
    it('returns lineColor from config', () => {
      const result = createLineColorAccessor({ lineColor: [255, 0, 0, 255] });
      expect(result).toEqual([255, 0, 0, 255]);
    });

    it('returns default lineColor for undefined config', () => {
      const result = createLineColorAccessor(undefined);
      expect(result).toEqual(DEFAULT_STYLE.lineColor);
    });
  });

  describe('createStyleAccessors', () => {
    it('returns complete accessor object', () => {
      const result = createStyleAccessors(undefined);
      expect(result).toHaveProperty('getFillColor');
      expect(result).toHaveProperty('getLineColor');
      expect(result).toHaveProperty('getLineWidth');
      expect(result).toHaveProperty('getPointRadius');
      expect(result).toHaveProperty('pointRadiusMinPixels');
      expect(result).toHaveProperty('pointRadiusMaxPixels');
      expect(result).toHaveProperty('updateTriggers');
    });

    it('uniform mode triggers include fillColor and mode', () => {
      const result = createStyleAccessors({ mode: 'uniform', fillColor: [1, 2, 3, 4] });
      expect(result.updateTriggers.getFillColor).toContain('uniform');
    });

    it('categorical mode triggers include attributeField and categoryColors', () => {
      const result = createStyleAccessors({
        mode: 'categorical',
        attributeField: 'type',
        categoryColors: { a: [1, 2, 3, 4] },
      });
      expect(result.updateTriggers.getFillColor).toContain('type');
    });

    it('graduated mode triggers include ramp params', () => {
      const result = createStyleAccessors({
        mode: 'graduated',
        attributeField: 'val',
        colorRamp: { name: 'viridis', minValue: 0, maxValue: 100 },
      });
      expect(result.updateTriggers.getFillColor).toContain('val');
      expect(result.updateTriggers.getFillColor).toContain('viridis');
    });

    it('lineColor triggers include lineColor', () => {
      const result = createStyleAccessors({ lineColor: [10, 20, 30, 255] });
      expect(result.updateTriggers.getLineColor).toEqual([[10, 20, 30, 255]]);
    });
  });

  describe('rgbaToHex', () => {
    it('converts RGBA to hex', () => {
      expect(rgbaToHex([255, 0, 0, 255])).toBe('#ff0000');
      expect(rgbaToHex([0, 128, 255, 180])).toBe('#0080ff');
      expect(rgbaToHex([0, 0, 0, 255])).toBe('#000000');
    });
  });

  describe('hexToRgba', () => {
    it('converts hex to RGBA', () => {
      expect(hexToRgba('#ff0000')).toEqual([255, 0, 0, 255]);
      expect(hexToRgba('#0080ff')).toEqual([0, 128, 255, 255]);
    });

    it('supports hex without hash', () => {
      expect(hexToRgba('ff0000')).toEqual([255, 0, 0, 255]);
    });

    it('supports custom alpha', () => {
      expect(hexToRgba('#ff0000', 128)).toEqual([255, 0, 0, 128]);
    });

    it('returns gray fallback for invalid hex', () => {
      expect(hexToRgba('invalid')).toEqual([128, 128, 128, 255]);
      expect(hexToRgba('')).toEqual([128, 128, 128, 255]);
    });

    it('round-trips with rgbaToHex', () => {
      const original = [66, 133, 244, 255] as [number, number, number, number];
      const hex = rgbaToHex(original);
      const back = hexToRgba(hex, 255);
      expect(back).toEqual(original);
    });
  });

  describe('rgbaToString', () => {
    it('formats RGBA as CSS string', () => {
      expect(rgbaToString([255, 0, 0, 255])).toBe('rgba(255, 0, 0, 1.00)');
      expect(rgbaToString([0, 128, 255, 128])).toBe('rgba(0, 128, 255, 0.50)');
      expect(rgbaToString([0, 0, 0, 0])).toBe('rgba(0, 0, 0, 0.00)');
    });
  });
});
