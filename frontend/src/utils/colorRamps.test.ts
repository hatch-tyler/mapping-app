import {
  getColorRamp,
  interpolateRamp,
  normalizeValue,
  generateRampPreview,
  getCategoryColor,
  COLOR_RAMPS,
  CATEGORY_PALETTE,
  CATEGORICAL_PALETTES,
} from './colorRamps';

describe('colorRamps', () => {
  describe('getColorRamp', () => {
    it('returns ramp by name', () => {
      const ramp = getColorRamp('viridis');
      expect(ramp).toBeDefined();
      expect(ramp!.name).toBe('viridis');
      expect(ramp!.colors.length).toBeGreaterThan(0);
    });

    it('returns undefined for unknown name', () => {
      expect(getColorRamp('nonexistent')).toBeUndefined();
    });

    it('all defined ramps are findable', () => {
      for (const ramp of COLOR_RAMPS) {
        expect(getColorRamp(ramp.name)).toBeDefined();
      }
    });
  });

  describe('interpolateRamp', () => {
    it('returns first color at t=0', () => {
      const ramp = getColorRamp('viridis')!;
      const result = interpolateRamp('viridis', 0);
      expect(result).toEqual(ramp.colors[0]);
    });

    it('returns last color at t=1', () => {
      const ramp = getColorRamp('viridis')!;
      const result = interpolateRamp('viridis', 1);
      expect(result).toEqual(ramp.colors[ramp.colors.length - 1]);
    });

    it('returns interpolated color at t=0.5', () => {
      const result = interpolateRamp('viridis', 0.5);
      expect(result).toHaveLength(4);
      // Should not be first or last color
      const ramp = getColorRamp('viridis')!;
      expect(result).not.toEqual(ramp.colors[0]);
      expect(result).not.toEqual(ramp.colors[ramp.colors.length - 1]);
    });

    it('clamps t < 0 to 0', () => {
      const atZero = interpolateRamp('viridis', 0);
      const atNegative = interpolateRamp('viridis', -5);
      expect(atNegative).toEqual(atZero);
    });

    it('clamps t > 1 to 1', () => {
      const atOne = interpolateRamp('viridis', 1);
      const atTwo = interpolateRamp('viridis', 2);
      expect(atTwo).toEqual(atOne);
    });

    it('returns gray fallback for unknown ramp', () => {
      const result = interpolateRamp('nonexistent', 0.5);
      expect(result).toEqual([128, 128, 128, 255]);
    });

    it('returns RGBA values as integers', () => {
      const result = interpolateRamp('viridis', 0.33);
      for (const channel of result) {
        expect(Number.isInteger(channel)).toBe(true);
      }
    });
  });

  describe('normalizeValue', () => {
    it('normalizes within range', () => {
      expect(normalizeValue(50, 0, 100)).toBe(0.5);
      expect(normalizeValue(0, 0, 100)).toBe(0);
      expect(normalizeValue(100, 0, 100)).toBe(1);
    });

    it('returns 0.5 when min equals max', () => {
      expect(normalizeValue(5, 5, 5)).toBe(0.5);
    });

    it('handles negative ranges', () => {
      expect(normalizeValue(0, -10, 10)).toBe(0.5);
    });

    it('can return values outside 0-1 for out-of-range input', () => {
      expect(normalizeValue(200, 0, 100)).toBe(2);
      expect(normalizeValue(-50, 0, 100)).toBe(-0.5);
    });
  });

  describe('generateRampPreview', () => {
    it('returns array of correct length', () => {
      const preview = generateRampPreview('viridis', 10);
      expect(preview).toHaveLength(10);
    });

    it('first and last colors match ramp endpoints', () => {
      const ramp = getColorRamp('viridis')!;
      const preview = generateRampPreview('viridis', 5);
      expect(preview[0]).toEqual(ramp.colors[0]);
      expect(preview[4]).toEqual(ramp.colors[ramp.colors.length - 1]);
    });

    it('each entry is RGBA', () => {
      const preview = generateRampPreview('blues', 3);
      for (const color of preview) {
        expect(color).toHaveLength(4);
      }
    });
  });

  describe('getCategoryColor', () => {
    it('returns color at index', () => {
      expect(getCategoryColor(0)).toEqual(CATEGORY_PALETTE[0]);
      expect(getCategoryColor(1)).toEqual(CATEGORY_PALETTE[1]);
    });

    it('wraps around palette length', () => {
      const paletteLen = CATEGORY_PALETTE.length;
      expect(getCategoryColor(paletteLen)).toEqual(CATEGORY_PALETTE[0]);
      expect(getCategoryColor(paletteLen + 1)).toEqual(CATEGORY_PALETTE[1]);
    });

    it('uses named palette when specified', () => {
      const okabeIto = CATEGORICAL_PALETTES.find(p => p.name === 'okabe-ito')!;
      expect(getCategoryColor(0, 'okabe-ito')).toEqual(okabeIto.colors[0]);
    });

    it('falls back to default palette for unknown name', () => {
      expect(getCategoryColor(0, 'nonexistent')).toEqual(CATEGORY_PALETTE[0]);
    });
  });
});
