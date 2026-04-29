import { describe, it, expect } from 'vitest';
import {
  BLOCKING_WARNING_CODES,
  WarningCode,
  bundleSizeAdvisory,
  isBundleFile,
  isZipFile,
} from './zipInspector';

describe('zipInspector helpers', () => {
  describe('isZipFile', () => {
    it('matches .zip extensions case-insensitively', () => {
      expect(isZipFile('foo.zip')).toBe(true);
      expect(isZipFile('FOO.ZIP')).toBe(true);
      expect(isZipFile('foo.gdb.zip')).toBe(true);
    });

    it('rejects non-zip extensions', () => {
      expect(isZipFile('foo.shp')).toBe(false);
      expect(isZipFile('foo.lpk')).toBe(false);
      expect(isZipFile('zip')).toBe(false);
    });
  });

  describe('isBundleFile', () => {
    it('matches .zip / .lpk / .lpkx', () => {
      expect(isBundleFile('foo.zip')).toBe(true);
      expect(isBundleFile('layer.lpk')).toBe(true);
      expect(isBundleFile('layer.lpkx')).toBe(true);
      expect(isBundleFile('LAYER.LPK')).toBe(true);
    });

    it('rejects non-bundle extensions', () => {
      expect(isBundleFile('foo.shp')).toBe(false);
      expect(isBundleFile('foo.tif')).toBe(false);
      expect(isBundleFile('foo')).toBe(false);
    });
  });

  describe('bundleSizeAdvisory', () => {
    function makeFile(sizeBytes: number): File {
      // Build a File with the requested apparent size by passing a Blob of that length.
      const buf = new Uint8Array(sizeBytes);
      return new File([buf], 'x.zip');
    }

    it('returns null for small bundles', () => {
      expect(bundleSizeAdvisory(makeFile(100 * 1024))).toBeNull();
    });

    it('returns a warning for >500 MB bundles', () => {
      // Avoid actually allocating 500 MB by mocking File.size.
      const f = makeFile(1024);
      Object.defineProperty(f, 'size', { value: 600 * 1024 * 1024 });
      const msg = bundleSizeAdvisory(f);
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/600 MB/);
    });
  });

  describe('warning codes', () => {
    it('exposes the stable code values', () => {
      // Locks the wire-format identifiers — backend mirrors these strings.
      expect(WarningCode.ShapefileMissingRequired).toBe('shapefile_missing_required');
      expect(WarningCode.MissingPrj).toBe('missing_prj');
      expect(WarningCode.GpkgFirstLayerOnly).toBe('gpkg_first_layer_only');
    });

    it('marks shapefile-missing-required as blocking', () => {
      expect(BLOCKING_WARNING_CODES.has(WarningCode.ShapefileMissingRequired)).toBe(true);
    });

    it('does not block on advisory codes', () => {
      expect(BLOCKING_WARNING_CODES.has(WarningCode.MissingPrj)).toBe(false);
      expect(BLOCKING_WARNING_CODES.has(WarningCode.GpkgFirstLayerOnly)).toBe(false);
    });
  });
});
