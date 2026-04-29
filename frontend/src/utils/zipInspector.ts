/**
 * Bundle inspection types and helpers.
 *
 * Bundle inspection (ZIP / .gdb.zip / .lpk / .lpkx) is performed by the
 * server's ``/upload/inspect`` endpoint, which uses GDAL to enumerate File
 * Geodatabase layers. The client used to mirror most of that logic with
 * JSZip, but the mirror added 240+ LOC and an extra dependency for no
 * functional gain — for any container format (.gdb / .lpk) the client could
 * never enumerate without GDAL anyway, so it always fell back to the server.
 *
 * This module now provides only the shared TypeScript types and lightweight
 * client-side prechecks (extension recognition, soft-size warning).
 */

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
  memberFiles: string[];
  warnings: DetectedWarning[];
  /** Real bundle-archive entry path for plain-file datasets; null for container layers. */
  entryPath?: string | null;
  /** Set when the dataset is a layer inside a multi-layer container (.gdb / .lpk / .lpkx). */
  containerPath?: string | null;
  layerName?: string | null;
}

/** True if the filename has a .zip extension. */
export function isZipFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip');
}

/** True if the upload should go through the bundle inspect/upload flow.
 *
 *  Covers .zip, .gdb.zip (which is .zip-extension), .lpk, and .lpkx. */
export function isBundleFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.lpk') || lower.endsWith('.lpkx');
}

const LARGE_BUNDLE_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500 MB

/** Return a soft warning string when a bundle is large enough that
 *  server-side inspection may take noticeably long. Null when the file is
 *  comfortably small. */
export function bundleSizeAdvisory(file: File): string | null {
  if (file.size < LARGE_BUNDLE_THRESHOLD_BYTES) return null;
  const sizeMb = (file.size / 1024 / 1024).toFixed(0);
  return `Inspecting a ${sizeMb} MB archive may take a moment...`;
}
