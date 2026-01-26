import { useState } from 'react';

interface Props {
  label: string;
  url: string;
  description?: string;
}

export function ServiceUrlCard({ label, url, description }: Props) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-900">{label}</span>
        <button
          onClick={copyToClipboard}
          className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <input
        type="text"
        readOnly
        value={url}
        className="w-full px-2 py-1.5 text-xs font-mono bg-gray-50 border border-gray-200 rounded text-gray-700 truncate"
      />
      {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
    </div>
  );
}
