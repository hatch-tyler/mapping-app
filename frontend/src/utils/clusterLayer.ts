import Supercluster from 'supercluster';
import { GeoJsonLayer } from '@deck.gl/layers';
import { Dataset, GeoJSONFeatureCollection, GeoJSONFeature, RGBAColor } from '../api/types';
import { getGeoJSONUrl } from '../api/datasets';
import { createFillColorAccessor, DEFAULT_STYLE } from './styleInterpreter';

interface ClusterProperties {
  cluster: boolean;
  cluster_id?: number;
  point_count?: number;
  point_count_abbreviated?: string;
}

type ClusterFeature = GeoJSONFeature & {
  properties: ClusterProperties & Record<string, unknown>;
};

const clusterCache = new Map<string, {
  supercluster: Supercluster;
  data: GeoJSONFeatureCollection;
}>();

const CLUSTER_DEFAULT_STYLE = {
  lineColor: [255, 255, 255, 255] as RGBAColor,
  clusterFillColor: [255, 140, 0, 220] as RGBAColor,
};

async function fetchGeoJSON(datasetId: string): Promise<GeoJSONFeatureCollection> {
  const token = localStorage.getItem('access_token');
  const url = getGeoJSONUrl(datasetId);

  const response = await fetch(url, {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GeoJSON: ${response.statusText}`);
  }

  return response.json();
}

function isPointGeometry(feature: GeoJSONFeature): boolean {
  return feature.geometry?.type === 'Point';
}

export async function createClusteredLayer(
  dataset: Dataset,
  zoom: number,
  existingData?: GeoJSONFeatureCollection | null
): Promise<GeoJsonLayer | null> {
  const cacheKey = dataset.id;
  let cached = clusterCache.get(cacheKey);

  // Fetch data if not cached
  if (!cached) {
    try {
      const data = existingData || await fetchGeoJSON(dataset.id);

      // Check if this is point data
      const hasPoints = data.features.some(isPointGeometry);
      if (!hasPoints) {
        // Not point data, return null to use regular layer
        return null;
      }

      // Filter to only point features for clustering
      const pointFeatures = data.features.filter(isPointGeometry);

      // Create supercluster index
      // Smaller radius = more clusters (less aggressive grouping)
      // Lower maxZoom = individual points appear sooner when zooming in
      const supercluster = new Supercluster({
        radius: 30,
        maxZoom: 8,
        minZoom: 0,
      });

      supercluster.load(pointFeatures as Supercluster.PointFeature<Record<string, unknown>>[]);

      cached = { supercluster, data };
      clusterCache.set(cacheKey, cached);
    } catch (error) {
      console.error('Failed to create clustered layer:', error);
      return null;
    }
  }

  const { supercluster } = cached;

  // Get clusters for current zoom level
  const clusters = supercluster.getClusters([-180, -85, 180, 85], Math.floor(zoom)) as ClusterFeature[];

  // Get fill color accessor from style interpreter
  const fillColorAccessor = createFillColorAccessor(dataset.style_config);
  const styleConfig = dataset.style_config || {};
  const lineColor = (styleConfig.lineColor as RGBAColor) || CLUSTER_DEFAULT_STYLE.lineColor;
  const clusterFillColor = (styleConfig.clusterFillColor as RGBAColor) || CLUSTER_DEFAULT_STYLE.clusterFillColor;
  const baseFillColor = (styleConfig.fillColor as RGBAColor) || DEFAULT_STYLE.fillColor;

  return new GeoJsonLayer({
    id: `clustered-${dataset.id}`,
    data: {
      type: 'FeatureCollection',
      features: clusters,
    },
    pickable: true,
    stroked: true,
    filled: true,
    // Use circle+text to show count labels on clusters
    pointType: 'circle+text',
    pointRadiusUnits: 'pixels',
    pointRadiusMinPixels: 6,
    pointRadiusMaxPixels: 24,
    lineWidthMinPixels: 1,
    getFillColor: (d: unknown) => {
      const feature = d as ClusterFeature;
      if (feature.properties?.cluster) {
        return clusterFillColor;
      }
      // Use the style interpreter accessor for non-cluster points
      if (typeof fillColorAccessor === 'function') {
        return fillColorAccessor(d);
      }
      return fillColorAccessor;
    },
    getLineColor: lineColor,
    getPointRadius: (d: unknown) => {
      const feature = d as ClusterFeature;
      if (feature.properties?.cluster) {
        const count = feature.properties.point_count || 1;
        // Scale radius based on cluster size - smaller sizes
        return Math.min(10 + Math.log10(count) * 6, 24);
      }
      return 6;
    },
    getLineWidth: 2,
    // Text properties for cluster counts
    getText: (d: unknown) => {
      const feature = d as ClusterFeature;
      if (feature.properties?.cluster && feature.properties.point_count) {
        return String(feature.properties.point_count);
      }
      return '';
    },
    getTextSize: 10,
    getTextColor: [255, 255, 255, 255],
    textFontWeight: 'bold',
    getTextAnchor: 'middle',
    getTextAlignmentBaseline: 'center',
    textFontFamily: 'Arial, sans-serif',
    updateTriggers: {
      getFillColor: [
        baseFillColor,
        clusterFillColor,
        styleConfig.mode,
        styleConfig.attributeField,
        JSON.stringify(styleConfig.categoryColors),
        styleConfig.colorRamp,
      ],
      getPointRadius: [zoom],
      getText: [zoom],
    },
  });
}

export function clearClusterCache(datasetId?: string): void {
  if (datasetId) {
    clusterCache.delete(datasetId);
  } else {
    clusterCache.clear();
  }
}

// Check if dataset should use clustering (point geometry type, small enough for GeoJSON)
export function shouldUseClustering(dataset: Dataset): boolean {
  if (dataset.data_type !== 'vector') return false;
  if (dataset.geometry_type?.toLowerCase() !== 'point') return false;
  // Large datasets use MVT tiles instead of downloading everything for clustering
  if (dataset.feature_count === null || dataset.feature_count > 10000) return false;
  return true;
}
