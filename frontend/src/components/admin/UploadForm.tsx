import { useState, useCallback, useEffect } from 'react';
import * as datasetsApi from '../../api/datasets';
import * as projectsApi from '../../api/projects';
import {
  DatasetCategory,
  GeographicScope,
  Project,
  BundleDatasetInput,
} from '../../api/types';
import { bundleSizeAdvisory, isBundleFile, DetectedDataset } from '../../utils/zipInspector';
import { BundleDatasetList, BundleDatasetRow, rowsFromDetected } from './BundleDatasetList';
import { BundleResultsList } from './BundleResultsList';
import { UploadDropzone } from './UploadDropzone';
import {
  BundleProcessingBar,
  SingleProcessingBar,
  UploadProgressBar,
} from './UploadProgress';
import { usePollJob, usePollBundle } from '../../hooks/usePollJob';

interface Props {
  onSuccess: () => void;
}

type Phase = 'idle' | 'inspecting' | 'uploading' | 'processing' | 'completed' | 'failed';

/** Standard "the upload was rejected before tracking could begin" message.
 *  Surfaced when status polling 404s (the dataset row was cleaned up by the
 *  failure-cleanup path before the first poll). The user shouldn't be told
 *  "check the catalog" — there's nothing there. */
const VANISHED_MESSAGE =
  'The upload was rejected before tracking could begin. Please re-check the file (a missing CRS or invalid archive is the most common cause) and try again.';

/** Status polling truly couldn't reach the server within the budget. */
const LOST_CONNECTION_MESSAGE =
  'Lost connection to server. Processing may still be running — refresh the catalog in a minute to check.';

/** After a failed bundle upload POST, look up the bundle by the client-supplied
 *  nonce — the backend stamps every UploadJob with the nonce before the wire
 *  drops, so an exact-match query reliably finds the partially-committed
 *  bundle without the fragile timestamp-window heuristic this replaces. */
async function tryRecoverBundle(
  clientNonce: string,
): Promise<{ bundle_id: string } | null> {
  try {
    const detail = await datasetsApi.getBundleByNonce(clientNonce);
    return { bundle_id: detail.bundle_id };
  } catch {
    return null;
  }
}

