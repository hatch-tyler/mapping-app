interface UploadProps {
  /** 0–100. */
  percent: number;
}

/** Blue progress bar shown during the file-upload phase. */
export function UploadProgressBar({ percent }: UploadProps) {
  return (
    <div>
      <div className="flex justify-between text-sm text-blue-700 mb-1">
        <span>Uploading file...</span>
        <span>{percent}%</span>
      </div>
      <div className="w-full bg-blue-100 rounded-full h-3">
        <div
          className="bg-blue-600 h-3 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface SingleProcessingProps {
  /** 0–100. */
  percent: number;
}

/** Green progress bar shown while a single dataset is being processed
 *  server-side. Includes the "you can close this page" reassurance. */
export function SingleProcessingBar({ percent }: SingleProcessingProps) {
  return (
    <div>
      <div className="flex justify-between text-sm text-green-700 mb-1">
        <span>Processing dataset...</span>
        <span>{percent}%</span>
      </div>
      <div className="w-full bg-green-100 rounded-full h-3">
        <div
          className="bg-green-600 h-3 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">
        You can close this page. Processing will continue on the server.
      </p>
    </div>
  );
}

interface BundleProcessingProps {
  total: number;
  completed: number;
  failed: number;
}

/** Green progress bar for a bundle: shows "X of Y (Z failed)". */
export function BundleProcessingBar({
  total,
  completed,
  failed,
}: BundleProcessingProps) {
  const done = completed + failed;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm text-green-700 mb-1">
        <span>Processing datasets...</span>
        <span>
          {done} of {total}
          {failed > 0 && ` (${failed} failed)`}
        </span>
      </div>
      <div className="w-full bg-green-100 rounded-full h-3">
        <div
          className="bg-green-600 h-3 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">
        You can close this page. Processing will continue on the server.
      </p>
    </div>
  );
}
