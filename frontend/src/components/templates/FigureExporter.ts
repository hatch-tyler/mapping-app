/**
 * Figure exporter: composites a map screenshot with a template layout
 * to produce a finished figure as PNG or PDF.
 */

import type { LayoutElement, LayoutTemplate } from '@/api/templates';
import type { Dataset, RasterStyleConfig, StyleConfig, RGBAColor } from '@/api/types';
import { getColorRamp, interpolateRamp } from '@/utils/colorRamps';

const MM_TO_PX_300DPI = 300 / 25.4; // ~11.811 px per mm at 300 DPI

export interface FigureExportOptions {
  template: LayoutTemplate;
  mapImage: HTMLCanvasElement;
  visibleDatasets: Dataset[];
  mapZoom: number;
  mapCenter: { latitude: number; longitude: number };
  /** Per-element text overrides keyed by element index in template.elements. */
  textOverrides?: Record<number, string>;
}

/** Capture the map by compositing all canvases in a container element. */
export function captureMapCanvas(container: HTMLElement): HTMLCanvasElement | null {
  const canvases = container.querySelectorAll('canvas');
  if (canvases.length === 0) return null;

  const first = canvases[0] as HTMLCanvasElement;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = first.width;
  exportCanvas.height = first.height;
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) return null;

  canvases.forEach((c) => {
    ctx.drawImage(c as HTMLCanvasElement, 0, 0);
  });

  return exportCanvas;
}

/** Render the complete figure to a canvas at 300 DPI. */
export function renderFigure(options: FigureExportOptions): HTMLCanvasElement {
  const { template, mapImage, visibleDatasets, mapZoom, textOverrides } = options;
  const { page_config, elements } = template;

  const pageW = page_config.width * MM_TO_PX_300DPI;
  const pageH = page_config.height * MM_TO_PX_300DPI;
  const scale = MM_TO_PX_300DPI;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pageW);
  canvas.height = Math.round(pageH);
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Keep original indices so text overrides still map correctly after sorting.
  const indexed = elements.map((elem, idx) => ({ elem, idx }));
  const sorted = [...indexed].sort((a, b) => {
    if (a.elem.type === 'map_frame') return -1;
    if (b.elem.type === 'map_frame') return 1;
    return 0;
  });

  for (const { elem, idx } of sorted) {
    if (isReferenceOnlyHeuristic(elem, template)) continue;

    const x = elem.x * scale;
    const y = elem.y * scale;
    const w = elem.w * scale;
    const h = elem.h * scale;

    ctx.save();

    switch (elem.type) {
      case 'map_frame':
        drawMapFrame(ctx, x, y, w, h, mapImage);
        break;
      case 'text':
      case 'title':
      case 'subtitle': {
        const override = textOverrides?.[idx];
        const effective = override !== undefined ? override : elem.text;
        drawText(ctx, x, y, w, h, { ...elem, text: effective }, scale);
        break;
      }
      case 'legend':
        drawLegend(ctx, x, y, w, h, visibleDatasets, scale);
        break;
      case 'scale_bar':
        drawScaleBar(ctx, x, y, w, h, mapZoom, scale);
        break;
      case 'north_arrow':
        drawNorthArrow(ctx, x, y, w, h);
        break;
      case 'logo':
      case 'image':
        drawImage(ctx, x, y, w, h, elem);
        break;
      case 'shape':
        drawShape(ctx, x, y, w, h);
        break;
      case 'horizontal_rule':
        drawHorizontalRule(ctx, x, y, w, h, elem);
        break;
      default:
        break;
    }

    ctx.restore();
  }

  // Page border
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);

  return canvas;
}

function drawMapFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mapImage: HTMLCanvasElement) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const mapAspect = mapImage.width / mapImage.height;
  const frameAspect = w / h;
  let drawW: number, drawH: number, drawX: number, drawY: number;

  if (mapAspect > frameAspect) {
    drawH = h;
    drawW = h * mapAspect;
    drawX = x + (w - drawW) / 2;
    drawY = y;
  } else {
    drawW = w;
    drawH = w / mapAspect;
    drawX = x;
    drawY = y + (h - drawH) / 2;
  }

  ctx.drawImage(mapImage, drawX, drawY, drawW, drawH);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, elem: LayoutElement, scale: number) {
  const fontSize = (elem.fontSize || 10) * scale * 0.35;
  const fontWeight = elem.fontWeight === 'bold' ? 'bold' : 'normal';
  ctx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = elem.textColor || '#000000';

  const align = elem.textAlign || 'left';
  ctx.textAlign = align as CanvasTextAlign;
  ctx.textBaseline = 'top';

  let textX = x;
  if (align === 'center') textX = x + w / 2;
  else if (align === 'right') textX = x + w;

  const text = elem.text || '';
  const paragraphs = text.split(/\r?\n/);
  let lineY = y + fontSize * 0.2;
  const lineHeight = fontSize * 1.3;

  for (const para of paragraphs) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > w && line) {
        ctx.fillText(line, textX, lineY);
        line = word;
        lineY += lineHeight;
        if (lineY > y + h) return;
      } else {
        line = testLine;
      }
    }
    if (line) {
      if (lineY > y + h) return;
      ctx.fillText(line, textX, lineY);
      lineY += lineHeight;
    }
  }
}

// ---------------------------------------------------------------------------
// Legend rendering
// ---------------------------------------------------------------------------

function rgbaCss(c: RGBAColor): string {
  const a = (c[3] ?? 255) / 255;
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString();
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function drawGradientBar(
  ctx: CanvasRenderingContext2D,
  rampName: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ramp = getColorRamp(rampName);
  if (!ramp) {
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(x, y, w, h);
    return;
  }
  const steps = 64;
  const stepW = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    ctx.fillStyle = rgbaCss(interpolateRamp(rampName, t));
    // +1 avoids sub-pixel gaps between segments.
    ctx.fillRect(x + i * stepW, y, stepW + 1, h);
  }
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);
}

interface LegendMetrics {
  titleFontSize: number;
  fontSize: number;
  smallFontSize: number;
  padding: number;
  swatchSize: number;
  rowHeight: number;
  gradientH: number;
}

function legendMetrics(scale: number): LegendMetrics {
  const titleFontSize = 10 * scale * 0.35;
  const fontSize = 8 * scale * 0.35;
  const smallFontSize = 7 * scale * 0.35;
  return {
    titleFontSize,
    fontSize,
    smallFontSize,
    padding: 4 * scale * 0.35,
    swatchSize: 10 * scale * 0.35,
    rowHeight: 12 * scale * 0.35,
    gradientH: 8 * scale * 0.35,
  };
}

/**
 * Render one dataset's legend entries starting at (x, entryY) within width w.
 * Returns the new y after rendering. Caller is responsible for clipping if
 * entries exceed the caller's bottom.
 */
