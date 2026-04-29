import JSZip from 'jszip';

export type DataType = 'vector' | 'raster';

/** Stable warning-code identifiers; mirrors backend WarningCode.
 *  Frontend code should switch on these instead of substring matching. */
export const WarningCode = {
  ShapefileMissingRequired: 'shapefile_missing_required',
  MissingPrj: 'missing_prj',
  GridMissingHdr: 'grid_missing_hdr',
  GpkgFirstLayerOnly: 'gpkg_first_layer_only',
  GdbUnreadable: 'gdb_unreadable',
  LpkNoDataSources: 'lpk_no_data_sources',
} as const;

export type WarningCodeValue = typeof WarningCode[keyof typeof WarningCode];

/** Codes that should disable selection of the affected dataset. */
export const BLOCKING_WARNING_CODES: ReadonlySet<string> = new Set([
  WarningCode.ShapefileMissingRequired,
]);

export interface DetectedWarning {
  code: string;
  message: string;
}

export interface DetectedDataset {
  suggestedName: string;
  dataType: DataType;
  format: string;
    // 'shapefile' | 'geotiff' | 'geopackage' | 'geojson' | 'grid' | 'gdb-vector' | 'gdb-raster' | <ext>
  /** Opaque unique key. For plain files this equals entryPath; for container
   *  layers it is a synthetic "<container>::<layer>" identifier. */
  primaryFile: string;
  memberFiles: string[]; // includes the primary entry + sidecars (or just the container)
  warnings: DetectedWarning[];
  /** Real bundle-archive entry path for plain-file datasets; null for container layers. */
  entryPath?: string | null;
  // Set when the dataset is a layer inside a multi-layer container
  // (.gdb directory or .lpk/.lpkx file).
  containerPath?: string | null;
  layerName?: string | null;
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
 *
 * Throws ``ContainerFormatError`` when the archive contains an Esri File
 * Geodatabase or Layer Package — those need GDAL to enumerate layers, so
 * the caller should fall back to the server-side ``/upload/inspect`` endpoint.
 */
export class ContainerFormatError extends Error {
  constructor() {
    super('Archive contains a multi-layer container (.gdb / .lpk) — server-side inspection required');
    this.name = 'ContainerFormatError';
  }
}

export async function inspectZip(file: File): Promise<DetectedDataset[]> {
  const entries = await listZipEntries(file);

  if (hasContainerFormat(entries)) {
    throw new ContainerFormatError();
  }

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
      const warnings: DetectedWarning[] = [];
      const missing: string[] = [];
      for (const req of SHAPEFILE_REQUIRED_SIDECARS) {
        const match = siblings.find((s) => extOf(s) === req);
        if (match) members.push(match);
        else missing.push(req);
      }
      if (missing.length) {
        warnings.push({
          code: WarningCode.ShapefileMissingRequired,
          message: `Shapefile is missing required files: ${missing.join(', ')}`,
        });
      }
      for (const opt of SHAPEFILE_OPTIONAL_SIDECARS) {
        const match = siblings.find((s) => extOf(s) === opt);
        if (match) members.push(match);
      }
      if (!siblingExts.has('.prj')) {
        warnings.push({
          code: WarningCode.MissingPrj,
          message: 'Missing .prj — upload will fail without a coordinate reference system',
        });
      }
      members.forEach((m) => consumed.add(m));
      detected.push({
        suggestedName: stemOf(entry),
        dataType: 'vector',
        format: 'shapefile',
        primaryFile: entry,
        memberFiles: members,
        warnings,
        entryPath: entry,
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
          {
            code: WarningCode.GpkgFirstLayerOnly,
            message: 'Multi-layer GeoPackages will be imported as the first layer only',
          },
        ],
        entryPath: entry,
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
        entryPath: entry,
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
        entryPath: entry,
      });
      continue;
    }

    // Esri grid primary
    if (GRID_PRIMARY_EXTS.has(ext)) {
      const members = [entry];
      const warnings: DetectedWarning[] = [];
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
        warnings.push({
          code: WarningCode.GridMissingHdr,
          message: `${ext} requires a .hdr sidecar for spatial reference`,
        });
      }
      if (!hasPrj) {
        warnings.push({
          code: WarningCode.MissingPrj,
          message: 'Missing .prj — upload will fail without a coordinate reference system',
        });
      }
      members.forEach((m) => consumed.add(m));
      detected.push({
        suggestedName: stemOf(entry),
        dataType: 'raster',
        format: 'grid',
        primaryFile: entry,
        memberFiles: members,
        warnings,
        entryPath: entry,
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

/** True if the upload should go through the bundle flow (zip, layer package). */
export function isBundleFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.lpk') || lower.endsWith('.lpkx');
}

/** True if the ZIP entries indicate a multi-layer container (.gdb / .lpk inside).
 *  When this returns true, server-side inspection is required (the client
 *  cannot enumerate layers without GDAL). */
export function hasContainerFormat(entries: string[]): boolean {
  for (const e of entries) {
    const lower = e.toLowerCase();
    if (lower.endsWith('.lpk') || lower.endsWith('.lpkx')) return true;
    // Detect any ".gdb/" directory segment in the path.
    if (/(^|\/)[^/]+\.gdb(\/|$)/.test(lower)) return true;
  }
  return false;
}
