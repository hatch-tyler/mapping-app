import '@testing-library/jest-dom';
import React from 'react';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Mock environment variables
vi.stubEnv('VITE_API_URL', 'http://localhost:8000');

// Cleanup after each test
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

// Mock maplibre-gl
vi.mock('maplibre-gl', () => ({
  Map: vi.fn(() => ({
    on: vi.fn(),
    remove: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    getContainer: vi.fn(() => document.createElement('div')),
  })),
  NavigationControl: vi.fn(),
  Marker: vi.fn(),
}));

// Mock react-map-gl
vi.mock('react-map-gl/maplibre', () => ({
  Map: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="maplibre-map">{children}</div>
  ),
}));

// Mock deck.gl
vi.mock('@deck.gl/react', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="deckgl-container">{children}</div>
  ),
}));

vi.mock('@deck.gl/layers', () => ({
  GeoJsonLayer: vi.fn().mockImplementation((props) => ({ ...props, type: 'GeoJsonLayer' })),
  BitmapLayer: vi.fn().mockImplementation((props) => ({ ...props, type: 'BitmapLayer' })),
}));

vi.mock('@deck.gl/geo-layers', () => ({
  TileLayer: vi.fn().mockImplementation((props) => ({ ...props, type: 'TileLayer' })),
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock DataTransfer for file upload tests
class MockDataTransfer {
  private _files: File[] = [];
  items = {
    add: (file: File) => {
      this._files.push(file);
    },
    length: 0,
  };

  get files(): FileList {
    const fileList = Object.create(FileList.prototype);
    Object.defineProperty(fileList, 'length', { value: this._files.length });
    this._files.forEach((file, index) => {
      Object.defineProperty(fileList, index, { value: file, enumerable: true });
    });
    fileList.item = (index: number) => this._files[index] || null;
    fileList[Symbol.iterator] = function* () {
      for (let i = 0; i < this.length; i++) {
        yield this[i];
      }
    };
    return fileList;
  }
}

global.DataTransfer = MockDataTransfer as unknown as typeof DataTransfer;