function renderDatasetLegendEntries(
  ctx: CanvasRenderingContext2D,
  ds: Dataset,
  x: number,
  entryY: number,
  w: number,
  bottom: number,
  m: LegendMetrics,
): number {
  // Dataset name
  ctx.font = `bold ${m.fontSize}px Arial, sans-serif`;
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(truncateToWidth(ctx, ds.name, w), x, entryY);
  entryY += m.fontSize * 1.2 + 2;

  if (entryY >= bottom) return entryY;

  ctx.font = `${m.fontSize}px Arial, sans-serif`;

  if (ds.data_type === 'raster') {
    const cfg = (ds.style_config || {}) as Partial<RasterStyleConfig>;
    if (cfg.raster_mode === 'continuous' && cfg.color_ramp) {
      const barW = Math.min(w, m.swatchSize * 12);
      drawGradientBar(ctx, cfg.color_ramp, x, entryY, barW, m.gradientH);
      entryY += m.gradientH + 2;
      if (entryY + m.smallFontSize <= bottom) {
        ctx.font = `${m.smallFontSize}px Arial, sans-serif`;
        ctx.fillStyle = '#555555';
        ctx.textAlign = 'left';
        ctx.fillText(formatNum(cfg.min_value ?? 0), x, entryY);
        ctx.textAlign = 'right';
        ctx.fillText(formatNum(cfg.max_value ?? 255), x + barW, entryY);
        ctx.textAlign = 'left';
        entryY += m.smallFontSize * 1.2;
      }
    } else if (cfg.raster_mode === 'classified' && cfg.value_map) {
      const entries = Object.entries(cfg.value_map).sort(
        ([a], [b]) => Number(a) - Number(b),
      );
      const maxRows = Math.max(0, Math.floor((bottom - entryY) / m.rowHeight));
      const visible = entries.slice(0, maxRows);
      for (const [, v] of visible) {
        entryY = drawSwatchRow(ctx, x, entryY, w, v.color, v.label, m);
      }
      if (entries.length > visible.length && entryY + m.smallFontSize <= bottom) {
        ctx.font = `italic ${m.smallFontSize}px Arial, sans-serif`;
        ctx.fillStyle = '#888888';
        ctx.fillText(`+${entries.length - visible.length} more`, x, entryY);
        entryY += m.smallFontSize * 1.2;
      }
    } else {
      ctx.fillStyle = '#888888';
      ctx.fillText('Raster layer', x, entryY);
      entryY += m.rowHeight;
    }
    return entryY;
  }

  // Vector
  const cfg = (ds.style_config || {}) as Partial<StyleConfig>;
  const mode = cfg.mode || 'uniform';

  if (mode === 'uniform') {
    const color = (cfg.fillColor as RGBAColor | undefined) || [0, 128, 255, 180];
    entryY = drawSwatchRow(ctx, x, entryY, w, color, 'All features', m);
  } else if (mode === 'categorical' && cfg.categoryColors) {
    if (cfg.attributeField && entryY + m.smallFontSize <= bottom) {
      ctx.font = `italic ${m.smallFontSize}px Arial, sans-serif`;
      ctx.fillStyle = '#666666';
      ctx.fillText(cfg.attributeField, x, entryY);
      entryY += m.smallFontSize * 1.2;
    }
    const entries = Object.entries(cfg.categoryColors);
    const maxRows = Math.max(0, Math.floor((bottom - entryY) / m.rowHeight));
    const visible = entries.slice(0, maxRows);
    ctx.font = `${m.fontSize}px Arial, sans-serif`;
    for (const [value, color] of visible) {
      entryY = drawSwatchRow(ctx, x, entryY, w, color as RGBAColor, value, m);
    }
    if (cfg.defaultCategoryColor && entryY + m.rowHeight <= bottom) {
      entryY = drawSwatchRow(ctx, x, entryY, w, cfg.defaultCategoryColor, 'Other', m);
    }
    if (entries.length > visible.length && entryY + m.smallFontSize <= bottom) {
      ctx.font = `italic ${m.smallFontSize}px Arial, sans-serif`;
      ctx.fillStyle = '#888888';
      ctx.fillText(`+${entries.length - visible.length} more`, x, entryY);
      entryY += m.smallFontSize * 1.2;
    }
  } else if (mode === 'graduated' && cfg.colorRamp) {
    if (cfg.attributeField && entryY + m.smallFontSize <= bottom) {
      ctx.font = `italic ${m.smallFontSize}px Arial, sans-serif`;
      ctx.fillStyle = '#666666';
      ctx.fillText(cfg.attributeField, x, entryY);
      entryY += m.smallFontSize * 1.2;
    }
    const barW = Math.min(w, m.swatchSize * 12);
    drawGradientBar(ctx, cfg.colorRamp.name, x, entryY, barW, m.gradientH);
    entryY += m.gradientH + 2;
    if (entryY + m.smallFontSize <= bottom) {
      ctx.font = `${m.smallFontSize}px Arial, sans-serif`;
      ctx.fillStyle = '#555555';
      ctx.textAlign = 'left';
      ctx.fillText(formatNum(cfg.colorRamp.minValue ?? 0), x, entryY);
      ctx.textAlign = 'right';
      ctx.fillText(formatNum(cfg.colorRamp.maxValue ?? 100), x + barW, entryY);
      ctx.textAlign = 'left';
      entryY += m.smallFontSize * 1.2;
    }
  } else {
    const color: RGBAColor = [99, 102, 241, 180];
    entryY = drawSwatchRow(ctx, x, entryY, w, color, ds.name, m);
  }

  return entryY;
}

function drawSwatchRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  color: RGBAColor,
  label: string,
  m: LegendMetrics,
): number {
  ctx.fillStyle = rgbaCss(color);
  ctx.fillRect(x, y, m.swatchSize, m.swatchSize);
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, m.swatchSize, m.swatchSize);

  ctx.fillStyle = '#222222';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const textX = x + m.swatchSize + m.padding * 0.5;
  const maxTextW = Math.max(0, w - (textX - x));
  ctx.fillText(truncateToWidth(ctx, label, maxTextW), textX, y + 1);
  return y + m.rowHeight;
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  const ellipsis = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ellipsis;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  datasets: Dataset[],
  scale: number,
) {
  // Background only — no border (page frame or a user-added shape provides any outline).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);

  const m = legendMetrics(scale);
  const innerX = x + m.padding;
  const innerW = w - m.padding * 2;
  const bottom = y + h - m.padding;

  // Title
  ctx.font = `bold ${m.titleFontSize}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Legend', innerX, y + m.padding);
  let entryY = y + m.padding + m.titleFontSize * 1.3;

  for (const ds of datasets) {
    if (entryY >= bottom) break;
    entryY = renderDatasetLegendEntries(ctx, ds, innerX, entryY, innerW, bottom, m);
    entryY += m.padding * 0.5;
  }
}

// ---------------------------------------------------------------------------
// Scale bar, north arrow, image, shape, hr
// ---------------------------------------------------------------------------

function drawScaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, zoom: number, scale: number) {
  const metersPerPixel = 156543.03 / Math.pow(2, zoom);
  const barWidthMeters = metersPerPixel * 200;

  const niceDistances = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  let dist = niceDistances[0];
  for (const d of niceDistances) {
    if (d <= barWidthMeters) dist = d;
    else break;
  }

  const label = dist >= 1000 ? `${dist / 1000} km` : `${dist} m`;

  const barH = 6 * scale * 0.35;
  const fontSize = 7 * scale * 0.35;
  const barW = w * 0.8;
  const barX = x + (w - barW) / 2;
  const barY = y + h - barH - fontSize - 4;

  const segments = 4;
  const segW = barW / segments;
  for (let i = 0; i < segments; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#000000' : '#ffffff';
    ctx.fillRect(barX + i * segW, barY, segW, barH);
  }
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.font = `${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, barX + barW / 2, barY + barH + 2);
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2;
  const arrowTop = y + h * 0.1;
  const arrowBottom = y + h * 0.75;
  const arrowWidth = w * 0.3;

  ctx.beginPath();
  ctx.moveTo(cx, arrowTop);
  ctx.lineTo(cx + arrowWidth, arrowBottom);
  ctx.lineTo(cx, arrowBottom - (arrowBottom - arrowTop) * 0.25);
  ctx.lineTo(cx - arrowWidth, arrowBottom);
  ctx.closePath();

  ctx.fillStyle = '#000000';
  ctx.fill();

  const fontSize = Math.min(w, h) * 0.25;
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', cx, y + h * 0.78);
}

function drawImage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, elem: LayoutElement) {
  if (!elem.imageData) {
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    return;
  }

  const img = new Image();
  img.src = elem.imageData;
  try {
    ctx.drawImage(img, x, y, w, h);
  } catch {
    // Image not yet loaded — will be blank
  }
}

function drawShape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawHorizontalRule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, _h: number, elem: LayoutElement) {
  ctx.fillStyle = elem.color || '#000000';
  const thickness = Math.max(1, (elem.thickness || 0.5) * MM_TO_PX_300DPI);
  ctx.fillRect(x, y, w, thickness);
}

/** Pre-load all images in elements so they're available for synchronous canvas drawing. */
export function preloadImages(elements: LayoutElement[]): Promise<void> {
  const imageElements = elements.filter((e) => e.imageData);
  if (imageElements.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    let loaded = 0;
    for (const elem of imageElements) {
      const img = new Image();
      img.onload = () => {
        loaded++;
        if (loaded === imageElements.length) resolve();
      };
      img.onerror = () => {
        loaded++;
        if (loaded === imageElements.length) resolve();
      };
      img.src = elem.imageData!;
    }
  });
}

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------

