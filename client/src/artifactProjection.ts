import type {
  MapArtifact,
  MapAssetDef,
  MapAssetFootprint,
  MapAssetFootprintShape,
  MapArtifactKind,
  MapAssetProjection,
  MapAssetProjectionBounds,
  MapGridPoint,
} from "@essence/shared";
import { Box3, Vector3, type Object3D } from "three";
import { BOARD_GRID_SPACING } from "./board3d";

export interface PlaneProjection {
  points: MapGridPoint[];
  bounds: ProjectionBounds;
  width: number;
  height: number;
  shape: MapAssetFootprintShape;
}

export interface ProjectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ProjectionSource {
  shape: MapAssetFootprintShape;
  points?: MapAssetProjection["points"];
  bounds?: MapAssetProjectionBounds;
}

// Las proyecciones built-in se expresan en unidades de mundo 3D (antes de dividir por el
// espaciado de grilla). Estos helpers permiten declararlas directo en unidades de grilla.
function gridCircle(radius: number): ProjectionSource {
  const r = radius * BOARD_GRID_SPACING;
  return { shape: "circle", bounds: { minX: -r, maxX: r, minZ: -r, maxZ: r } };
}

function gridRect(width: number, depth: number): ProjectionSource {
  const halfWidth = (width / 2) * BOARD_GRID_SPACING;
  const halfDepth = (depth / 2) * BOARD_GRID_SPACING;
  return { shape: "rect", bounds: { minX: -halfWidth, maxX: halfWidth, minZ: -halfDepth, maxZ: halfDepth } };
}

const BUILT_IN_ASSET_PROJECTIONS: Record<string, ProjectionSource> = {
  "oak-tree": { shape: "circle", bounds: { minX: -0.22, maxX: 0.22, minZ: -0.22, maxZ: 0.22 } },
  "club-house": { shape: "rect", bounds: { minX: -1.16, maxX: 1.16, minZ: -0.67, maxZ: 0.67 } },
  "glass-building": { shape: "rect", bounds: { minX: -1, maxX: 1, minZ: -0.55, maxZ: 0.61 } },
  "mini-court": { shape: "rect", bounds: { minX: -0.8, maxX: 0.8, minZ: -0.54, maxZ: 0.525 } },
  "mountain-cluster": {
    shape: "triangle",
    points: [
      { x: -1.3532, z: 0.34 },
      { x: -0.924, z: -0.384 },
      { x: 0.24, z: -0.724 },
      { x: 0.884, z: -0.08 },
      { x: 0.884, z: 0.564 },
      { x: -0.95, z: 0.7432 },
    ],
  },
  "party-van": { shape: "rect", bounds: { minX: -0.31, maxX: 0.31, minZ: -0.16, maxZ: 0.2 } },
  "pond": { shape: "circle", bounds: { minX: -1.05, maxX: 1.05, minZ: -1.05, maxZ: 1.05 } },
  "river": { shape: "rect", bounds: { minX: -2.575, maxX: 2.575, minZ: -0.25, maxZ: 0.25 } },
  "plaza": { shape: "circle", bounds: { minX: -1.32, maxX: 1.32, minZ: -1.32, maxZ: 1.32 } },
  "start-sign": { shape: "rect", bounds: { minX: -0.45, maxX: 0.45, minZ: -0.035, maxZ: 0.035 } },
  "finish-sign": { shape: "rect", bounds: { minX: -0.45, maxX: 0.45, minZ: -0.035, maxZ: 0.035 } },
  "fountain": gridCircle(0.5),
  "bench": gridRect(0.6, 0.25),
  "palm-tree": gridCircle(0.3),
  "flower-bed": gridCircle(0.35),
  "beach-set": gridCircle(0.8),
  "sailboat": gridRect(0.7, 0.3),
  "waterfall": gridRect(0.8, 0.35),
  "wedding-arch": gridRect(0.8, 0.2),
  "fence": gridRect(0.9, 0.12),
  "streetlamp": gridCircle(0.12),
  "rock": gridCircle(0.35),
  "billboard": gridRect(1.2, 0.2),
  "bus": gridRect(1.3, 0.5),
  "kiosco-24hs": gridRect(1.05, 0.85),
};

const KIND_FOOTPRINTS: Record<MapArtifactKind, MapAssetFootprint> = {
  tree: { width: 0.75, height: 0.75, shape: "circle" },
  house: { width: 1.35, height: 1.1, shape: "rect" },
  court: { width: 1.8, height: 1.2, shape: "rect" },
  vehicle: { width: 1.5, height: 0.75, shape: "rect" },
  mountain: { width: 1.45, height: 1.05, shape: "triangle" },
  water: { width: 1.6, height: 1.6, shape: "ellipse" },
  sign: { width: 0.7, height: 0.2, shape: "rect" },
  plaza: { width: 1.65, height: 1.65, shape: "circle" },
  decor: { width: 0.7, height: 0.7, shape: "circle" },
  custom: { width: 1, height: 1, shape: "rect" },
};

