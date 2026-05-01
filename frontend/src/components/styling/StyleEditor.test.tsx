import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StyleEditor } from './StyleEditor';
import type { Dataset } from '../../api/types';

// Stub the heavy panel children — the editor's footer-button gating is
// what we're testing here, not the per-mode form fields.
vi.mock('./UniformStylePanel', () => ({
  UniformStylePanel: () => <div data-testid="uniform-panel" />,
}));
vi.mock('./CategoricalStylePanel', () => ({
  CategoricalStylePanel: () => <div data-testid="categorical-panel" />,
}));
vi.mock('./GraduatedStylePanel', () => ({
  GraduatedStylePanel: () => <div data-testid="graduated-panel" />,
}));
vi.mock('./DisplayStylePanel', () => ({
  DisplayStylePanel: () => <div data-testid="display-panel" />,
}));
vi.mock('../../api/templates', () => ({
  downloadStyleExport: vi.fn(),
}));

const dataset: Dataset = {
  id: 'd1',
  name: 'Test Dataset',
  description: null,
  data_type: 'vector',
  geometry_type: 'Point',
  source_format: 'geojson',
  srid: 4326,
  bounds: null,
  is_visible: true,
  is_public: false,
  style_config: {},
  min_zoom: 0,
  max_zoom: 22,
  file_path: null,
  table_name: 'vector_data_d1',
  feature_count: 1,
  created_by_id: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  source_type: 'local',
  category: 'reference',
  geographic_scope: null,
  service_url: null,
  service_type: null,
  service_layer_id: null,
  project_id: null,
  project_name: null,
  linked_project_ids: [],
  linked_project_names: [],
  service_metadata: null,
  is_privileged: false,
  file_hash: null,
  snapshot_source_id: null,
  snapshot_date: null,
  tags: [],
};

describe('StyleEditor footer gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('viewer mode (onApply only): renders Apply, hides Save, shows help caption', () => {
    const onApply = vi.fn();
    render(
      <StyleEditor dataset={dataset} onApply={onApply} onClose={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Save for everyone/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Saving for all users requires editor or admin/i),
    ).toBeInTheDocument();
  });

  it('editor/admin mode (both callbacks): renders Apply and Save, no help caption', () => {
    render(
      <StyleEditor
        dataset={dataset}
        onApply={vi.fn()}
        onSave={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Save for everyone/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Saving for all users requires editor or admin/i),
    ).not.toBeInTheDocument();
  });

  it('admin-table mode (onSave only, no onApply): hides Apply', () => {
    render(
      <StyleEditor
        dataset={dataset}
        onSave={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Apply' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Save for everyone/i }),
    ).toBeInTheDocument();
  });

  it('Apply calls onApply with current config and closes the modal', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <StyleEditor dataset={dataset} onApply={onApply} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject({ mode: 'uniform' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Save calls onSave, then onApply, then onClose', async () => {
    const calls: string[] = [];
    const onSave = vi.fn(async () => {
      calls.push('save');
    });
    const onApply = vi.fn(() => {
      calls.push('apply');
    });
    const onClose = vi.fn(() => {
      calls.push('close');
    });

    render(
      <StyleEditor
        dataset={dataset}
        onApply={onApply}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Save for everyone/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toEqual(['save', 'apply', 'close']);
  });

  it('Display tab is reachable for viewer (no separate gate)', () => {
    render(
      <StyleEditor dataset={dataset} onApply={vi.fn()} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    expect(screen.getByTestId('display-panel')).toBeInTheDocument();
  });
});
