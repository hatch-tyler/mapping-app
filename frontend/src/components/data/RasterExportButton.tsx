import { useState, useRef, useEffect } from 'react';
import { getRasterExportUrl } from '../../api/datasets';
import { getAccessToken } from '../../api/tokenService';

interface Props {
  datasetId: string;
  datasetName: string;
}

const FORMATS = [
  { id: 'tif' as const, label: 'GeoTIFF', desc: 'Full quality with CRS', icon: 'text-emerald-600' },
  { id: 'png' as const, label: 'PNG', desc: 'Lossless image', icon: 'text-blue-600' },
  { id: 'jpg' as const, label: 'JPEG', desc: 'Compressed image', icon: 'text-orange-600' },
];

export function RasterExportButton({ datasetId, datasetName }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDownload = async (format: 'tif' | 'png' | 'jpg') => {
    setDownloading(format);
    try {
      const url = getRasterExportUrl(datasetId, format);
      const token = getAccessToken();
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const ext = format === 'jpg' ? 'jpg' : format;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${datasetName}.${ext}`;
      document.body.appendChild(link);
      link.click();
      URL.revokeObjectURL(link.href);
      document.body.removeChild(link);
      setIsOpen(false);
    } catch (err) {
      console.error('Raster export failed:', err);
      const { useToastStore } = await import('../../stores/toastStore');
      useToastStore.getState().addToast('Export failed. Please try again.', 'error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border text-gray-600 bg-white border-gray-300 hover:bg-gray-50"
        title="Download raster"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-44 bg-white rounded-md shadow-lg border border-gray-200 z-50">
          <div className="py-1">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => handleDownload(f.id)}
                disabled={downloading !== null}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <svg className={`w-4 h-4 ${f.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="text-left">
                  <div className="font-medium text-xs">{f.label}</div>
                  <div className="text-[10px] text-gray-500">{f.desc}</div>
                </div>
                {downloading === f.id && (
                  <svg className="w-3.5 h-3.5 animate-spin ml-auto" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
