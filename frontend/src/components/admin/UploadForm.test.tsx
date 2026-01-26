import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadForm } from './UploadForm';
import * as datasetsApi from '../../api/datasets';
import { createMockDataset } from '../../__tests__/mockData';

// Mock the datasets API
vi.mock('../../api/datasets', () => ({
  uploadVector: vi.fn(),
  uploadRaster: vi.fn(),
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
      createMockDataset({
        id: '1',
        name: 'test',
        data_type: 'vector',
        geometry_type: 'Point',
        source_format: 'geojson',
      })
    );

    render(<UploadForm onSuccess={mockOnSuccess} />);

    // Simulate file drop by triggering onChange on the input
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
      expect(datasetsApi.uploadVector).toHaveBeenCalledWith(
        mockFile,
        'test',
        ''
      );
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('should call uploadRaster for GeoTIFF file', async () => {
    const mockFile = new File(['tiff data'], 'test.tif', {
      type: 'image/tiff',
    });

    vi.mocked(datasetsApi.uploadRaster).mockResolvedValue(
      createMockDataset({
        id: '2',
        name: 'test',
        data_type: 'raster',
        geometry_type: null,
        source_format: 'geotiff',
      })
    );

    render(<UploadForm onSuccess={mockOnSuccess} />);

    // Simulate file drop
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    fireEvent.change(input, { target: { files: dataTransfer.files } });

    await waitFor(() => {
      expect(screen.getByText('test.tif')).toBeInTheDocument();
    });

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /Upload Dataset/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(datasetsApi.uploadRaster).toHaveBeenCalledWith(
        mockFile,
        'test',
        ''
      );
      expect(mockOnSuccess).toHaveBeenCalled();
    });
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
      createMockDataset({
        id: '1',
        name: 'test',
        data_type: 'vector',
        geometry_type: 'Point',
        source_format: 'geojson',
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

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    });

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
    resolveUpload!(
      createMockDataset({
        id: '1',
        name: 'test',
        data_type: 'vector',
        geometry_type: 'Point',
        source_format: 'geojson',
      })
    );

    await waitFor(() => {
      expect(screen.queryByText('Uploading...')).not.toBeInTheDocument();
    });
  });
});
