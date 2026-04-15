import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LayoutTemplate, LayoutElement } from '@/api/templates';
import { getEditablePlaceholders, renderFigure } from './FigureExporter';

function makeTemplate(elements: LayoutElement[]): LayoutTemplate {
  return {
    id: 't1',
    name: 'Test',
    description: null,
    project_id: null,
    page_config: { width: 100, height: 100, orientation: 'landscape' },
    elements,
    logo_path: null,
    source_file_path: null,
    source_format: 'qpt',
    created_by_id: null,
    created_at: '',
    updated_at: '',
  };
}

const baseElem: Omit<LayoutElement, 'type'> = { x: 0, y: 0, w: 50, h: 10 };

describe('getEditablePlaceholders', () => {
  it('returns titles and subtitles as always-editable', () => {
    const tpl = makeTemplate([
      { ...baseElem, type: 'title', text: 'Default Title' },
      { ...baseElem, type: 'subtitle', text: 'Default Subtitle' },
    ]);
    const fields = getEditablePlaceholders(tpl);
    expect(fields).toHaveLength(2);
    expect(fields[0].label).toBe('Title');
    expect(fields[0].defaultValue).toBe('Default Title');
    expect(fields[1].label).toBe('Subtitle');
  });

  it('detects empty, token, and sample-text placeholders for generic text', () => {
    const tpl = makeTemplate([
      { ...baseElem, type: 'text', text: '' },
      { ...baseElem, type: 'text', text: '{{author_name}}' },
      { ...baseElem, type: 'text', text: '<Insert Date>' },
      { ...baseElem, type: 'text', text: 'Sample Text' },
      { ...baseElem, type: 'text', text: 'Click to add text' },
    ]);
    const fields = getEditablePlaceholders(tpl);
    expect(fields).toHaveLength(5);
    expect(fields[1].label).toBe('Author Name');
    expect(fields[2].label).toBe('Insert Date');
    // Token placeholders start blank, not with the raw token text.
    expect(fields[1].defaultValue).toBe('');
    expect(fields[2].defaultValue).toBe('');
  });

  it('leaves concrete generic-text unchanged', () => {
    const tpl = makeTemplate([
      { ...baseElem, type: 'text', text: 'Prepared by the GIS team' },
    ]);
    expect(getEditablePlaceholders(tpl)).toHaveLength(0);
  });

  it('respects locked elements', () => {
    const tpl = makeTemplate([
      { ...baseElem, type: 'title', text: 'Fixed', locked: true },
      { ...baseElem, type: 'subtitle', text: 'Editable' },
    ]);
    const fields = getEditablePlaceholders(tpl);
    expect(fields).toHaveLength(1);
    expect(fields[0].label).toBe('Subtitle');
  });

  it('uses elementIndex that matches position in the original elements array', () => {
    const tpl = makeTemplate([
      { ...baseElem, type: 'map_frame' },
      { ...baseElem, type: 'title', text: 'T' },
      { ...baseElem, type: 'legend' },
      { ...baseElem, type: 'subtitle', text: 'S' },
    ]);
    const fields = getEditablePlaceholders(tpl);
    expect(fields.map((f) => f.elementIndex)).toEqual([1, 3]);
  });

  it('marks tall text elements as multiline', () => {
    const tpl = makeTemplate([
      { ...baseElem, type: 'text', text: '', h: 40 },
      { ...baseElem, type: 'text', text: '', h: 8 },
    ]);
    const fields = getEditablePlaceholders(tpl);
    expect(fields[0].multiline).toBe(true);
    expect(fields[1].multiline).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderFigure — exercised via a mocked 2D context to avoid needing node-canvas.
// We assert the override text lands in fillText calls.
// ---------------------------------------------------------------------------

function stubCanvasContext() {
  const fillTextCalls: string[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn((text: string) => {
      fillTextCalls.push(text);
    }),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  };
  return { ctx, fillTextCalls };
}

describe('renderFigure with textOverrides', () => {
  beforeEach(() => {
    const stub = stubCanvasContext();
    // Patch HTMLCanvasElement.getContext to return our stub.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => stub.ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).__stub = stub;
  });

  it('uses override text instead of element.text when provided', () => {
    const tpl = makeTemplate([
      { ...baseElem, type: 'title', text: 'Default Title' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapImage = document.createElement('canvas') as any;
    mapImage.width = 100;
    mapImage.height = 100;

    renderFigure({
      template: tpl,
      mapImage,
      visibleDatasets: [],
      mapZoom: 5,
      mapCenter: { latitude: 0, longitude: 0 },
      textOverrides: { 0: 'Custom Title' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (HTMLCanvasElement.prototype as any).__stub.fillTextCalls as string[];
    expect(calls).toContain('Custom Title');
    expect(calls).not.toContain('Default Title');
  });

  it('falls back to element.text when override is absent', () => {
    const tpl = makeTemplate([
      { ...baseElem, type: 'title', text: 'Kept Title' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapImage = document.createElement('canvas') as any;
    mapImage.width = 100;
    mapImage.height = 100;

    renderFigure({
      template: tpl,
      mapImage,
      visibleDatasets: [],
      mapZoom: 5,
      mapCenter: { latitude: 0, longitude: 0 },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (HTMLCanvasElement.prototype as any).__stub.fillTextCalls as string[];
    expect(calls).toContain('Kept Title');
  });
});
