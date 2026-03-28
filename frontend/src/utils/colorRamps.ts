import { RGBAColor } from '../api/types';

export interface ColorRamp {
  name: string;
  label: string;
  type: 'sequential' | 'diverging' | 'colorblind-safe';
  colors: RGBAColor[];
}

// Sequential color ramps (light to dark)
export const COLOR_RAMPS: ColorRamp[] = [
  {
    name: 'viridis',
    label: 'Viridis',
    type: 'sequential',
    colors: [
      [68, 1, 84, 255],
      [72, 40, 120, 255],
      [62, 74, 137, 255],
      [49, 104, 142, 255],
      [38, 130, 142, 255],
      [31, 158, 137, 255],
      [53, 183, 121, 255],
      [109, 205, 89, 255],
      [180, 222, 44, 255],
      [253, 231, 37, 255],
    ],
  },
  {
    name: 'blues',
    label: 'Blues',
    type: 'sequential',
    colors: [
      [247, 251, 255, 255],
      [222, 235, 247, 255],
      [198, 219, 239, 255],
      [158, 202, 225, 255],
      [107, 174, 214, 255],
      [66, 146, 198, 255],
      [33, 113, 181, 255],
      [8, 81, 156, 255],
      [8, 48, 107, 255],
    ],
  },
  {
    name: 'greens',
    label: 'Greens',
    type: 'sequential',
    colors: [
      [247, 252, 245, 255],
      [229, 245, 224, 255],
      [199, 233, 192, 255],
      [161, 217, 155, 255],
      [116, 196, 118, 255],
      [65, 171, 93, 255],
      [35, 139, 69, 255],
      [0, 109, 44, 255],
      [0, 68, 27, 255],
    ],
  },
  {
    name: 'reds',
    label: 'Reds',
    type: 'sequential',
    colors: [
      [255, 245, 240, 255],
      [254, 224, 210, 255],
      [252, 187, 161, 255],
      [252, 146, 114, 255],
      [251, 106, 74, 255],
      [239, 59, 44, 255],
      [203, 24, 29, 255],
      [165, 15, 21, 255],
      [103, 0, 13, 255],
    ],
  },
  {
    name: 'oranges',
    label: 'Oranges',
    type: 'sequential',
    colors: [
      [255, 245, 235, 255],
      [254, 230, 206, 255],
      [253, 208, 162, 255],
      [253, 174, 107, 255],
      [253, 141, 60, 255],
      [241, 105, 19, 255],
      [217, 72, 1, 255],
      [166, 54, 3, 255],
      [127, 39, 4, 255],
    ],
  },
  {
    name: 'purples',
    label: 'Purples',
    type: 'sequential',
    colors: [
      [252, 251, 253, 255],
      [239, 237, 245, 255],
      [218, 218, 235, 255],
      [188, 189, 220, 255],
      [158, 154, 200, 255],
      [128, 125, 186, 255],
      [106, 81, 163, 255],
      [84, 39, 143, 255],
      [63, 0, 125, 255],
    ],
  },
  // Diverging color ramps
  {
    name: 'rdylgn',
    label: 'Red-Yellow-Green',
    type: 'diverging',
    colors: [
      [165, 0, 38, 255],
      [215, 48, 39, 255],
      [244, 109, 67, 255],
      [253, 174, 97, 255],
      [254, 224, 139, 255],
      [255, 255, 191, 255],
      [217, 239, 139, 255],
      [166, 217, 106, 255],
      [102, 189, 99, 255],
      [26, 152, 80, 255],
      [0, 104, 55, 255],
    ],
  },
  {
    name: 'rdbu',
    label: 'Red-Blue',
    type: 'diverging',
    colors: [
      [103, 0, 31, 255],
      [178, 24, 43, 255],
      [214, 96, 77, 255],
      [244, 165, 130, 255],
      [253, 219, 199, 255],
      [247, 247, 247, 255],
      [209, 229, 240, 255],
      [146, 197, 222, 255],
      [67, 147, 195, 255],
      [33, 102, 172, 255],
      [5, 48, 97, 255],
    ],
  },
  {
    name: 'spectral',
    label: 'Spectral',
    type: 'diverging',
    colors: [
      [158, 1, 66, 255],
      [213, 62, 79, 255],
      [244, 109, 67, 255],
      [253, 174, 97, 255],
      [254, 224, 139, 255],
      [255, 255, 191, 255],
      [230, 245, 152, 255],
      [171, 221, 164, 255],
      [102, 194, 165, 255],
      [50, 136, 189, 255],
      [94, 79, 162, 255],
    ],
  },
  // Colorblind-safe sequential ramps
  {
    name: 'cividis',
    label: 'Cividis',
    type: 'colorblind-safe',
    colors: [
      [0, 32, 77, 255],
      [0, 67, 106, 255],
      [54, 92, 108, 255],
      [91, 112, 108, 255],
      [126, 132, 107, 255],
      [163, 152, 97, 255],
      [199, 174, 73, 255],
      [229, 199, 44, 255],
      [253, 231, 37, 255],
    ],
  },
  {
    name: 'inferno',
    label: 'Inferno',
    type: 'colorblind-safe',
    colors: [
      [0, 0, 4, 255],
      [40, 11, 84, 255],
      [101, 21, 110, 255],
      [159, 42, 99, 255],
      [212, 72, 66, 255],
      [245, 125, 21, 255],
      [250, 186, 12, 255],
      [237, 239, 93, 255],
      [252, 255, 164, 255],
    ],
  },
  {
    name: 'plasma',
    label: 'Plasma',
    type: 'colorblind-safe',
    colors: [
      [13, 8, 135, 255],
      [75, 3, 161, 255],
      [126, 3, 168, 255],
      [168, 34, 150, 255],
      [204, 71, 120, 255],
      [230, 111, 81, 255],
      [248, 159, 28, 255],
      [240, 210, 35, 255],
      [240, 249, 33, 255],
    ],
  },
  // Colorblind-safe diverging
  {
    name: 'puor',
    label: 'Purple-Orange',
    type: 'colorblind-safe',
    colors: [
      [45, 0, 75, 255],
      [84, 39, 136, 255],
      [128, 115, 172, 255],
      [178, 171, 210, 255],
      [216, 218, 235, 255],
      [247, 247, 247, 255],
      [254, 224, 182, 255],
      [253, 184, 99, 255],
      [224, 130, 20, 255],
      [179, 88, 6, 255],
      [127, 59, 8, 255],
    ],
  },
  {
    name: 'brtl',
    label: 'Brown-Teal',
    type: 'colorblind-safe',
    colors: [
      [84, 48, 5, 255],
      [140, 81, 10, 255],
      [191, 129, 45, 255],
      [223, 194, 125, 255],
      [246, 232, 195, 255],
      [245, 245, 245, 255],
      [199, 234, 229, 255],
      [128, 205, 193, 255],
      [53, 151, 143, 255],
      [1, 102, 94, 255],
      [0, 60, 48, 255],
    ],
  },
];

