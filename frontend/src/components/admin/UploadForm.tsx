import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import * as datasetsApi from '../../api/datasets';
import { UploadJob } from '../../api/types';

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

type Phase = 'idle' | 'uploading' | 'processing' | 'completed' | 'failed';

const POLL_INTERVAL = 2000;

export function UploadForm({ onSuccess }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const job = await datasetsApi.getUploadJobStatus(jobId);
        setProcessingProgress(job.progress);

        if (job.status === 'completed') {
          stopPolling();
          setPhase('completed');
          // Reset form after brief delay so user sees success
          setTimeout(() => {
            setName('');
            setDescription('');
            setFile(null);
            setPhase('idle');
            setUploadProgress(0);
            setProcessingProgress(0);
            onSuccess();
          }, 1500);
        } else if (job.status === 'failed') {
          stopPolling();
          setPhase('failed');
          setError(job.error_message || 'Processing failed');
        }
      } catch {
        // Polling error -- keep trying, don't abort
      }
    }, POLL_INTERVAL);
  };

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

    setPhase('uploading');
    setUploadProgress(0);
    setProcessingProgress(0);
    setError(null);

    try {
      const onUploadProgress = (event: { loaded?: number; total?: number }) => {
        if (event.total) {
          setUploadProgress(Math.round((event.loaded ?? 0) / event.total * 100));
        }
      };

      let job: UploadJob;
      if (isRasterFile(file.name)) {
        job = await datasetsApi.uploadRaster(file, name, description, onUploadProgress);
      } else {
        job = await datasetsApi.uploadVector(file, name, description, onUploadProgress);
      }

      // Phase 2: processing
      setPhase('processing');
      setProcessingProgress(job.progress);
      startPolling(job.id);
    } catch (err) {
      setPhase('failed');
      const message =
        err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setError(message);
    }
  };

  const handleReset = () => {
    stopPolling();
    setPhase('idle');
    setUploadProgress(0);
    setProcessingProgress(0);
    setError(null);
  };

  const busy = phase === 'uploading' || phase === 'processing';

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
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input {...getInputProps()} disabled={busy} />
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
          disabled={busy}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
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
          disabled={busy}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          placeholder="Enter description"
        />
      </div>

      {/* Upload progress bar */}
      {phase === 'uploading' && (
        <div>
          <div className="flex justify-between text-sm text-blue-700 mb-1">
            <span>Uploading file...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-3">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Processing progress bar */}
      {phase === 'processing' && (
        <div>
          <div className="flex justify-between text-sm text-green-700 mb-1">
            <span>Processing dataset...</span>
            <span>{processingProgress}%</span>
          </div>
          <div className="w-full bg-green-100 rounded-full h-3">
            <div
              className="bg-green-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${processingProgress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            You can close this page. Processing will continue on the server.
          </p>
        </div>
      )}

      {/* Completed message */}
      {phase === 'completed' && (
        <div className="text-green-700 text-sm bg-green-50 p-3 rounded-md">
          Dataset uploaded and processed successfully.
        </div>
      )}

      {/* Error / failed */}
      {error && (
        <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !file || phase === 'completed'}
          className={`flex-1 py-2 px-4 rounded-md font-medium text-white transition-colors ${
            busy || !file || phase === 'completed'
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {phase === 'uploading'
            ? 'Uploading...'
            : phase === 'processing'
            ? 'Processing...'
            : 'Upload Dataset'}
        </button>
        {phase === 'failed' && (
          <button
            type="button"
            onClick={handleReset}
            className="py-2 px-4 rounded-md font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
    </form>
  );
}