export function defaultAssetFootprint(assetOrKind?: MapAssetDef | MapArtifactKind): MapAssetFootprint {
  const asset = typeof assetOrKind === "string" ? undefined : assetOrKind;
  const kind = typeof assetOrKind === "string" ? assetOrKind : assetOrKind?.kind;
  const projection = asset ? projectionSourceForAsset(asset) : undefined;
  if (projection) return footprintFromProjection(projection);
  return { ...(KIND_FOOTPRINTS[kind ?? "custom"] ?? KIND_FOOTPRINTS.custom) };
}

export function projectArtifactFootprint(
  artifact: Pick<MapArtifact, "position" | "scale">,
  asset?: MapAssetDef,
  spacing = BOARD_GRID_SPACING
): PlaneProjection {
  const local = localAssetProjection(asset, spacing);
  const scale = artifact.scale ?? 1;
  const rotation = artifact.position.rot ?? 0;
  const points = local.points.map((point) => {
    const rotated = projectGroundPointToMap(point, rotation);
    return {
      x: artifact.position.x + rotated.x * scale,
      y: artifact.position.y + rotated.y * scale,
    };
  });
  const bounds = boundsFromPlanePoints(points);
  return { points, bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, shape: local.shape };
}

export function localAssetProjection(asset?: MapAssetDef, spacing = BOARD_GRID_SPACING): PlaneProjection {
  const projection = projectionSourceForAsset(asset);
  if (projection) return planeProjectionFromSource(projection, spacing);
  return planeProjectionFromFootprint(asset?.footprint ?? defaultAssetFootprint(asset?.kind));
}

export function projectGroundPointToMap(point: MapGridPoint, rotationDegrees: number): MapGridPoint {
  const radians = (rotationDegrees / 180) * Math.PI;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: round(point.x * cos + point.y * sin),
    y: round(-point.x * sin + point.y * cos),
  };
}

export function assetProjectionRadius(asset?: MapAssetDef): number {
  const local = localAssetProjection(asset);
  return Math.max(
    0.1,
    ...local.points.map((point) => Math.hypot(point.x, point.y)),
    local.width / 2,
    local.height / 2
  );
}

export function assetRotateHandlePoint(artifact: Pick<MapArtifact, "position" | "scale">, asset?: MapAssetDef): MapGridPoint {
  const local = localAssetProjection(asset);
  const radius = Math.max(local.height / 2 + 0.45, assetProjectionRadius(asset) + 0.3);
  const rotated = projectGroundPointToMap({ x: 0, y: -radius }, artifact.position.rot ?? 0);
  const scale = artifact.scale ?? 1;
  return {
    x: artifact.position.x + rotated.x * scale,
    y: artifact.position.y + rotated.y * scale,
  };
}

export function assetScaleHandlePoint(artifact: Pick<MapArtifact, "position" | "scale">, asset?: MapAssetDef): MapGridPoint {
  const local = localAssetProjection(asset);
  const rotated = projectGroundPointToMap({ x: local.bounds.maxX, y: local.bounds.maxY }, artifact.position.rot ?? 0);
  const scale = artifact.scale ?? 1;
  return {
    x: artifact.position.x + rotated.x * scale,
    y: artifact.position.y + rotated.y * scale,
  };
}

export function svgPathFromPlanePoints(points: MapGridPoint[]): string {
  if (!points.length) return "";
  const [first, ...rest] = points;
  return `M${first.x},${first.y} ${rest.map((point) => `L${point.x},${point.y}`).join(" ")} Z`;
}

// Projects any loaded Three.js object onto the board plane by walking geometry vertices in world space.
export function projectObject3DToGroundPlane(object: Object3D, spacing = BOARD_GRID_SPACING): PlaneProjection {
  const points: MapGridPoint[] = [];
  const vertex = new Vector3();
  object.updateMatrixWorld(true);

  object.traverse((child) => {
    const geometry = (child as { geometry?: { attributes?: { position?: unknown }; getAttribute?: (name: string) => unknown } }).geometry;
    const position = geometry?.getAttribute?.("position") as
      | { count: number; getX: (index: number) => number; getY: (index: number) => number; getZ: (index: number) => number }
      | undefined;
    if (!position) return;

    for (let index = 0; index < position.count; index += 1) {
      vertex.set(position.getX(index), position.getY(index), position.getZ(index));
      vertex.applyMatrix4(child.matrixWorld);
      points.push({ x: vertex.x / spacing, y: vertex.z / spacing });
    }
  });

  if (!points.length) {
    const box = new Box3().setFromObject(object);
    if (!box.isEmpty()) {
      points.push(
        { x: box.min.x / spacing, y: box.min.z / spacing },
        { x: box.max.x / spacing, y: box.min.z / spacing },
        { x: box.max.x / spacing, y: box.max.z / spacing },
        { x: box.min.x / spacing, y: box.max.z / spacing }
      );
    }
  }

  const hull = convexHull(points);
  const resolvedPoints = hull.length >= 3 ? hull : boundsToPlanePoints(boundsFromPlanePoints(points));
  const bounds = boundsFromPlanePoints(resolvedPoints);
  return { points: resolvedPoints, bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, shape: "rect" };
}

