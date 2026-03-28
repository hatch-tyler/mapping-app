import { useImportStore } from './importStore';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock('./toastStore', () => ({
  useToastStore: {
    getState: () => ({
      addToast: vi.fn(),
    }),
  },
}));

describe('importStore', () => {
  beforeEach(() => {
    useImportStore.setState({ activeImports: {} });
  });

  it('starts with empty activeImports', () => {
    expect(useImportStore.getState().activeImports).toEqual({});
  });

  it('getProgress returns null for unknown dataset', () => {
    expect(useImportStore.getState().getProgress('unknown')).toBeNull();
  });

  it('isImporting returns false for unknown dataset', () => {
    expect(useImportStore.getState().isImporting('unknown')).toBe(false);
  });

  it('startImport adds entry with polling status', () => {
    useImportStore.getState().startImport('ds-1', 'My Dataset', 'job-1');
    const imports = useImportStore.getState().activeImports;
    expect(imports['ds-1']).toBeDefined();
    expect(imports['ds-1'].status).toBe('polling');
    expect(imports['ds-1'].datasetName).toBe('My Dataset');
    expect(imports['ds-1'].jobId).toBe('job-1');
    expect(imports['ds-1'].progress).toBe(0);
  });

  it('isImporting returns true for polling entry', () => {
    useImportStore.getState().startImport('ds-1', 'Test', 'job-1');
    expect(useImportStore.getState().isImporting('ds-1')).toBe(true);
  });

  it('getProgress returns progress for known dataset', () => {
    useImportStore.getState().startImport('ds-1', 'Test', 'job-1');
    expect(useImportStore.getState().getProgress('ds-1')).toBe(0);
  });

  it('isImporting returns false for completed entry', () => {
    useImportStore.setState({
      activeImports: {
        'ds-1': { jobId: 'j', datasetId: 'ds-1', datasetName: 'X', progress: 100, status: 'completed' },
      },
    });
    expect(useImportStore.getState().isImporting('ds-1')).toBe(false);
  });

  it('isImporting returns false for failed entry', () => {
    useImportStore.setState({
      activeImports: {
        'ds-1': { jobId: 'j', datasetId: 'ds-1', datasetName: 'X', progress: 50, status: 'failed' },
      },
    });
    expect(useImportStore.getState().isImporting('ds-1')).toBe(false);
  });
});
