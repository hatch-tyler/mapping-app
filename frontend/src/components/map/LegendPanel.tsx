import { Legend } from './Legend';

export function LegendPanel() {
  return (
    <div className="absolute top-12 left-11 bottom-0 w-[340px] bg-white/95 backdrop-blur-sm border-r border-gray-200 z-10 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 shrink-0">
        <h3 className="font-semibold text-gray-700 text-sm">Legend</h3>
      </div>

      {/* Scrollable legend content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <Legend />
      </div>
    </div>
  );
}
