import { RGBAColor } from '../../api/types';
import { rgbaToHex, hexToRgba, rgbaToString } from '../../utils/styleInterpreter';

interface Props {
  label: string;
  color: RGBAColor;
  onChange: (color: RGBAColor) => void;
  showOpacity?: boolean;
}

export function ColorPicker({ label, color, onChange, showOpacity = true }: Props) {
  const hexColor = rgbaToHex(color);
  const opacity = color[3];

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = hexToRgba(e.target.value, opacity);
    onChange(newColor);
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newOpacity = parseInt(e.target.value, 10);
    onChange([color[0], color[1], color[2], newOpacity]);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={hexColor}
            onChange={handleColorChange}
            className="w-10 h-10 rounded cursor-pointer border border-gray-300"
          />
          <div
            className="w-10 h-10 rounded border border-gray-300"
            style={{ backgroundColor: rgbaToString(color) }}
            title="Preview with opacity"
          />
        </div>
        {showOpacity && (
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="255"
                value={opacity}
                onChange={handleOpacityChange}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-sm text-gray-600 w-12 text-right">
                {Math.round((opacity / 255) * 100)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
