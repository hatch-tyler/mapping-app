import { useDropzone } from 'react-dropzone';

const ACCEPTED_VECTOR = {
  'application/json': ['.geojson', '.json'],
  'application/geopackage+sqlite3': ['.gpkg'],
  'application/zip': ['.zip'],
  'application/octet-stream': ['.lpk', '.lpkx'],
};

const ACCEPTED_RASTER = {
  'image/tiff': ['.tif', '.tiff'],
  'image/jp2': ['.jp2'],
  'application/octet-stream': ['.img', '.bil', '.bip', '.bsq', '.flt', '.asc'],
  'application/zip': ['.zip'],
};

interface Props {
  /** Currently selected file, or null if none. */
  file: File | null;
  /** Disable interaction (during inspection / upload). */
  disabled?: boolean;
  /** Called when the user picks or drops a single file. */
  onFileSelected: (file: File) => void;
}

/** File picker + drag-and-drop UX for the upload form.
 *
 *  Owns the accept config, the dropzone styling, and the "selected file"
 *  preview. Stateless beyond what react-dropzone manages internally. */
export function UploadDropzone({ file, disabled, onFileSelected }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => {
      if (accepted.length > 0) onFileSelected(accepted[0]);
    },
    accept: { ...ACCEPTED_VECTOR, ...ACCEPTED_RASTER },
    maxFiles: 1,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
        isDragActive
          ? 'border-blue-500 bg-blue-50'
          : file
          ? 'border-green-500 bg-green-50'
          : 'border-gray-300 hover:border-gray-400'
      } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input {...getInputProps()} disabled={disabled} />
      {file ? (
        <div className="max-w-full overflow-hidden" title={file.name}>
          <p className="text-green-600 font-medium truncate">{file.name}</p>
          <p className="text-gray-500 text-sm mt-1">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
      ) : isDragActive ? (
        <p className="text-blue-600">Drop the file here...</p>
      ) : (
        <div>
          <p className="text-gray-600">
            Drag & drop a file here, or click to select
          </p>
          <p className="text-gray-400 text-sm mt-2">
            Supported: GeoJSON, Shapefile (ZIP), GeoPackage, GeoTIFF, File
            Geodatabase (.gdb.zip), Layer Package (.lpk/.lpkx). ZIPs can
            contain multiple datasets.
          </p>
        </div>
      )}
    </div>
  );
}
