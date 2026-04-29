import { useState, useCallback, useRef, useEffect } from 'react';
import * as datasetsApi from '../../api/datasets';
import * as projectsApi from '../../api/projects';
import { UploadJob, DatasetCategory, GeographicScope, Project, BundleDatasetInput } from '../../api/types';
import { inspectZip, isBundleFile, DetectedDataset } from '../../utils/zipInspector';
import { BundleDatasetList, BundleDatasetRow, rowsFromDetected } from './BundleDatasetList';
import { UploadDropzone } from './UploadDropzone';
import {
  BundleProcessingBar,
  SingleProcessingBar,
  UploadProgressBar,
} from './UploadProgress';

interface Props {
  onSuccess: () => void;
}

type Phase = 'idle' | 'inspecting' | 'uploading' | 'processing' | 'completed' | 'failed';

const POLL_INTERVAL = 2000;
const MAX_POLL_FAILURES = 30;

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
  const [processingProgress, setProcessingProgress] = useState(0);
  const [bundleSummary, setBundleSummary] = useState<{ total: number; completed: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRefs = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(() => {
    projectsApi.getProjects().then((r) => setProjects(r.projects)).catch((e) => console.warn('Failed to load projects:', e));
  }, []);

  useEffect(() => {
    return () => stopAllPolling();
  }, []);

  const stopAllPolling = () => {
    pollRefs.current.forEach((id) => clearInterval(id));
    pollRefs.current = [];
  };

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
    setProcessingProgress(0);
    setBundleSummary(null);
    setError(null);
  }, []);

  // Poll a single job until it completes or fails
  const pollJob = (jobId: string): Promise<UploadJob> =>
    new Promise((resolve, reject) => {
      let failures = 0;
      const id = setInterval(async () => {
        try {
          const job = await datasetsApi.getUploadJobStatus(jobId);
          failures = 0;
          if (job.status === 'completed' || job.status === 'failed') {
            clearInterval(id);
            pollRefs.current = pollRefs.current.filter((x) => x !== id);
            resolve(job);
          }
        } catch {
          failures++;
          if (failures >= MAX_POLL_FAILURES) {
            clearInterval(id);
            pollRefs.current = pollRefs.current.filter((x) => x !== id);
            reject(new Error('Lost connection to server'));
          }
        }
      }, POLL_INTERVAL);
      pollRefs.current.push(id);
    });

  // Single-dataset processing poll — updates progress and resolves phase
  const pollSingleJob = (jobId: string) => {
    let failures = 0;
    const id = setInterval(async () => {
      try {
        const job = await datasetsApi.getUploadJobStatus(jobId);
        failures = 0;
        setProcessingProgress(job.progress);
        if (job.status === 'completed') {
          clearInterval(id);
          pollRefs.current = pollRefs.current.filter((x) => x !== id);
          setPhase('completed');
          setTimeout(() => {
            resetForm();
            onSuccess();
          }, 1500);
        } else if (job.status === 'failed') {
          clearInterval(id);
          pollRefs.current = pollRefs.current.filter((x) => x !== id);
          setPhase('failed');
          setError(job.error_message || 'Processing failed');
        }
      } catch {
        failures++;
        if (failures >= MAX_POLL_FAILURES) {
          clearInterval(id);
          pollRefs.current = pollRefs.current.filter((x) => x !== id);
          setPhase('failed');
          setError('Lost connection to server. Processing may still be running — check the dataset list.');
        }
      }
    }, POLL_INTERVAL);
    pollRefs.current.push(id);
  };

  // Bundle-level processing poll — watches all jobs in parallel
  const pollBundleJobs = (jobs: UploadJob[]) => {
    const total = jobs.length;
    let completed = 0;
    let failed = 0;
    setBundleSummary({ total, completed: 0, failed: 0 });

    Promise.all(
      jobs.map((j) =>
        pollJob(j.id).then((result) => {
          if (result.status === 'completed') completed++;
          else failed++;
          setBundleSummary({ total, completed, failed });
          return result;
        }).catch(() => {
          failed++;
          setBundleSummary({ total, completed, failed });
        }),
      ),
    ).then(() => {
      if (failed === 0) {
        setPhase('completed');
        setTimeout(() => {
          resetForm();
          onSuccess();
        }, 2000);
      } else {
        setPhase(completed > 0 ? 'completed' : 'failed');
        if (completed === 0) {
          setError(`All ${total} datasets failed to process.`);
        }
      }
    });
  };

  const handleFileSelected = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setBundleRows(null);
    setError(null);
    if (!name) {
      setName(selectedFile.name.replace(/\.[^/.]+$/, ''));
    }

    // ZIP / .gdb.zip / .lpk / .lpkx all flow through bundle inspection.
    if (isBundleFile(selectedFile.name)) {
      setPhase('inspecting');
      try {
        const detected = await inspectZip(selectedFile);
        if (detected.length > 1) {
          setBundleRows(rowsFromDetected(detected));
        } else if (detected.length === 1) {
          // Single dataset: prefill name from detected, stay in single-file flow
          setName(detected[0].suggestedName);
          setBundleRows(null);
        } else {
          setError('No recognized datasets found in the archive.');
        }
      } catch (err) {
        // Client-side inspection can't read .gdb / .lpk contents; fall back
        // to the server-side endpoint, which uses GDAL to enumerate layers.
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
          } else {
            setError('No recognized datasets found in the archive.');
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to inspect archive.');
          console.warn('Server-side inspection failed:', err, e);
        }
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
        pollBundleJobs(resp.jobs);
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
          try {
            const detail = await datasetsApi.getBundleStatus(recovered.bundle_id);
            pollBundleJobs(
              detail.jobs.map((j) => ({
                id: j.id,
                dataset_id: j.dataset_id,
                bundle_id: recovered.bundle_id,
                status: j.status,
                progress: j.progress,
                error_message: j.error_message,
                created_at: j.created_at,
                completed_at: j.completed_at,
              })),
            );
          } catch (pollErr) {
            setPhase('failed');
            setError(
              'Upload completed but tracking failed. Reload the Catalog — some datasets may have been created.',
            );
            console.error('Bundle recovery polling error:', pollErr);
          }
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
    setProcessingProgress(0);
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

      let job: UploadJob;
      if (isRasterFile(file.name)) {
        job = await datasetsApi.uploadRaster(file, name, description, onUploadProgress, uploadOpts);
      } else {
        job = await datasetsApi.uploadVector(file, name, description, onUploadProgress, uploadOpts);
      }

      setPhase('processing');
      setProcessingProgress(job.progress);
      pollSingleJob(job.id);
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    }
  };

  const handleReset = () => {
    stopAllPolling();
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