function projectionSourceForAsset(asset?: MapAssetDef): ProjectionSource | undefined {
  if (!asset) return undefined;
  if (asset.projection) {
    return {
      shape: asset.projection.shape ?? asset.footprint?.shape ?? "rect",
      points: asset.projection.points,
      bounds: asset.projection.bounds,
    };
  }
  return BUILT_IN_ASSET_PROJECTIONS[asset.id];
}

function footprintFromProjection(projection: ProjectionSource): MapAssetFootprint {
  const plane = planeProjectionFromSource(projection, BOARD_GRID_SPACING);
  return {
    width: round(plane.width),
    height: round(plane.height),
    shape: projection.shape,
  };
}

function planeProjectionFromSource(projection: ProjectionSource, spacing: number): PlaneProjection {
  const points = projection.points?.length
    ? projection.points.map((point) => ({ x: round(point.x / spacing), y: round(point.z / spacing) }))
    : boundsToPlanePoints(boundsFromProjectionBounds(projection.bounds ?? fallbackProjectionBounds()));
  const scaledPoints = projection.points?.length ? points : points.map((point) => ({ x: round(point.x / spacing), y: round(point.y / spacing) }));
  const resolvedPoints =
    projection.shape === "circle" || projection.shape === "ellipse"
      ? ellipsePointsFromBounds(boundsFromPlanePoints(scaledPoints), projection.shape === "circle")
      : scaledPoints;
  const bounds = boundsFromPlanePoints(resolvedPoints);
  return { points: resolvedPoints, bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, shape: projection.shape };
}

function planeProjectionFromFootprint(footprint: MapAssetFootprint): PlaneProjection {
  const halfWidth = footprint.width / 2;
  const halfHeight = footprint.height / 2;
  const bounds = { minX: -halfWidth, minY: -halfHeight, maxX: halfWidth, maxY: halfHeight };
  const points =
    footprint.shape === "circle" || footprint.shape === "ellipse"
      ? ellipsePointsFromBounds(bounds, footprint.shape === "circle")
      : footprint.shape === "triangle"
        ? [
            { x: 0, y: -halfHeight },
            { x: halfWidth, y: halfHeight },
            { x: -halfWidth, y: halfHeight },
          ]
        : boundsToPlanePoints(bounds);
  const resolvedBounds = boundsFromPlanePoints(points);
  return {
    points,
    bounds: resolvedBounds,
    width: resolvedBounds.maxX - resolvedBounds.minX,
    height: resolvedBounds.maxY - resolvedBounds.minY,
    shape: footprint.shape,
  };
}

function boundsFromProjectionBounds(bounds: MapAssetProjectionBounds): ProjectionBounds {
  return {
    minX: bounds.minX,
    minY: bounds.minZ,
    maxX: bounds.maxX,
    maxY: bounds.maxZ,
  };
}

function fallbackProjectionBounds(): MapAssetProjectionBounds {
  return { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 };
}

function boundsToPlanePoints(bounds: ProjectionBounds): MapGridPoint[] {
  return [
    { x: round(bounds.minX), y: round(bounds.minY) },
    { x: round(bounds.maxX), y: round(bounds.minY) },
    { x: round(bounds.maxX), y: round(bounds.maxY) },
    { x: round(bounds.minX), y: round(bounds.maxY) },
  ];
}

function boundsFromPlanePoints(points: MapGridPoint[]): ProjectionBounds {
  if (!points.length) return { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 };
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function ellipsePointsFromBounds(bounds: ProjectionBounds, forceCircle: boolean): MapGridPoint[] {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const radiusX = forceCircle ? Math.max(width, height) / 2 : width / 2;
  const radiusY = forceCircle ? Math.max(width, height) / 2 : height / 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return Array.from({ length: 32 }, (_, index) => {
    const theta = (index / 32) * Math.PI * 2;
    return {
      x: round(centerX + Math.cos(theta) * radiusX),
      y: round(centerY + Math.sin(theta) * radiusY),
    };
  });
}

function convexHull(points: MapGridPoint[]): MapGridPoint[] {
  const deduped = Array.from(
    new Map(points.map((point) => [`${round(point.x)}:${round(point.y)}`, { x: round(point.x), y: round(point.y) }])).values()
  ).sort((a, b) => a.x - b.x || a.y - b.y);
  if (deduped.length <= 2) return deduped;

  const lower: MapGridPoint[] = [];
  for (const point of deduped) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }

  const upper: MapGridPoint[] = [];
  for (let index = deduped.length - 1; index >= 0; index -= 1) {
    const point = deduped[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross(origin: MapGridPoint, a: MapGridPoint, b: MapGridPoint): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
