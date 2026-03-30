import { GeoJsonLayer } from '@deck.gl/layers';
import { TileLayer, MVTLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import { Dataset, GeoJSONFeatureCollection } from '../api/types';
import { getGeoJSONUrl, getRasterTileUrl, getMVTTileUrl } from '../api/datasets';
import { API_URL } from '../api/client';
import { createStyleAccessors, DEFAULT_STYLE } from './styleInterpreter';
import { useMapStore } from '../stores/mapStore';

const MVT_FEATURE_THRESHOLD = 10000;

type LayerType = GeoJsonLayer | TileLayer | MVTLayer | null;

export function shouldUseMVT(dataset: Dataset): boolean {
  return (
    dataset.data_type === 'vector' &&
    (dataset.feature_count === null || dataset.feature_count > MVT_FEATURE_THRESHOLD)
  );
}

export function createLayerFromDataset(
  dataset: Dataset,
  data?: GeoJSONFeatureCollection | null
): LayerType {
  // External datasets use proxy-based layers
  if (dataset.source_type === 'external') {
    return createExternalLayer(dataset);
  }

  if (dataset.data_type === 'vector') {
    // If explicit data is passed, always use GeoJsonLayer
    if (data) {
      return createVectorLayer(dataset, data);
    }
    // Large datasets use MVT tiles
    if (shouldUseMVT(dataset)) {
      return createMVTLayer(dataset);
    }
    return createVectorLayer(dataset);
  }

  if (dataset.data_type === 'raster') {
    return createRasterLayer(dataset);
  }

  return null;
}

function createExternalLayer(dataset: Dataset): LayerType {
  const token = localStorage.getItem('access_token');
  const baseUrl = API_URL || window.location.origin;
  const proxyBase = `${baseUrl}/api/v1/external-sources/${dataset.id}/proxy`;
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  switch (dataset.service_type) {
    case 'xyz':
      // XYZ tiles can often be loaded directly
      return new TileLayer({
        id: `ext-xyz-${dataset.id}`,
        data: dataset.service_url || '',
        tileSize: 256,
        minZoom: dataset.min_zoom,
        maxZoom: dataset.max_zoom,
        renderSubLayers: (props: { id: string; data: unknown; tile: { boundingBox: [[number, number], [number, number]] }; [key: string]: unknown }) => {
          const { boundingBox } = props.tile;
          return new BitmapLayer({
            ...props,
            data: undefined,
            image: props.data as string,
            bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]],
          });
        },
      });

    case 'arcgis_map':
      // Tile-cached ArcGIS MapServer — direct access (faster, no proxy)
      return new TileLayer({
        id: `ext-arcmap-${dataset.id}`,
        data: `${dataset.service_url}/tile/{z}/{y}/{x}`,
        tileSize: 256,
        minZoom: dataset.min_zoom,
        maxZoom: dataset.max_zoom,
        onTileError: () => {},  // Silently ignore 404s for tiles outside data extent
        renderSubLayers: (props: { id: string; data: unknown; tile: { boundingBox: [[number, number], [number, number]] }; [key: string]: unknown }) => {
          if (!props.data) return null;
          const { boundingBox } = props.tile;
          return new BitmapLayer({
            ...props,
            data: undefined,
            image: props.data as string,
            bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]],
          });
        },
      });

    case 'arcgis_map_export': {
      // Dynamic MapServer (no tile cache) via proxy /export endpoint
      const exportLayerId = dataset.service_layer_id || '0';
      return new TileLayer({
        id: `ext-arcmap-export-${dataset.id}`,
        data: proxyBase,
        tileSize: 256,
        minZoom: dataset.min_zoom,
        maxZoom: dataset.max_zoom,
        getTileData: (tile: { bbox: { west: number; south: number; east: number; north: number }; signal?: AbortSignal }) => {
          const { west, south, east, north } = tile.bbox;
          const url = `${proxyBase}?bbox=${west},${south},${east},${north}&bboxSR=4326&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:${exportLayerId}&f=image`;
          return fetch(url, { headers: authHeaders, signal: tile.signal })
            .then(r => r.ok ? r.blob() : null)
            .then(b => b ? URL.createObjectURL(b) : null)
            .catch(() => null);
        },
        renderSubLayers: (props: { id: string; data: unknown; tile: { boundingBox: [[number, number], [number, number]] }; [key: string]: unknown }) => {
          if (!props.data) return null;
          const { boundingBox } = props.tile;
          return new BitmapLayer({
            ...props,
            data: undefined,
            image: props.data as string,
            bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]],
          });
        },
      });
    }

    case 'arcgis_image': {
      // ArcGIS ImageServer — direct access via getTileData (bbox-based, not {x}/{y}/{z})
      return new TileLayer({
        id: `ext-arcimg-${dataset.id}`,
        data: `${dataset.service_url}/exportImage`,
        tileSize: 256,
        minZoom: dataset.min_zoom,
        maxZoom: dataset.max_zoom,
        getTileData: (tile: { bbox: { west: number; south: number; east: number; north: number }; signal?: AbortSignal }) => {
          const { west, south, east, north } = tile.bbox;
          const url = `${dataset.service_url}/exportImage?bbox=${west},${south},${east},${north}&bboxSR=4326&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;
          return fetch(url, { signal: tile.signal })
            .then(r => {
              if (!r.ok) return null;
              return r.blob();
            })
            .then(b => {
              if (!b) return null;
              return URL.createObjectURL(b);
            })
            .catch(() => null);
        },
        renderSubLayers: (props: { id: string; data: unknown; tile: { boundingBox: [[number, number], [number, number]] }; [key: string]: unknown }) => {
          if (!props.data) return null;
          const { boundingBox } = props.tile;
          return new BitmapLayer({
            ...props,
            data: undefined,
            image: props.data as string,
            bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]],
          });
        },
      });
    }

    case 'wms': {
      // WMS via proxy with GetMap requests
      const wmsLayerId = dataset.service_layer_id || '';
      return new TileLayer({
        id: `ext-wms-${dataset.id}`,
        data: proxyBase,
        tileSize: 256,
        minZoom: dataset.min_zoom,
        maxZoom: dataset.max_zoom,
        getTileData: (tile: { bbox: { west: number; south: number; east: number; north: number }; signal?: AbortSignal }) => {
          const { west, south, east, north } = tile.bbox;
          const url = `${proxyBase}?service=WMS&request=GetMap&layers=${encodeURIComponent(wmsLayerId)}&styles=&format=image/png&transparent=true&version=1.1.1&srs=EPSG:4326&width=256&height=256&bbox=${west},${south},${east},${north}`;
          return fetch(url, { headers: authHeaders, signal: tile.signal })
            .then(r => r.ok ? r.blob() : null)
            .then(b => b ? URL.createObjectURL(b) : null)
            .catch(() => null);
        },
        renderSubLayers: (props: { id: string; data: unknown; tile: { boundingBox: [[number, number], [number, number]] }; [key: string]: unknown }) => {
          if (!props.data) return null;
          const { boundingBox } = props.tile;
          return new BitmapLayer({
            ...props,
            data: undefined,
            image: props.data as string,
            bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]],
          });
        },
      });
    }

    case 'wfs':
    case 'arcgis_feature': {
      // Vector features via proxy — load per-tile using bbox spatial queries
      const vecStyleAccessors = createStyleAccessors(dataset.style_config);
      const FEATURE_LIMIT = 2000;
      const layerId = dataset.service_layer_id || '';

      return new TileLayer({
        id: `ext-vec-${dataset.id}`,
        data: '',
        minZoom: dataset.min_zoom,
        maxZoom: dataset.max_zoom,
        getTileData: async (tile: { bbox: { west: number; south: number; east: number; north: number } }) => {
          const { west, south, east, north } = tile.bbox;
          let url: string;
          if (dataset.service_type === 'wfs') {
            url = `${proxyBase}?service=WFS&request=GetFeature&typeName=${encodeURIComponent(layerId)}&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=${FEATURE_LIMIT}&BBOX=${south},${west},${north},${east},EPSG:4326`;
          } else {
            url = `${proxyBase}?f=geojson&where=1%3D1&outFields=*&outSR=4326&resultRecordCount=${FEATURE_LIMIT}&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`;
          }
          try {
            const resp = await fetch(url, { headers: authHeaders });
            if (!resp.ok) return null;
            const geojson = await resp.json();
            const features = geojson?.features || [];
            // Track whether results are truncated (user should zoom in)
            const isTruncated = features.length >= FEATURE_LIMIT;
            useMapStore.getState().setLayerTruncated(dataset.id, isTruncated);
            return geojson;
          } catch {
            return null;
          }
        },
        renderSubLayers: (props: { id: string; data: unknown; [key: string]: unknown }) => {
          if (!props.data) return null;
          return new GeoJsonLayer({
            ...props,
            data: props.data as GeoJSONFeatureCollection,
            pickable: true,
            stroked: true,
            filled: true,
            pointType: 'circle',
            lineWidthMinPixels: 2,
            pointRadiusUnits: 'meters',
            pointRadiusMinPixels: vecStyleAccessors.pointRadiusMinPixels,
            pointRadiusMaxPixels: vecStyleAccessors.pointRadiusMaxPixels,
            getFillColor: vecStyleAccessors.getFillColor,
            getLineColor: vecStyleAccessors.getLineColor,
            getPointRadius: vecStyleAccessors.getPointRadius,
            getLineWidth: vecStyleAccessors.getLineWidth,
            updateTriggers: vecStyleAccessors.updateTriggers,
          });
        },
      });
    }

    default:
      return null;
  }
}

function createVectorLayer(
  dataset: Dataset,
  data?: GeoJSONFeatureCollection | null
): GeoJsonLayer {
  const styleAccessors = createStyleAccessors(dataset.style_config);

  // Get auth token for fetching GeoJSON
  const token = localStorage.getItem('access_token');

  return new GeoJsonLayer({
    id: `vector-${dataset.id}`,
    data: data || getGeoJSONUrl(dataset.id),
    // Include auth header in fetch requests
    loadOptions: {
      fetch: {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      },
    },
    pickable: true,
    stroked: true,
    filled: true,
    extruded: false,
    pointType: 'circle',
    lineWidthScale: 1,
    lineWidthMinPixels: 2,
    pointRadiusUnits: 'meters',
    pointRadiusMinPixels: styleAccessors.pointRadiusMinPixels,
    pointRadiusMaxPixels: styleAccessors.pointRadiusMaxPixels,
    getFillColor: styleAccessors.getFillColor,
    getLineColor: styleAccessors.getLineColor,
    getPointRadius: styleAccessors.getPointRadius,
    getLineWidth: styleAccessors.getLineWidth,
    updateTriggers: styleAccessors.updateTriggers,
  });
}

function createMVTLayer(dataset: Dataset): MVTLayer {
  const styleAccessors = createStyleAccessors(dataset.style_config);

  const token = localStorage.getItem('access_token');

  return new MVTLayer({
    id: `mvt-${dataset.id}`,
    data: getMVTTileUrl(dataset.id),
    loadOptions: {
      fetch: {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      },
    },
    pickable: true,
    stroked: true,
    filled: true,
    extruded: false,
    pointType: 'circle',
    lineWidthScale: 1,
    lineWidthMinPixels: 2,
    pointRadiusUnits: 'meters',
    pointRadiusMinPixels: styleAccessors.pointRadiusMinPixels,
    pointRadiusMaxPixels: styleAccessors.pointRadiusMaxPixels,
    getFillColor: styleAccessors.getFillColor,
    getLineColor: styleAccessors.getLineColor,
    getPointRadius: styleAccessors.getPointRadius,
    getLineWidth: styleAccessors.getLineWidth,
    updateTriggers: styleAccessors.updateTriggers,
  });
}

function createRasterLayer(dataset: Dataset): TileLayer {
  // Get auth token for fetching tiles
  const token = localStorage.getItem('access_token');

  return new TileLayer({
    id: `raster-${dataset.id}`,
    data: getRasterTileUrl(dataset.id),
    minZoom: dataset.min_zoom,
    maxZoom: dataset.max_zoom,
    tileSize: 256,
    loadOptions: {
      fetch: {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      },
    },
    renderSubLayers: (props: { id: string; data: unknown; tile: { boundingBox: [[number, number], [number, number]] }; [key: string]: unknown }) => {
      const { boundingBox } = props.tile;
      const [west, south] = boundingBox[0];
      const [east, north] = boundingBox[1];

      return new BitmapLayer({
        ...props,
        data: undefined,
        image: props.data as string,
        bounds: [west, south, east, north],
      });
    },
  });
}

export function getLayerColor(index: number): [number, number, number, number] {
  const colors: [number, number, number, number][] = [
    [66, 133, 244, 180],
    [52, 168, 83, 180],
    [251, 188, 4, 180],
    [234, 67, 53, 180],
    [154, 160, 166, 180],
    [255, 112, 67, 180],
    [0, 172, 193, 180],
    [124, 77, 255, 180],
  ];
  return colors[index % colors.length];
}

export { DEFAULT_STYLE };
