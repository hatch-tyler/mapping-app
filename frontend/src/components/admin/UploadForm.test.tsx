import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadForm } from './UploadForm';
import * as datasetsApi from '../../api/datasets';
import { createMockUploadJob } from '../../__tests__/mockData';

// Mock the datasets API
vi.mock('../../api/datasets', () => ({
  uploadVector: vi.fn(),
  uploadRaster: vi.fn(),
  getUploadJobStatus: vi.fn(),
  inspectBundle: vi.fn(),
  uploadBundle: vi.fn(),
  getBundleStatus: vi.fn(),
  listRecentBundles: vi.fn(),
}));

vi.mock('../../api/projects', () => ({
  getProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));

// Mock react-dropzone
vi.mock('react-dropzone', () => ({
  useDropzone: vi.fn(({ onDrop }) => ({
    getRootProps: () => ({
      onClick: () => {},
      onDragEnter: () => {},
      onDragOver: () => {},
      onDragLeave: () => {},
      onDrop: () => {},
    }),
    getInputProps: () => ({
      type: 'file',
      accept: '',
      onChange: (e: { target: { files: FileList } }) => {
        if (e.target.files && e.target.files.length > 0) {
          onDrop(Array.from(e.target.files));
        }
      },
    }),
    isDragActive: false,
  })),
}));

describe('UploadForm', () => {
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the upload form', () => {
    render(<UploadForm onSuccess={mockOnSuccess} />);

    expect(screen.getByText(/Drag & drop a file here/)).toBeInTheDocument();
    expect(screen.getByText('Dataset Name')).toBeInTheDocument();
    expect(screen.getByText('Description (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload Dataset/i })).toBeInTheDocument();
  });

  it('should display supported formats', () => {
    render(<UploadForm onSuccess={mockOnSuccess} />);

    expect(screen.getByText(/Supported: GeoJSON, Shapefile/)).toBeInTheDocument();
    expect(screen.getByText(/File Geodatabase/)).toBeInTheDocument();
    expect(screen.getByText(/Layer Package/)).toBeInTheDocument();
  });

  it('should have disabled submit button when no file is selected', () => {
    render(<UploadForm onSuccess={mockOnSuccess} />);

    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    expect(submitButton).toBeDisabled();
  });

  it('should update name field', async () => {
    const user = userEvent.setup();
    render(<UploadForm onSuccess={mockOnSuccess} />);

    const nameInput = screen.getByPlaceholderText('Enter dataset name');
    await user.type(nameInput, 'My Dataset');

    expect(nameInput).toHaveValue('My Dataset');
  });

  it('should update description field', async () => {
    const user = userEvent.setup();
    render(<UploadForm onSuccess={mockOnSuccess} />);

    const descriptionInput = screen.getByPlaceholderText('Enter description');
    await user.type(descriptionInput, 'Test description');

    expect(descriptionInput).toHaveValue('Test description');
  });

  it('should show error when submitting without file', async () => {
    const user = userEvent.setup();
    render(<UploadForm onSuccess={mockOnSuccess} />);

    // Manually type a name to enable the button check
    const nameInput = screen.getByPlaceholderText('Enter dataset name');
    await user.type(nameInput, 'Test');

    // The button should still be disabled because no file
    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    expect(submitButton).toBeDisabled();
  });

  it('should call uploadVector for GeoJSON file', async () => {
    const mockFile = new File(['{"type":"FeatureCollection"}'], 'test.geojson', {
      type: 'application/json',
    });

    vi.mocked(datasetsApi.uploadVector).mockResolvedValue(
      createMockUploadJob({ id: 'job-1', status: 'processing' })
    );
    vi.mocked(datasetsApi.getUploadJobStatus).mockResolvedValue(
      createMockUploadJob({ id: 'job-1', status: 'completed', progress: 100 })
    );

    render(<UploadForm onSuccess={mockOnSuccess} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    fireEvent.change(input, { target: { files: dataTransfer.files } });

    await waitFor(() => {
      expect(screen.getByText('test.geojson')).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(datasetsApi.uploadVector).toHaveBeenCalledWith(
        mockFile,
        'test',
        '',
        expect.any(Function),
        expect.any(Object)
      );
    });

    // Wait for polling + completion delay (2s poll + 1.5s delay)
    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    }, { timeout: 6000 });
  });

  it('should call uploadRaster for GeoTIFF file', async () => {
    const mockFile = new File(['tiff data'], 'test.tif', {
      type: 'image/tiff',
    });

    vi.mocked(datasetsApi.uploadRaster).mockResolvedValue(
      createMockUploadJob({ id: 'job-2', status: 'processing' })
    );
    vi.mocked(datasetsApi.getUploadJobStatus).mockResolvedValue(
      createMockUploadJob({ id: 'job-2', status: 'completed', progress: 100 })
    );

    render(<UploadForm onSuccess={mockOnSuccess} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    fireEvent.change(input, { target: { files: dataTransfer.files } });

    await waitFor(() => {
      expect(screen.getByText('test.tif')).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(datasetsApi.uploadRaster).toHaveBeenCalledWith(
        mockFile,
        'test',
        '',
        expect.any(Function),
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    }, { timeout: 6000 });
  });

  it('should display error on upload failure', async () => {
    const mockFile = new File(['data'], 'test.geojson', {
      type: 'application/json',
    });

    vi.mocked(datasetsApi.uploadVector).mockRejectedValue(
      new Error('Upload failed: Invalid format')
    );

    render(<UploadForm onSuccess={mockOnSuccess} />);

    // Simulate file drop
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    fireEvent.change(input, { target: { files: dataTransfer.files } });

    await waitFor(() => {
      expect(screen.getByText('test.geojson')).toBeInTheDocument();
    });

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Upload failed: Invalid format')).toBeInTheDocument();
    });

    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it('should display generic error for non-Error rejection', async () => {
    const mockFile = new File(['data'], 'test.geojson', {
      type: 'application/json',
    });

    vi.mocked(datasetsApi.uploadVector).mockRejectedValue('string error');

    render(<UploadForm onSuccess={mockOnSuccess} />);

    // Simulate file drop
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    fireEvent.change(input, { target: { files: dataTransfer.files } });

    await waitFor(() => {
      expect(screen.getByText('test.geojson')).toBeInTheDocument();
    });

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Upload failed. Please try again.')).toBeInTheDocument();
    });
  });

  it('should display file size', async () => {
    const mockFile = new File(['x'.repeat(1024 * 1024 * 2)], 'large.geojson', {
      type: 'application/json',
    });

    render(<UploadForm onSuccess={mockOnSuccess} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    fireEvent.change(input, { target: { files: dataTransfer.files } });

    await waitFor(() => {
      expect(screen.getByText(/MB/)).toBeInTheDocument();
    });
  });

  it('should clear form after successful upload', async () => {
    const mockFile = new File(['data'], 'test.geojson', {
      type: 'application/json',
    });

    vi.mocked(datasetsApi.uploadVector).mockResolvedValue(
      createMockUploadJob({ id: 'job-1', status: 'processing' })
    );
    vi.mocked(datasetsApi.getUploadJobStatus).mockResolvedValue(
      createMockUploadJob({ id: 'job-1', status: 'completed', progress: 100 })
    );

    render(<UploadForm onSuccess={mockOnSuccess} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    fireEvent.change(input, { target: { files: dataTransfer.files } });

    await waitFor(() => {
      expect(screen.getByText('test.geojson')).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    }, { timeout: 6000 });

    // Form should be cleared
    await waitFor(() => {
      expect(screen.queryByText('test.geojson')).not.toBeInTheDocument();
    });
  });

  it('should show uploading state during upload', async () => {
    const mockFile = new File(['data'], 'test.geojson', {
      type: 'application/json',
    });

    let resolveUpload: (value: unknown) => void = () => {};
    vi.mocked(datasetsApi.uploadVector).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve as (value: unknown) => void;
        })
    );

    render(<UploadForm onSuccess={mockOnSuccess} />);

    // Simulate file drop
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    fireEvent.change(input, { target: { files: dataTransfer.files } });

    await waitFor(() => {
      expect(screen.getByText('test.geojson')).toBeInTheDocument();
    });

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    fireEvent.click(submitButton);

    // Check for uploading state
    await waitFor(() => {
      expect(screen.getByText('Uploading...')).toBeInTheDocument();
    });

    // Resolve the upload
    resolveUpload!(createMockUploadJob({ id: 'job-1' }));

    await waitFor(() => {
      expect(screen.queryByText('Uploading...')).not.toBeInTheDocument();
    });
  });

  it('should route .gdb.zip with multiple feature classes through the bundle flow', async () => {
    // .gdb.zip can't be inspected client-side (no GDAL in browser); the form
    // falls back to the server-side /upload/inspect endpoint, which returns
    // one detected dataset per feature class.
    const mockFile = new File(['gdb-bytes'], 'sample.gdb.zip', {
      type: 'application/zip',
    });

    vi.mocked(datasetsApi.inspectBundle).mockResolvedValue({
      datasets: [
        {
          suggested_name: 'sample__roads',
          data_type: 'vector',
          format: 'gdb-vector',
          primary_file: 'sample.gdb::roads',
          member_files: ['sample.gdb/a00000001.gdbtable'],
          warnings: [],
          container_path: 'sample.gdb',
          layer_name: 'roads',
        },
        {
          suggested_name: 'sample__parcels',
          data_type: 'vector',
          format: 'gdb-vector',
          primary_file: 'sample.gdb::parcels',
          member_files: ['sample.gdb/a00000002.gdbtable'],
          warnings: [],
          container_path: 'sample.gdb',
          layer_name: 'parcels',
        },
      ],
    });

    render(<UploadForm onSuccess={mockOnSuccess} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);
    fireEvent.change(input, { target: { files: dataTransfer.files } });

    // Both detected feature class names should render in the bundle list.
    await waitFor(() => {
      expect(screen.getByDisplayValue('sample__roads')).toBeInTheDocument();
      expect(screen.getByDisplayValue('sample__parcels')).toBeInTheDocument();
    });
    expect(datasetsApi.inspectBundle).toHaveBeenCalledWith(mockFile);

    // The submit button should reflect bundle-mode label.
    const submitButton = screen.getByRole('button', { name: /Upload 2 Datasets/i });
    expect(submitButton).toBeInTheDocument();

    vi.mocked(datasetsApi.uploadBundle).mockResolvedValue({
      bundle_id: 'bundle-1',
      jobs: [],
    });
    fireEvent.click(submitButton);

    // The bundle upload payload should carry container_path / layer_name per layer.
    await waitFor(() => {
      expect(datasetsApi.uploadBundle).toHaveBeenCalled();
    });
    const uploadCall = vi.mocked(datasetsApi.uploadBundle).mock.calls[0];
    const datasetsArg = uploadCall[1] as Array<{
      primary_file: string;
      container_path?: string | null;
      layer_name?: string | null;
    }>;
    expect(datasetsArg).toHaveLength(2);
    expect(datasetsArg[0].container_path).toBe('sample.gdb');
    expect(datasetsArg[0].layer_name).toMatch(/^(roads|parcels)$/);
  });
});