export function UploadForm({ onSuccess }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DatasetCategory>('reference');
  const [geographicScope, setGeographicScope] = useState<GeographicScope | ''>('');
  const [tagsInput, setTagsInput] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [bundleRows, setBundleRows] = useState<BundleDatasetRow[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Polling targets — set to a job/bundle id once the upload POST returns
  // (or recovery succeeds). The shared usePollJob/usePollBundle hooks own
  // the polling loop, including budgeted lost-connection detection and
  // immediate fast-fail on HTTP 404 (job vanished after a fast failure).
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentBundleId, setCurrentBundleId] = useState<string | null>(null);

  const { job: singleJob, status: singleStatus } = usePollJob(currentJobId);
  const {
    detail: bundleResults,
    summary: pollBundleSummary,
    status: bundleStatus,
  } = usePollBundle(currentBundleId);

  // Reuse the live bundle detail for the in-progress summary so the
  // user sees per-dataset progress as it happens.
  const bundleSummary = currentBundleId ? pollBundleSummary : null;
  const processingProgress = singleJob?.progress ?? 0;

  useEffect(() => {
    projectsApi.getProjects().then((r) => setProjects(r.projects)).catch((e) => console.warn('Failed to load projects:', e));
  }, []);

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
    setCategory('reference');
    setGeographicScope('');
    setTagsInput('');
    setProjectId('');
    setFile(null);
    setBundleRows(null);
    setPhase('idle');
    setUploadProgress(0);
    setCurrentJobId(null);
    setCurrentBundleId(null);
    setError(null);
  }, []);

  // ----- Single-job state machine -----------------------------------------
  // The hook drives status; this effect maps it onto the form's phase + the
  // success/failure side effects (auto-reset, error surfacing).
  useEffect(() => {
    if (!currentJobId) return;
    if (singleStatus === 'completed') {
      setPhase('completed');
      const t = setTimeout(() => {
        resetForm();
        onSuccess();
      }, 1500);
      return () => clearTimeout(t);
    }
    if (singleStatus === 'failed') {
      setPhase('failed');
      setError(singleJob?.error_message || 'Processing failed');
    } else if (singleStatus === 'job-vanished') {
      setPhase('failed');
      setError(VANISHED_MESSAGE);
    } else if (singleStatus === 'lost-connection') {
      setPhase('failed');
      setError(LOST_CONNECTION_MESSAGE);
    }
  }, [currentJobId, singleStatus, singleJob?.error_message, resetForm, onSuccess]);

  // ----- Bundle state machine ---------------------------------------------
  useEffect(() => {
    if (!currentBundleId) return;
    if (bundleStatus === 'completed') {
      const total = pollBundleSummary.total;
      const failed = pollBundleSummary.failed;
      const completed = pollBundleSummary.completed;
      if (failed === 0) {
        setPhase('completed');
        // Auto-close after a longer pause when everything succeeded; otherwise
        // leave the per-dataset breakdown on screen for the user to read.
        const t = setTimeout(() => {
          resetForm();
          onSuccess();
        }, 4000);
        return () => clearTimeout(t);
      }
      // Some failed.
      setPhase(completed > 0 ? 'completed' : 'failed');
      if (completed === 0) {
        setError(`All ${total} datasets failed to process.`);
      }
    } else if (bundleStatus === 'failed') {
      // All jobs failed.
      const total = pollBundleSummary.total;
      setPhase('failed');
      setError(`All ${total} datasets failed to process.`);
    } else if (bundleStatus === 'job-vanished') {
      setPhase('failed');
      setError(VANISHED_MESSAGE);
    } else if (bundleStatus === 'lost-connection') {
      setPhase('failed');
      setError(LOST_CONNECTION_MESSAGE);
    }
  }, [
    currentBundleId,
    bundleStatus,
    pollBundleSummary.total,
    pollBundleSummary.completed,
    pollBundleSummary.failed,
    resetForm,
    onSuccess,
  ]);

  const handleFileSelected = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setBundleRows(null);
    setError(null);
    if (!name) {
      setName(selectedFile.name.replace(/\.[^/.]+$/, ''));
    }

    // ZIP / .gdb.zip / .lpk / .lpkx all flow through bundle inspection on
    // the server (the client used to mirror this logic but couldn't handle
    // multi-layer containers without GDAL anyway, so the mirror was dropped).
    if (isBundleFile(selectedFile.name)) {
      setPhase('inspecting');
      const advisory = bundleSizeAdvisory(selectedFile);
      if (advisory) console.info(advisory);
      try {
        const resp = await datasetsApi.inspectBundle(selectedFile);
        const detected: DetectedDataset[] = resp.datasets.map((d) => ({
          suggestedName: d.suggested_name,
          dataType: d.data_type,
          format: d.format,
          primaryFile: d.primary_file,
          memberFiles: d.member_files,
          warnings: d.warnings,
          entryPath: d.entry_path,
          containerPath: d.container_path,
          layerName: d.layer_name,
        }));
        if (detected.length > 1) {
          setBundleRows(rowsFromDetected(detected));
        } else if (detected.length === 1) {
          setName(detected[0].suggestedName);
          setBundleRows(null);
        } else {
          setError('No recognized datasets found in the archive.');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to inspect archive.');
      } finally {
        setPhase('idle');
      }
    }
  }, [name]);

  const isRasterFile = (filename: string): boolean => {
    const ext = filename.toLowerCase().split('.').pop();
    return ['tif', 'tiff', 'geotiff', 'jp2', 'img', 'bil', 'bip', 'bsq', 'flt', 'asc'].includes(ext || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      setError('Please select a file');
      return;
    }

    // Bundle path
    if (bundleRows) {
      const included = bundleRows.filter((r) => r.include);
      if (included.length === 0) {
        setError('Select at least one dataset to upload.');
        return;
      }
      if (included.some((r) => !r.name.trim())) {
        setError('All included datasets must have a name.');
        return;
      }

      setPhase('uploading');
      setUploadProgress(0);
      setError(null);

      const datasets: BundleDatasetInput[] = bundleRows.map((r) => ({
        primary_file: r.primaryFile,
        name: r.name.trim(),
        description: r.description || undefined,
        include: r.include,
        container_path: r.containerPath ?? undefined,
        layer_name: r.layerName ?? undefined,
      }));

      const uploadOpts: datasetsApi.UploadOptions = {
        category,
        geographic_scope: geographicScope || undefined,
        project_id: projectId || undefined,
        tags: tagsInput || undefined,
      };

      // Generate a fresh nonce for this attempt. The backend stamps every
      // UploadJob with it so we can recover the bundle by exact-match lookup
      // if this POST response is lost.
      const clientNonce = crypto.randomUUID();
      try {
        const onUploadProgress = (event: { loaded?: number; total?: number }) => {
          if (event.total) {
            setUploadProgress(Math.round(((event.loaded ?? 0) / event.total) * 100));
          }
        };
        const resp = await datasetsApi.uploadBundle(
          file,
          datasets,
          uploadOpts,
          onUploadProgress,
          clientNonce,
        );
        localStorage.setItem('lastBundleId', resp.bundle_id);
        setPhase('processing');
        setCurrentBundleId(resp.bundle_id);
      } catch (err) {
        // The POST may have failed (502 from an OOM'd worker, dropped
        // connection, etc.) AFTER the backend committed dataset + job rows
        // for at least some of the included datasets. Try to recover via
        // the nonce — the backend stamped it on every UploadJob before
        // the wire dropped.
        const recovered = await tryRecoverBundle(clientNonce);
        if (recovered) {
          localStorage.setItem('lastBundleId', recovered.bundle_id);
          setPhase('processing');
          setCurrentBundleId(recovered.bundle_id);
          return;
        }

        setPhase('failed');
        setError(
          err instanceof Error
            ? `${err.message} — if some datasets show up anyway, the upload partially succeeded.`
            : 'Upload failed. Please try again.',
        );
      }
      return;
    }

    // Single-file path
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }

    setPhase('uploading');
    setUploadProgress(0);
    setError(null);

    try {
      const onUploadProgress = (event: { loaded?: number; total?: number }) => {
        if (event.total) {
          setUploadProgress(Math.round(((event.loaded ?? 0) / event.total) * 100));
        }
      };

      const uploadOpts: datasetsApi.UploadOptions = {
        category,
        geographic_scope: geographicScope || undefined,
        project_id: projectId || undefined,
        tags: tagsInput || undefined,
      };

      const job = isRasterFile(file.name)
        ? await datasetsApi.uploadRaster(file, name, description, onUploadProgress, uploadOpts)
        : await datasetsApi.uploadVector(file, name, description, onUploadProgress, uploadOpts);

      setPhase('processing');
      setCurrentJobId(job.id);
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    }
  };

  const handleReset = () => {
    resetForm();
  };

  const busy = phase === 'uploading' || phase === 'processing' || phase === 'inspecting';
  const isBundle = !!bundleRows;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <UploadDropzone file={file} disabled={busy} onFileSelected={handleFileSelected} />

      {phase === 'inspecting' && (
        <div className="text-sm text-gray-600">Inspecting archive...</div>
      )}

      {isBundle ? (
        <BundleDatasetList rows={bundleRows!} onChange={setBundleRows} disabled={busy} />
      ) : (
        <>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
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
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
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
        </>
      )}

      {/* Category — shared across all datasets in a bundle */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Category {isBundle && <span className="text-xs text-gray-500">(applied to all datasets)</span>}
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="category"
              value="reference"
              checked={category === 'reference'}
              onChange={() => setCategory('reference')}
              disabled={busy}
              className="text-blue-600"
            />
            Reference
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="category"
              value="project"
              checked={category === 'project'}
              onChange={() => { setCategory('project'); setGeographicScope(''); }}
              disabled={busy}
              className="text-blue-600"
            />
            Project
          </label>
        </div>
      </div>

      {category === 'reference' && (
        <div>
          <label htmlFor="geographic-scope" className="block text-sm font-medium text-gray-700 mb-1">
            Geographic Scope
          </label>
          <select
            id="geographic-scope"
            value={geographicScope}
            onChange={(e) => setGeographicScope(e.target.value as GeographicScope | '')}
            disabled={busy}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            <option value="">Select scope (optional)</option>
            <option value="federal">Federal</option>
            <option value="state">State</option>
            <option value="county">County</option>
            <option value="local">Local</option>
          </select>
        </div>
      )}

      {category === 'project' && projects.length > 0 && (
        <div>
          <label htmlFor="project-id" className="block text-sm font-medium text-gray-700 mb-1">
            Project
          </label>
          <select
            id="project-id"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            <option value="">Select project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="tags" className="block text-sm font-medium text-gray-700 mb-1">
          Tags {isBundle && <span className="text-xs text-gray-500">(applied to all datasets)</span>}
        </label>
        <input
          type="text"
          id="tags"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          disabled={busy}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          placeholder="e.g. boundaries, parcels, zoning"
        />
        <p className="text-xs text-gray-400 mt-0.5">Comma-separated</p>
      </div>

      {phase === 'uploading' && <UploadProgressBar percent={uploadProgress} />}

      {phase === 'processing' && !isBundle && (
        <SingleProcessingBar percent={processingProgress} />
      )}

      {phase === 'processing' && isBundle && bundleSummary && (
        <BundleProcessingBar
          total={bundleSummary.total}
          completed={bundleSummary.completed}
          failed={bundleSummary.failed}
        />
      )}

      {phase === 'completed' && !isBundle && (
        <div className="text-green-700 text-sm bg-green-50 p-3 rounded-md">
          Dataset uploaded and processed successfully.
        </div>
      )}

      {phase === 'completed' && isBundle && bundleSummary && (
        <div
          className={`text-sm p-3 rounded-md ${
            bundleSummary.failed > 0
              ? 'text-amber-700 bg-amber-50'
              : 'text-green-700 bg-green-50'
          }`}
        >
          {bundleSummary.failed === 0
            ? `All ${bundleSummary.total} datasets uploaded and processed successfully.`
            : `${bundleSummary.completed} of ${bundleSummary.total} datasets processed successfully, ${bundleSummary.failed} failed.`}
        </div>
      )}

      {/* Per-dataset breakdown — surfaces failure names + error codes so the
          user can identify what to re-upload. Shown for both completed (with
          failures) and fully-failed bundle states. */}
      {(phase === 'completed' || phase === 'failed') && bundleResults && (
        <BundleResultsList bundle={bundleResults} />
      )}

      {error && (
        <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">{error}</div>
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
          {phase === 'inspecting'
            ? 'Inspecting...'
            : phase === 'uploading'
            ? 'Uploading...'
            : phase === 'processing'
            ? 'Processing...'
            : isBundle
            ? `Upload ${bundleRows!.filter((r) => r.include).length} Dataset${bundleRows!.filter((r) => r.include).length === 1 ? '' : 's'}`
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
