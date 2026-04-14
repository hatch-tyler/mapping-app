import JSZip from 'jszip';
import { inspectZip, isZipFile } from './zipInspector';

async function buildZip(entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(entries)) {
    zip.file(name, data);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'test.zip', { type: 'application/zip' });
}

describe('zipInspector', () => {
  describe('isZipFile', () => {
    it('detects .zip extension', () => {
      expect(isZipFile('foo.zip')).toBe(true);
      expect(isZipFile('Foo.ZIP')).toBe(true);
      expect(isZipFile('foo.tif')).toBe(false);
      expect(isZipFile('foo')).toBe(false);
    });
  });

  describe('shapefile detection', () => {
    it('groups complete shapefile components', async () => {
      const file = await buildZip({
        'counties.shp': 's',
        'counties.shx': 'x',
        'counties.dbf': 'd',
        'counties.prj': 'p',
      });
      const result = await inspectZip(file);
      expect(result).toHaveLength(1);
      const d = result[0];
      expect(d.dataType).toBe('vector');
      expect(d.format).toBe('shapefile');
      expect(d.suggestedName).toBe('counties');
      expect(d.primaryFile).toBe('counties.shp');
      expect(new Set(d.memberFiles)).toEqual(
        new Set(['counties.shp', 'counties.shx', 'counties.dbf', 'counties.prj']),
      );
      expect(d.warnings).toEqual([]);
    });

    it('warns when .prj is missing', async () => {
      const file = await buildZip({ 'a.shp': 's', 'a.shx': 'x', 'a.dbf': 'd' });
      const result = await inspectZip(file);
      expect(result[0].warnings.some((w) => w.toLowerCase().includes('prj'))).toBe(true);
    });

    it('flags missing required sidecars (.shx)', async () => {
      const file = await buildZip({ 'a.shp': 's', 'a.dbf': 'd' });
      const result = await inspectZip(file);
      expect(result[0].warnings.some((w) => w.includes('.shx'))).toBe(true);
    });

    it('detects multiple shapefiles', async () => {
      const file = await buildZip({
        'a.shp': 's', 'a.shx': 'x', 'a.dbf': 'd', 'a.prj': 'p',
        'b.shp': 's', 'b.shx': 'x', 'b.dbf': 'd', 'b.prj': 'p',
      });
      const result = await inspectZip(file);
      expect(result).toHaveLength(2);
      expect(new Set(result.map((r) => r.primaryFile))).toEqual(
        new Set(['a.shp', 'b.shp']),
      );
    });
  });

  describe('raster detection', () => {
    it('groups geotiff with sidecars', async () => {
      const file = await buildZip({
        'elevation.tif': 't',
        'elevation.tfw': 'w',
        'elevation.aux.xml': 'a',
      });
      const result = await inspectZip(file);
      expect(result).toHaveLength(1);
      const d = result[0];
      expect(d.dataType).toBe('raster');
      expect(d.format).toBe('geotiff');
      expect(new Set(d.memberFiles)).toEqual(
        new Set(['elevation.tif', 'elevation.tfw', 'elevation.aux.xml']),
      );
    });

    it('detects multiple geotiffs independently', async () => {
      const file = await buildZip({ 'a.tif': 'a', 'b.tif': 'b' });
      const result = await inspectZip(file);
      expect(result).toHaveLength(2);
    });

    it('groups BIL with .hdr and .prj', async () => {
      const file = await buildZip({
        'dem.bil': 'b', 'dem.hdr': 'h', 'dem.prj': 'p',
      });
      const result = await inspectZip(file);
      expect(result).toHaveLength(1);
      expect(result[0].format).toBe('grid');
      expect(result[0].warnings).toEqual([]);
    });

    it('warns when .hdr is missing for BIL', async () => {
      const file = await buildZip({ 'dem.bil': 'b', 'dem.prj': 'p' });
      const result = await inspectZip(file);
      expect(result[0].warnings.some((w) => w.includes('.hdr'))).toBe(true);
    });
  });

  describe('geojson and geopackage', () => {
    it('detects geopackage with multi-layer warning', async () => {
      const file = await buildZip({ 'parcels.gpkg': 'x' });
      const result = await inspectZip(file);
      expect(result).toHaveLength(1);
      expect(result[0].format).toBe('geopackage');
      expect(result[0].warnings.some((w) => w.toLowerCase().includes('multi-layer'))).toBe(true);
    });

    it('detects geojson', async () => {
      const file = await buildZip({ 'cities.geojson': '{}' });
      const result = await inspectZip(file);
      expect(result[0].format).toBe('geojson');
    });
  });

  describe('mixed and edge cases', () => {
    it('detects mixed shapefile + geotiff', async () => {
      const file = await buildZip({
        'a.shp': 's', 'a.shx': 'x', 'a.dbf': 'd', 'a.prj': 'p',
        'b.tif': 't',
      });
      const result = await inspectZip(file);
      expect(result).toHaveLength(2);
      const types = result.map((r) => r.dataType).sort();
      expect(types).toEqual(['raster', 'vector']);
    });

    it('returns empty for non-geo files', async () => {
      const file = await buildZip({ 'readme.txt': 'hi' });
      const result = await inspectZip(file);
      expect(result).toEqual([]);
    });

    it('ignores __MACOSX and ._ metadata', async () => {
      const file = await buildZip({
        'a.shp': 's', 'a.shx': 'x', 'a.dbf': 'd',
        '__MACOSX/a.shp': 'junk',
        '._a.shp': 'junk',
      });
      const result = await inspectZip(file);
      expect(result).toHaveLength(1);
      expect(result[0].memberFiles).not.toContain('__MACOSX/a.shp');
      expect(result[0].memberFiles).not.toContain('._a.shp');
    });

    it('sorts datasets alphabetically', async () => {
      const file = await buildZip({
        'z.tif': 'z', 'a.tif': 'a', 'm.tif': 'm',
      });
      const result = await inspectZip(file);
      expect(result.map((r) => r.primaryFile)).toEqual(['a.tif', 'm.tif', 'z.tif']);
    });
  });
});
