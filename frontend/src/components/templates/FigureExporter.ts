/**
 * Figure exporter: composites a map screenshot with a template layout
 * to produce a finished figure as PNG or PDF.
 */

import type { LayoutElement, LayoutTemplate } from '@/api/templates';
import { Dataset } from '@/api/types';

const MM_TO_PX_300DPI = 300 / 25.4; // ~11.811 px per mm at 300 DPI

interface FigureExportOptions {
  template: LayoutTemplate;
  mapImage: HTMLCanvasElement; // composited map canvas (basemap + layers)
  visibleDatasets: Dataset[];
  mapZoom: number;
  mapCenter: { latitude: number; longitude: number };
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
  const { template, mapImage, visibleDatasets, mapZoom } = options;
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

  // Sort elements: map_frame first (behind everything)
  const sorted = [...elements].sort((a, b) => {
    if (a.type === 'map_frame') return -1;
    if (b.type === 'map_frame') return 1;
    return 0;
  });

  for (const elem of sorted) {
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
      case 'subtitle':
        drawText(ctx, x, y, w, h, elem, scale);
        break;
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

  // Scale map image to fill the frame while maintaining aspect ratio
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

  // Frame border
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, elem: LayoutElement, scale: number) {
  const fontSize = (elem.fontSize || 10) * scale * 0.35; // Convert point size to px at 300 DPI
  const fontWeight = elem.fontWeight === 'bold' ? 'bold' : 'normal';
  ctx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';

  const align = elem.textAlign || 'left';
  ctx.textAlign = align as CanvasTextAlign;
  ctx.textBaseline = 'top';

  let textX = x;
  if (align === 'center') textX = x + w / 2;
  else if (align === 'right') textX = x + w;

  const text = elem.text || '';
  // Simple word wrap
  const words = text.split(' ');
  let line = '';
  let lineY = y + fontSize * 0.2;
  const lineHeight = fontSize * 1.3;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > w && line) {
      ctx.fillText(line, textX, lineY);
      line = word;
      lineY += lineHeight;
      if (lineY > y + h) break;
    } else {
      line = testLine;
    }
  }
  if (line && lineY <= y + h) {
    ctx.fillText(line, textX, lineY);
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, datasets: Dataset[], scale: number) {
  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  const fontSize = 8 * scale * 0.35;
  const titleFontSize = 9 * scale * 0.35;
  const padding = 4 * scale * 0.35;
  const swatchSize = 10 * scale * 0.35;
  const rowHeight = 14 * scale * 0.35;

  // Title
  ctx.font = `bold ${titleFontSize}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Legend', x + padding, y + padding);

  // Dataset entries
  ctx.font = `${fontSize}px Arial, sans-serif`;
  let entryY = y + padding + titleFontSize + padding;

  for (const ds of datasets.slice(0, Math.floor((h - padding * 3 - titleFontSize) / rowHeight))) {
    // Color swatch
    const color = getDatasetColor(ds);
    ctx.fillStyle = color;
    ctx.fillRect(x + padding, entryY, swatchSize, swatchSize);
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x + padding, entryY, swatchSize, swatchSize);

    // Name
    ctx.fillStyle = '#000000';
    ctx.fillText(ds.name, x + padding + swatchSize + padding, entryY + 1);
    entryY += rowHeight;
  }
}

function getDatasetColor(ds: Dataset): string {
  const style = ds.style_config as Record<string, unknown> | undefined;
  if (style?.mode === 'uniform' && style?.color) {
    const c = style.color as number[];
    if (Array.isArray(c) && c.length >= 3) {
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  // Default colors by data type
  return ds.data_type === 'raster' ? '#8B5CF6' : '#3B82F6';
}

function drawScaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, zoom: number, scale: number) {
  // Approximate ground resolution at equator for Web Mercator
  const metersPerPixel = 156543.03 / Math.pow(2, zoom);
  const barWidthMeters = metersPerPixel * 200; // approximate

  // Choose nice round number
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

  // Draw alternating black/white segments
  const segments = 4;
  const segW = barW / segments;
  for (let i = 0; i < segments; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#000000' : '#ffffff';
    ctx.fillRect(barX + i * segW, barY, segW, barH);
  }
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  // Label
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

  // Arrow shape
  ctx.beginPath();
  ctx.moveTo(cx, arrowTop);
  ctx.lineTo(cx + arrowWidth, arrowBottom);
  ctx.lineTo(cx, arrowBottom - (arrowBottom - arrowTop) * 0.25);
  ctx.lineTo(cx - arrowWidth, arrowBottom);
  ctx.closePath();

  // Left half filled, right half outline
  ctx.fillStyle = '#000000';
  ctx.fill();

  // "N" label
  const fontSize = Math.min(w, h) * 0.25;
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', cx, y + h * 0.78);
}

function drawImage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, elem: LayoutElement) {
  if (!elem.imageData) {
    // Placeholder
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    return;
  }

  // Draw base64 image synchronously (image must be pre-loaded)
  // For the export, images are loaded beforehand via loadImages()
  const img = new Image();
  img.src = elem.imageData;
  // If image is already cached/loaded, drawImage works synchronously
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

/** Export figure as PNG blob. */
export async function exportFigureAsPNG(options: FigureExportOptions): Promise<Blob> {
  await preloadImages(options.template.elements);
  const canvas = renderFigure(options);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/png');
  });
}

/** Export figure as PDF blob. */
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
