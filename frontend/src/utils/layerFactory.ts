import { GeoJsonLayer } from '@deck.gl/layers';
import { TileLayer, MVTLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import { Dataset, GeoJSONFeatureCollection } from '../api/types';
import { getGeoJSONUrl, getRasterTileUrl, getMVTTileUrl } from '../api/datasets';
import { createStyleAccessors, DEFAULT_STYLE } from './styleInterpreter';

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
