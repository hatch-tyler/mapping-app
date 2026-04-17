import { DetectedDataset } from '../../utils/zipInspector';

export interface BundleDatasetRow {
  primaryFile: string;
  dataType: 'vector' | 'raster';
  format: string;
  include: boolean;
  name: string;
  description: string;
  warnings: string[];
}

interface Props {
  rows: BundleDatasetRow[];
  onChange: (rows: BundleDatasetRow[]) => void;
  disabled?: boolean;
}

export function rowsFromDetected(detected: DetectedDataset[]): BundleDatasetRow[] {
  return detected.map((d) => ({
    primaryFile: d.primaryFile,
    dataType: d.dataType,
    format: d.format,
    include: d.warnings.every((w) => !w.toLowerCase().includes('missing required')),
    name: d.suggestedName,
    description: '',
    warnings: d.warnings,
  }));
}

export function BundleDatasetList({ rows, onChange, disabled }: Props) {
  const update = (primaryFile: string, patch: Partial<BundleDatasetRow>) => {
    onChange(rows.map((r) => (r.primaryFile === primaryFile ? { ...r, ...patch } : r)));
  };

  const includedCount = rows.filter((r) => r.include).length;

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 text-sm text-gray-700 border-b border-gray-200">
        Detected <strong>{rows.length}</strong> dataset{rows.length === 1 ? '' : 's'} — {includedCount} selected
      </div>
      <ul className="divide-y divide-gray-200">
        {rows.map((row) => {
          const blocking = row.warnings.some((w) =>
            w.toLowerCase().includes('missing required'),
          );
          return (
            <li key={row.primaryFile} className="p-3 space-y-2">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={row.include}
                  onChange={(e) => update(row.primaryFile, { include: e.target.checked })}
                  disabled={disabled || blocking}
                  className="mt-1"
                  aria-label={`Include ${row.primaryFile}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs text-gray-600 truncate" title={row.primaryFile}>
                      {row.primaryFile}
                    </code>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        row.dataType === 'raster'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {row.dataType} · {row.format}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => update(row.primaryFile, { name: e.target.value })}
                    disabled={disabled || !row.include}
                    placeholder="Dataset name"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                  />
                  <input
                    type="text"
                    value={row.description}
                    onChange={(e) => update(row.primaryFile, { description: e.target.value })}
                    disabled={disabled || !row.include}
                    placeholder="Description (optional)"
                    className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                  />
                  {row.warnings.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {row.warnings.map((w, i) => (
                        <li
                          key={i}
                          className={`text-xs ${
                            w.toLowerCase().includes('missing required') ||
                            w.toLowerCase().includes('will fail')
                              ? 'text-red-600 font-medium'
                              : 'text-amber-600'
                          }`}
                        >
                          ⚠ {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
