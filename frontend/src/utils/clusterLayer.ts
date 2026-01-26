import Supercluster from 'supercluster';
import { GeoJsonLayer } from '@deck.gl/layers';
import { Dataset, GeoJSONFeatureCollection, GeoJSONFeature } from '../api/types';
import { getGeoJSONUrl } from '../api/datasets';

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

const DEFAULT_STYLE = {
  fillColor: [0, 128, 255, 200] as [number, number, number, number],
  lineColor: [255, 255, 255, 255] as [number, number, number, number],
  clusterFillColor: [255, 140, 0, 220] as [number, number, number, number],
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

  const style = {
    ...DEFAULT_STYLE,
    ...dataset.style_config,
  };

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
        return style.clusterFillColor || DEFAULT_STYLE.clusterFillColor;
      }
      return style.fillColor;
    },
    getLineColor: style.lineColor,
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
      getFillColor: [style.fillColor, style.clusterFillColor],
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

// Check if dataset should use clustering (point geometry type)
export function shouldUseClustering(dataset: Dataset): boolean {
  return dataset.data_type === 'vector' &&
         dataset.geometry_type?.toLowerCase() === 'point';
}