export function getColorRamp(name: string): ColorRamp | undefined {
  return COLOR_RAMPS.find((ramp) => ramp.name === name);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c1: RGBAColor, c2: RGBAColor, t: number): RGBAColor {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
    Math.round(lerp(c1[3], c2[3], t)),
  ];
}

export function interpolateRamp(rampName: string, t: number): RGBAColor {
  const ramp = getColorRamp(rampName);
  if (!ramp) {
    return [128, 128, 128, 255]; // Gray fallback
  }

  const clampedT = Math.max(0, Math.min(1, t));
  const colors = ramp.colors;
  const numColors = colors.length;

  if (numColors === 0) {
    return [128, 128, 128, 255];
  }

  if (numColors === 1) {
    return colors[0];
  }

  const scaledT = clampedT * (numColors - 1);
  const lowerIndex = Math.floor(scaledT);
  const upperIndex = Math.min(lowerIndex + 1, numColors - 1);
  const localT = scaledT - lowerIndex;

  return lerpColor(colors[lowerIndex], colors[upperIndex], localT);
}

export function normalizeValue(
  value: number,
  min: number,
  max: number
): number {
  if (max === min) {
    return 0.5;
  }
  return (value - min) / (max - min);
}

export function generateRampPreview(rampName: string, width: number): RGBAColor[] {
  const colors: RGBAColor[] = [];
  for (let i = 0; i < width; i++) {
    const t = i / (width - 1);
    colors.push(interpolateRamp(rampName, t));
  }
  return colors;
}