export interface PlaceholderField {
  /** Index into template.elements. Used as the key in textOverrides. */
  elementIndex: number;
  /** Short label for the form input, derived from element type or hinted text. */
  label: string;
  /** Default text to preload into the input. Often blank. */
  defaultValue: string;
  /** Render as textarea rather than single-line input. */
  multiline: boolean;
}

/** Patterns that indicate the text is a disposable placeholder whose raw
 *  value should NOT be pre-filled into the input (show blank instead). */
const BLANK_DEFAULT_PATTERNS: RegExp[] = [
  /^\s*$/i,
  /^\s*\{\{.+\}\}\s*$/,
  /^\s*<[^<>]+>\s*$/,
  /click to add/i,
  /^sample\b/i,
  /^example\b/i,
  /^lorem ipsum/i,
  /^untitled/i,
  /^(enter|insert|add)\s+(your\s+)?(title|text|subtitle|heading)/i,
];

function shouldBlankDefault(text: string | undefined): boolean {
  if (text === undefined || text === null) return true;
  return BLANK_DEFAULT_PATTERNS.some((p) => p.test(text));
}

/**
 * Heuristic: does this element's text look like it exists only to name the
 * template itself (e.g. "Full Page Landscape" label at the bottom of a
 * template named "FullPage_Landscape_8-5x11")? If so, skip it from both
 * the editable list and the final render.
 */
function isReferenceOnlyHeuristic(elem: LayoutElement, template: LayoutTemplate): boolean {
  if (elem.referenceOnly) return true;
  const raw = (elem.text || '').trim();
  if (!raw || raw.length < 8 || raw.length > 80) return false;

  // Normalize: lowercase, strip all non-alpha-numeric, collapse to one
  // continuous string so "FullPage" and "Full Page" both become "fullpage".
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normText = normalize(raw);
  const normName = normalize(template.name);
  if (normText.length < 6 || !normName) return false;

  return normName.includes(normText) || normText.includes(normName);
}

function placeholderLabel(elem: LayoutElement, fallback: string): string {
  const raw = (elem.text || '').trim();
  const token = raw.match(/^\s*(?:\{\{\s*(.+?)\s*\}\}|<\s*(.+?)\s*>)\s*$/);
  if (token) {
    const name = (token[1] || token[2] || '').trim();
    if (name) return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (elem.type === 'title') return 'Title';
  if (elem.type === 'subtitle') return 'Subtitle';
  const short = raw.split(/\s+/).slice(0, 4).join(' ');
  return short || fallback;
}

/**
 * All text / title / subtitle elements are editable at export time unless
 * they are `locked`, `referenceOnly`, or match the template-name heuristic.
 *
 * Disposable placeholder text (empty, `{{token}}`, etc.) gets a blank
 * default; real field labels like "Figure Title" are pre-filled so the
 * user can keep or replace them.
 */
export function getEditablePlaceholders(template: LayoutTemplate): PlaceholderField[] {
  const fields: PlaceholderField[] = [];
  template.elements.forEach((elem, idx) => {
    if (elem.locked) return;
    if (elem.type !== 'title' && elem.type !== 'subtitle' && elem.type !== 'text') return;
    if (isReferenceOnlyHeuristic(elem, template)) return;

    const raw = elem.text || '';
    const defaultValue = shouldBlankDefault(raw) ? '' : raw;

    fields.push({
      elementIndex: idx,
      label: placeholderLabel(elem, `Text ${idx + 1}`),
      defaultValue,
      multiline: elem.type === 'text' && (elem.h ?? 0) > 15,
    });
  });
  return fields;
}

// ---------------------------------------------------------------------------
// PNG / PDF export
// ---------------------------------------------------------------------------

export async function exportFigureAsPNG(options: FigureExportOptions): Promise<Blob> {
  await preloadImages(options.template.elements);
  const canvas = renderFigure(options);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/png');
  });
}

export async function exportFigureAsPDF(options: FigureExportOptions): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  await preloadImages(options.template.elements);
  const canvas = renderFigure(options);

  const { page_config } = options.template;
  const orientation = page_config.orientation === 'landscape' ? 'l' : 'p';
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [page_config.width, page_config.height],
  });

  const imgData = canvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', 0, 0, page_config.width, page_config.height);

  return pdf.output('blob');
}
