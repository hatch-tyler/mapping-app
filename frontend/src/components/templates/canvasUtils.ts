import type { LayoutElement, DisplayUnit } from '@/api/templates';

export const MM_PER_INCH = 25.4;

export function toDisplayUnits(mm: number, unit: DisplayUnit): number {
  return unit === 'in' ? mm / MM_PER_INCH : mm;
}

export function fromDisplayUnits(value: number, unit: DisplayUnit): number {
  return unit === 'in' ? value * MM_PER_INCH : value;
}

export function formatDimension(mm: number, unit: DisplayUnit): string {
  if (unit === 'in') {
    return (mm / MM_PER_INCH).toFixed(3);
  }
  return mm.toFixed(1);
}

export function formatPageLabel(widthMm: number, heightMm: number, unit: DisplayUnit): string {
  if (unit === 'in') {
    return `${(widthMm / MM_PER_INCH).toFixed(1)} x ${(heightMm / MM_PER_INCH).toFixed(1)} in`;
  }
  return `${widthMm.toFixed(0)} x ${heightMm.toFixed(0)} mm`;
}

export const PAGE_PRESETS = {
  letter_landscape: { width: 279.4, height: 215.9, orientation: 'landscape' as const, label: 'Letter Landscape' },
  letter_portrait: { width: 215.9, height: 279.4, orientation: 'portrait' as const, label: 'Letter Portrait' },
  tabloid_landscape: { width: 431.8, height: 279.4, orientation: 'landscape' as const, label: 'Tabloid Landscape' },
  tabloid_portrait: { width: 279.4, height: 431.8, orientation: 'portrait' as const, label: 'Tabloid Portrait' },
  a3_landscape: { width: 420, height: 297, orientation: 'landscape' as const, label: 'A3 Landscape' },
  a3_portrait: { width: 297, height: 420, orientation: 'portrait' as const, label: 'A3 Portrait' },
  a4_landscape: { width: 297, height: 210, orientation: 'landscape' as const, label: 'A4 Landscape' },
  a4_portrait: { width: 210, height: 297, orientation: 'portrait' as const, label: 'A4 Portrait' },
};

export type PagePresetKey = keyof typeof PAGE_PRESETS;

export const DEFAULT_MARGINS = { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 }; // 1 inch in mm

export const ELEMENT_LABELS: Record<LayoutElement['type'], string> = {
  map_frame: 'Map Frame',
  title: 'Title',
  legend: 'Legend',
  scale_bar: 'Scale Bar',
  north_arrow: 'North Arrow',
  logo: 'Logo',
  text: 'Text',
  horizontal_rule: 'Horizontal Rule',
  header_decorator: 'Header',
  footer_decorator: 'Footer',
};

export const ELEMENT_ICONS: Record<LayoutElement['type'], string> = {
  map_frame: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  title: 'M4 6h16M4 12h8m-8 6h16',
  legend: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  scale_bar: 'M4 20h16M4 20V4m0 16h16V4H4',
  north_arrow: 'M5 15l7-13 7 13M12 2v20',
  logo: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  text: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  horizontal_rule: 'M4 12h16',
  header_decorator: 'M4 5h16v4H4V5z',
  footer_decorator: 'M4 15h16v4H4v-4z',
};

export const MIN_ELEMENT_SIZE = { w: 5, h: 3 }; // mm

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function clampPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  pageW: number,
  pageH: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, pageW - w)),
    y: Math.max(0, Math.min(y, pageH - h)),
  };
}

export function getDefaultElement(type: LayoutElement['type'], pageW: number, pageH: number): LayoutElement {
  const defaults: Record<LayoutElement['type'], Partial<LayoutElement>> = {
    map_frame: { x: 25.4, y: 38, w: pageW - 101.6, h: pageH - 63.5 },
    title: { x: 25.4, y: 12.7, w: pageW - 50.8, h: 19, text: 'Map Title', fontSize: 24 },
    legend: { x: pageW - 76.2, y: 38, w: 50.8, h: 76.2 },
    scale_bar: { x: 25.4, y: pageH - 25.4, w: 76.2, h: 12.7, units: 'feet' },
    north_arrow: { x: pageW - 38, y: pageH - 50.8, w: 19, h: 25.4 },
    logo: { x: 25.4, y: pageH - 25.4, w: 25.4, h: 19 },
    text: { x: 25.4, y: pageH - 38, w: 50.8, h: 12.7, text: 'Text' },
    horizontal_rule: { x: 25.4, y: pageH / 2, w: pageW - 50.8, h: 1, thickness: 0.5, color: '#000000' },
    header_decorator: { x: 0, y: 0, w: pageW, h: 12.7, color: '#1e40af' },
    footer_decorator: { x: 0, y: pageH - 12.7, w: pageW, h: 12.7, color: '#1e40af' },
  };

  return { type, ...defaults[type] } as LayoutElement;
}

export function getDefaultElements(pageW: number, pageH: number): LayoutElement[] {
  return [
    getDefaultElement('map_frame', pageW, pageH),
    getDefaultElement('title', pageW, pageH),
    getDefaultElement('legend', pageW, pageH),
    getDefaultElement('scale_bar', pageW, pageH),
    getDefaultElement('north_arrow', pageW, pageH),
  ];
}