// Named categorical palettes
export interface CategoricalPalette {
  name: string;
  label: string;
  colors: RGBAColor[];
}

export const CATEGORICAL_PALETTES: CategoricalPalette[] = [
  {
    name: 'default',
    label: 'Default',
    colors: [
      [66, 133, 244, 200],   // Blue
      [52, 168, 83, 200],    // Green
      [251, 188, 4, 200],    // Yellow
      [234, 67, 53, 200],    // Red
      [154, 160, 166, 200],  // Gray
      [255, 112, 67, 200],   // Deep Orange
      [0, 172, 193, 200],    // Cyan
      [124, 77, 255, 200],   // Purple
      [233, 30, 99, 200],    // Pink
      [0, 150, 136, 200],    // Teal
      [255, 193, 7, 200],    // Amber
      [63, 81, 181, 200],    // Indigo
    ],
  },
  {
    name: 'okabe-ito',
    label: 'Okabe-Ito (Colorblind-Safe)',
    colors: [
      [230, 159, 0, 200],    // Orange
      [86, 180, 233, 200],   // Sky Blue
      [0, 158, 115, 200],    // Bluish Green
      [240, 228, 66, 200],   // Yellow
      [0, 114, 178, 200],    // Blue
      [213, 94, 0, 200],     // Vermilion
      [204, 121, 167, 200],  // Reddish Purple
      [0, 0, 0, 200],        // Black
    ],
  },
  {
    name: 'colorbrewer-set2',
    label: 'ColorBrewer Set2',
    colors: [
      [102, 194, 165, 200],
      [252, 141, 98, 200],
      [141, 160, 203, 200],
      [231, 138, 195, 200],
      [166, 216, 84, 200],
      [255, 217, 47, 200],
      [229, 196, 148, 200],
      [179, 179, 179, 200],
    ],
  },
  {
    name: 'wong',
    label: 'Wong (Nature Methods)',
    colors: [
      [0, 114, 178, 200],    // Blue
      [230, 159, 0, 200],    // Orange
      [0, 158, 115, 200],    // Green
      [204, 121, 167, 200],  // Pink
      [86, 180, 233, 200],   // Light Blue
      [213, 94, 0, 200],     // Red
      [240, 228, 66, 200],   // Yellow
    ],
  },
  {
    name: 'bold',
    label: 'Bold',
    colors: [
      [31, 119, 180, 200],
      [255, 127, 14, 200],
      [44, 160, 44, 200],
      [214, 39, 40, 200],
      [148, 103, 189, 200],
      [140, 86, 75, 200],
      [227, 119, 194, 200],
      [127, 127, 127, 200],
      [188, 189, 34, 200],
      [23, 190, 207, 200],
    ],
  },
  {
    name: 'pastel',
    label: 'Pastel',
    colors: [
      [174, 199, 232, 200],
      [255, 187, 120, 200],
      [152, 223, 138, 200],
      [255, 152, 150, 200],
      [197, 176, 213, 200],
      [196, 156, 148, 200],
      [247, 182, 210, 200],
      [199, 199, 199, 200],
      [219, 219, 141, 200],
      [158, 218, 229, 200],
    ],
  },
];

// Default category colors for auto-assignment
export const CATEGORY_PALETTE: RGBAColor[] = CATEGORICAL_PALETTES[0].colors;

export function getCategoryColor(index: number, paletteName?: string): RGBAColor {
  const palette = paletteName
    ? CATEGORICAL_PALETTES.find(p => p.name === paletteName)?.colors || CATEGORY_PALETTE
    : CATEGORY_PALETTE;
  return palette[index % palette.length];
}
