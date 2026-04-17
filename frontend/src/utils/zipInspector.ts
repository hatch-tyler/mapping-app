import JSZip from 'jszip';

export type DataType = 'vector' | 'raster';

export interface DetectedDataset {
  suggestedName: string;
  dataType: DataType;
  format: string; // 'shapefile' | 'geotiff' | 'geopackage' | 'geojson' | 'grid' | <ext>
  primaryFile: string; // path inside ZIP
  memberFiles: string[]; // includes primaryFile + sidecars
  warnings: string[];
}

const SHAPEFILE_EXT = '.shp';
const GEOPACKAGE_EXT = '.gpkg';
const GEOJSON_EXTS = new Set(['.geojson', '.json']);
const RASTER_PRIMARY_EXTS = new Set(['.tif', '.tiff', '.geotiff', '.jp2', '.img']);
const GRID_PRIMARY_EXTS = new Set(['.bil', '.bip', '.bsq', '.flt', '.asc']);

const SHAPEFILE_REQUIRED_SIDECARS = new Set(['.shx', '.dbf']);
const SHAPEFILE_OPTIONAL_SIDECARS = new Set([
  '.prj',
  '.cpg',
  '.sbn',
  '.sbx',
  '.qpj',
  '.shp.xml',
]);
const RASTER_SIDECARS = new Set([
  '.tfw',
  '.jgw',
  '.wld',
  '.aux.xml',
  '.ovr',
  '.vat.dbf',
  '.prj',
]);
const GRID_SIDECARS = new Set([
  '.hdr',
  '.prj',
  '.blw',
  '.flw',
  '.stx',
  '.aux.xml',
]);

function extOf(entry: string): string {
  const name = entry.toLowerCase().replace(/\\/g, '/').split('/').pop() ?? '';
  if (name.endsWith('.shp.xml')) return '.shp.xml';
  if (name.endsWith('.aux.xml')) return '.aux.xml';
  if (name.endsWith('.vat.dbf')) return '.vat.dbf';
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

function splitDirAndName(entry: string): [string, string] {
  const posix = entry.replace(/\\/g, '/');
  const i = posix.lastIndexOf('/');
  if (i < 0) return ['', posix];
  return [posix.slice(0, i), posix.slice(i + 1)];
}

function stemOf(entry: string): string {
  const [, name] = splitDirAndName(entry);
  const ext = extOf(entry);
  return ext && name.toLowerCase().endsWith(ext)
    ? name.slice(0, name.length - ext.length)
    : name;
}

function groupKey(entry: string): string {
  const [dir] = splitDirAndName(entry);
  return `${dir}|${stemOf(entry).toLowerCase()}`;
}

function ignore(entry: string): boolean {
  if (entry.includes('__MACOSX')) return true;
  const [, name] = splitDirAndName(entry);
  return name.startsWith('._');
}

/** Read and list non-directory entries from a ZIP File object. */
async function listZipEntries(file: File): Promise<string[]> {
  const zip = await JSZip.loadAsync(file);
  const out: string[] = [];
  zip.forEach((_path, entry) => {
    if (entry.dir) return;
    if (ignore(entry.name)) return;
    out.push(entry.name.replace(/\\/g, '/'));
  });
  return out;
}

/**
 * Inspect a ZIP and group its entries into detected datasets.
 * Mirrors backend/app/services/zip_inspector.py.
 */
export async function inspectZip(file: File): Promise<DetectedDataset[]> {
  const entries = await listZipEntries(file);

  // Group siblings by (directory, stem)
  const groups: Record<string, string[]> = {};
  for (const e of entries) {
    (groups[groupKey(e)] ||= []).push(e);
  }

  const consumed = new Set<string>();
  const detected: DetectedDataset[] = [];

  for (const entry of entries) {
    if (consumed.has(entry)) continue;
    const ext = extOf(entry);
    const siblings = groups[groupKey(entry)] ?? [];
    const siblingExts = new Set(siblings.map(extOf));

    // Shapefile
    if (ext === SHAPEFILE_EXT) {
      const members = [entry];
      const warnings: string[] = [];
      const missing: string[] = [];
      for (const req of SHAPEFILE_REQUIRED_SIDECARS) {
        const match = siblings.find((s) => extOf(s) === req);
        if (match) members.push(match);
        else missing.push(req);
      }
      if (missing.length) {
        warnings.push(
          `Shapefile is missing required files: ${missing.join(', ')}`,
        );
      }
      for (const opt of SHAPEFILE_OPTIONAL_SIDECARS) {
        const match = siblings.find((s) => extOf(s) === opt);
        if (match) members.push(match);
      }
      if (!siblingExts.has('.prj')) {
        warnings.push('Missing .prj — upload will fail without a coordinate reference system');
      }
      members.forEach((m) => consumed.add(m));
      detected.push({
        suggestedName: stemOf(entry),
        dataType: 'vector',
        format: 'shapefile',
        primaryFile: entry,
        memberFiles: members,
        warnings,
      });
      continue;
    }

    // GeoPackage
    if (ext === GEOPACKAGE_EXT) {
      consumed.add(entry);
      detected.push({
        suggestedName: stemOf(entry),
        dataType: 'vector',
        format: 'geopackage',
        primaryFile: entry,
        memberFiles: [entry],
        warnings: [
          'Multi-layer GeoPackages will be imported as the first layer only',
        ],
      });
      continue;
    }

    // GeoJSON
    if (GEOJSON_EXTS.has(ext)) {
      consumed.add(entry);
      detected.push({
        suggestedName: stemOf(entry),
        dataType: 'vector',
        format: 'geojson',
        primaryFile: entry,
        memberFiles: [entry],
        warnings: [],
      });
      continue;
    }

    // Raster primary
    if (RASTER_PRIMARY_EXTS.has(ext)) {
      const members = [entry];
      for (const sib of siblings) {
        if (sib === entry) continue;
        if (RASTER_SIDECARS.has(extOf(sib))) members.push(sib);
      }
      members.forEach((m) => consumed.add(m));
      const isTiff = ext === '.tif' || ext === '.tiff' || ext === '.geotiff';
      detected.push({
        suggestedName: stemOf(entry),
        dataType: 'raster',
        format: isTiff ? 'geotiff' : ext.slice(1),
        primaryFile: entry,
        memberFiles: members,
        warnings: [],
      });
      continue;
    }

    // Esri grid primary
    if (GRID_PRIMARY_EXTS.has(ext)) {
      const members = [entry];
      const warnings: string[] = [];
      let hasHdr = false;
      let hasPrj = false;
      for (const sib of siblings) {
        if (sib === entry) continue;
        const sibExt = extOf(sib);
        if (GRID_SIDECARS.has(sibExt)) {
          members.push(sib);
          if (sibExt === '.hdr') hasHdr = true;
          if (sibExt === '.prj') hasPrj = true;
        }
      }
      if (ext !== '.asc' && !hasHdr) {
        warnings.push(`${ext} requires a .hdr sidecar for spatial reference`);
      }
      if (!hasPrj) {
        warnings.push('Missing .prj — upload will fail without a coordinate reference system');
      }
      members.forEach((m) => consumed.add(m));
      detected.push({
        suggestedName: stemOf(entry),
        dataType: 'raster',
        format: 'grid',
        primaryFile: entry,
        memberFiles: members,
        warnings,
      });
    }
  }

  detected.sort((a, b) => a.primaryFile.toLowerCase().localeCompare(b.primaryFile.toLowerCase()));
  return detected;
}

/** True if the filename is a ZIP archive. */
export function isZipFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip');
}
