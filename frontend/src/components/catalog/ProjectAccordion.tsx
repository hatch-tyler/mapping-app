import { useState } from 'react';
import { Dataset } from '@/api/types';
import { CatalogCard } from './CatalogCard';

interface Props {
  projectId: string;
  projectName: string;
  datasets: Dataset[];
  onViewMetadata: (dataset: Dataset) => void;
}

export function ProjectAccordion({ projectId, projectName, datasets, onViewMetadata }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="px-4 py-3 hover:bg-gray-50 flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          {/* Folder icon */}
          <svg
            className="h-5 w-5 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          <span className="font-bold text-gray-900">{projectName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
            {datasets.length}
          </span>
          {/* Chevron */}
          <svg
            className={`h-4 w-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {datasets.map((dataset) => (
              <CatalogCard
                key={dataset.id}
                dataset={dataset}
                onViewMetadata={onViewMetadata}
                isLinked={dataset.project_id !== projectId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
