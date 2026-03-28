import { shouldUseClustering, clearClusterCache } from './clusterLayer';
import type { Dataset } from '../api/types';

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'test-id',
    name: 'Test',
    data_type: 'vector',
    geometry_type: 'Point',
    feature_count: 500,
    is_visible: true,
    is_public: false,
    source_type: 'upload',
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Dataset;
}

describe('clusterLayer', () => {
  describe('shouldUseClustering', () => {
    it('returns true for vector point dataset with small count', () => {
      expect(shouldUseClustering(makeDataset())).toBe(true);
    });

    it('returns false for raster dataset', () => {
      expect(shouldUseClustering(makeDataset({ data_type: 'raster' }))).toBe(false);
    });

    it('returns false for polygon geometry', () => {
      expect(shouldUseClustering(makeDataset({ geometry_type: 'Polygon' }))).toBe(false);
    });

    it('returns false for line geometry', () => {
      expect(shouldUseClustering(makeDataset({ geometry_type: 'LineString' }))).toBe(false);
    });

    it('returns false when feature_count is null', () => {
      expect(shouldUseClustering(makeDataset({ feature_count: null }))).toBe(false);
    });

    it('returns false when feature_count exceeds 10000', () => {
      expect(shouldUseClustering(makeDataset({ feature_count: 10001 }))).toBe(false);
    });

    it('returns true at exactly 10000', () => {
      expect(shouldUseClustering(makeDataset({ feature_count: 10000 }))).toBe(true);
    });

    it('handles case-insensitive geometry type', () => {
      expect(shouldUseClustering(makeDataset({ geometry_type: 'point' }))).toBe(true);
    });
  });

  describe('clearClusterCache', () => {
    it('does not throw when clearing by id', () => {
      expect(() => clearClusterCache('some-id')).not.toThrow();
    });

    it('does not throw when clearing all', () => {
      expect(() => clearClusterCache()).not.toThrow();
    });
  });
});
