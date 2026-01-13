import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import * as datasetsApi from '../../api/datasets';

interface Props {
  onSuccess: () => void;
}

const ACCEPTED_VECTOR = {
  'application/json': ['.geojson', '.json'],
  'application/geopackage+sqlite3': ['.gpkg'],
  'application/zip': ['.zip'],
};

const ACCEPTED_RASTER = {
  'image/tiff': ['.tif', '.tiff'],
};

export function UploadForm({ onSuccess }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0];
      setFile(selectedFile);
      if (!name) {
        setName(selectedFile.name.replace(/\.[^/.]+$/, ''));
      }
      setError(null);
    }
  }, [name]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { ...ACCEPTED_VECTOR, ...ACCEPTED_RASTER },
    maxFiles: 1,
  });

  const isRasterFile = (filename: string): boolean => {
    const ext = filename.toLowerCase().split('.').pop();
    return ['tif', 'tiff', 'geotiff'].includes(ext || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      setError('Please select a file');
      return;
    }

    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      if (isRasterFile(file.name)) {
        await datasetsApi.uploadRaster(file, name, description);
      } else {
        await datasetsApi.uploadVector(file, name, description);
      }

      setName('');
      setDescription('');
      setFile(null);
      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Upload failed. Please try again.'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-blue-500 bg-blue-50'
            : file
            ? 'border-green-500 bg-green-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        {file ? (
          <div>
            <p className="text-green-600 font-medium">{file.name}</p>
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
              Supported: GeoJSON, Shapefile (ZIP), GeoPackage, GeoTIFF
            </p>
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Dataset Name
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter dataset name"
        />
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Description (optional)
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter description"
        />
      </div>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={uploading || !file}
        className={`w-full py-2 px-4 rounded-md font-medium text-white transition-colors ${
          uploading || !file
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {uploading ? 'Uploading...' : 'Upload Dataset'}
      </button>
    </form>
  );
}
