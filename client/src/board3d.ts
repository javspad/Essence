import type { MapArtifact, MapBoardShape, MapRoute, MapTerrain, Tile, TileLayout, TileType } from "@essence/shared";
import { perimeterLayout } from "./boardView";

type Board3DTile = Pick<Tile, "id" | "layout"> & Partial<Pick<Tile, "type">>;
export type Vec3 = [number, number, number];

export interface Board3DSlot {
  id: number;
  type?: TileType;
  position: Vec3;
  rotationY: number;
}

export interface Board3DMapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  spacing: number;
}

export type SlotDecal = "ring" | "coin" | "star" | "diamond" | "bolt";

export interface SlotMaterialStyle {
  top: string;
  side: string;
  accent: string;
  emissive: string;
  decal: SlotDecal;
}

export interface TerrainMaterialStyle {
  top: string;
  side: string;
  glow: string;
  width: number;
}

export interface BoardMotionSettings {
  cameraLerpSpeed: number;
  tokenStepSeconds: number;
  orbitLights: boolean;
}

export interface BoardRenderSignals {
  devicePixelRatio: number;
  viewportWidth: number;
  visible: boolean;
}

export interface BoardRenderSettings {
  dpr: [number, number];
  antialias: boolean;
  shadows: boolean;
  frameloop: "always" | "demand";
  powerPreference: WebGLPowerPreference;
}

export const BOARD_GRID_SPACING = 1.35;

const DEFAULT_SLOT_STYLE: SlotMaterialStyle = {
  top: "#64748b",
  side: "#334155",
  accent: "#e2e8f0",
  emissive: "#000000",
  decal: "ring",
};

const SLOT_STYLE: Record<TileType, SlotMaterialStyle> = {
  start: { top: "#cbd5e1", side: "#475569", accent: "#f8fafc", emissive: "#e2e8f0", decal: "coin" },
  finish: { top: "#f59e0b", side: "#92400e", accent: "#fef3c7", emissive: "#fbbf24", decal: "star" },
  minigame: { top: "#6366f1", side: "#3730a3", accent: "#c4b5fd", emissive: "#818cf8", decal: "diamond" },
  trivia: { top: "#38bdf8", side: "#0369a1", accent: "#e0f2fe", emissive: "#7dd3fc", decal: "ring" },
  vote: { top: "#8b5cf6", side: "#5b21b6", accent: "#ddd6fe", emissive: "#a78bfa", decal: "diamond" },
  judge: { top: "#ec4899", side: "#9d174d", accent: "#fce7f3", emissive: "#f472b6", decal: "coin" },
  dare: { top: "#f43f5e", side: "#9f1239", accent: "#ffe4e6", emissive: "#fb7185", decal: "bolt" },
  fate: { top: "#d946ef", side: "#86198f", accent: "#fae8ff", emissive: "#e879f9", decal: "diamond" },
  groom: { top: "#facc15", side: "#a16207", accent: "#fef9c3", emissive: "#fde047", decal: "star" },
  star: { top: "#fde047", side: "#ca8a04", accent: "#fefce8", emissive: "#facc15", decal: "star" },
  reaction: { top: "#22c55e", side: "#166534", accent: "#dcfce7", emissive: "#4ade80", decal: "bolt" },
  estimate: { top: "#06b6d4", side: "#0e7490", accent: "#cffafe", emissive: "#22d3ee", decal: "ring" },
};

const TERRAIN_STYLE: Record<MapTerrain, TerrainMaterialStyle> = {
  stone: { top: "#d8c28a", side: "#9a7b43", glow: "#fff7c2", width: 0.38 },
  grass: { top: "#7ccf63", side: "#3f8f3f", glow: "#d9f99d", width: 0.34 },
  sand: { top: "#f0c878", side: "#b9823c", glow: "#fde68a", width: 0.42 },
  water: { top: "#67d6f7", side: "#0e7490", glow: "#bae6fd", width: 0.34 },
  asphalt: { top: "#8b95a3", side: "#475569", glow: "#e2e8f0", width: 0.36 },
  magic: { top: "#d8b4fe", side: "#7e22ce", glow: "#f5d0fe", width: 0.4 },
};

export function board3DMapBounds(
  tiles: Board3DTile[],
  routes: Pick<MapRoute, "points">[] = [],
  artifacts: Pick<MapArtifact, "position">[] = [],
  boardShapeOrSpacing?: MapBoardShape | number,
  spacing = BOARD_GRID_SPACING
): Board3DMapBounds {
  const boardShape = typeof boardShapeOrSpacing === "number" ? undefined : boardShapeOrSpacing;
  const resolvedSpacing = typeof boardShapeOrSpacing === "number" ? boardShapeOrSpacing : spacing;
  const layouts = [
    ...tiles.map((tile, index) => tile.layout ?? perimeterLayout(index, tiles.length)),
    ...routes.flatMap((route) => route.points ?? []),
    ...artifacts.map((artifact) => artifact.position),
    ...(boardShape
      ? [
          { x: boardShape.minX, y: boardShape.minY },
          { x: boardShape.maxX, y: boardShape.maxY },
          ...(boardShape.borderEdges ?? []).flatMap((edge) => [edge.from, edge.to]),
        ]
      : []),
  ];
  const minX = boardShape ? Math.min(boardShape.minX, ...layouts.map((layout) => layout.x)) : Math.min(0, ...layouts.map((layout) => layout.x));
  const minY = boardShape ? Math.min(boardShape.minY, ...layouts.map((layout) => layout.y)) : Math.min(0, ...layouts.map((layout) => layout.y));
  const maxX = Math.max(1, ...(boardShape ? [boardShape.maxX] : []), ...layouts.map((layout) => layout.x));
  const maxY = Math.max(1, ...(boardShape ? [boardShape.maxY] : []), ...layouts.map((layout) => layout.y));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    spacing: resolvedSpacing,
  };
}

export function board3DSlots(
  tiles: Board3DTile[],
  spacing = BOARD_GRID_SPACING,
  bounds = board3DMapBounds(tiles, [], [], undefined, spacing)
): Board3DSlot[] {
  const layouts = tiles.map((tile, index) => tile.layout ?? perimeterLayout(index, tiles.length));

  return tiles.map((tile, index) => ({
    id: tile.id,
    ...(tile.type ? { type: tile.type } : {}),
    position: layoutToWorldPosition(layouts[index], bounds.maxX, bounds.maxY, bounds.spacing, bounds.minX, bounds.minY),
    rotationY: ((layouts[index].rot ?? 0) / 180) * Math.PI,
  }));
}

export function layoutToWorldPosition(
  layout: TileLayout,
  maxX: number,
  maxY: number,
  spacing = BOARD_GRID_SPACING,
  minX = 0,
  minY = 0
): Vec3 {
  const centerX = minX + (maxX - minX) / 2;
  const centerY = minY + (maxY - minY) / 2;
  return [
    (layout.x - centerX) * spacing,
    layout.z ?? 0,
    (layout.y - centerY) * spacing,
  ];
}

export function tokenWorldPosition(slotPosition: Vec3, stackIndex: number, stackTotal: number): Vec3 {
  const offset = tokenStackOffset(stackIndex, stackTotal);
  return [
    round(slotPosition[0] + offset[0]),
    round(slotPosition[1] + offset[1]),
    round(slotPosition[2] + offset[2]),
  ];
}

export function tokenPathPositions(
  slotPositions: Map<number, Vec3>,
  tileIds: number[],
  stackIndex: number,
  stackTotal: number
): Vec3[] {
  return tileIds.flatMap((id) => {
    const slotPosition = slotPositions.get(id);
    return slotPosition ? [tokenWorldPosition(slotPosition, stackIndex, stackTotal)] : [];
  });
}

export function routeWorldPoints(
  route: MapRoute,
  slotPositions: Map<number, Vec3>,
  bounds: Board3DMapBounds
): Vec3[] {
  const from = slotPositions.get(route.from);
  const to = slotPositions.get(route.to);
  if (!from || !to) return [];
  const points = (route.points ?? []).map((point) =>
    layoutToWorldPosition(point, bounds.maxX, bounds.maxY, bounds.spacing, bounds.minX, bounds.minY)
  );
  return [from, ...points, to];
}

export function cameraFollowPosition(slotPosition: Vec3): Vec3 {
  return [slotPosition[0], 6.6, slotPosition[2] + 7.5];
}

export function boardMotionSettings(prefersReducedMotion: boolean, visible = true): BoardMotionSettings {
  return prefersReducedMotion || !visible
    ? { cameraLerpSpeed: 0, tokenStepSeconds: 0, orbitLights: false }
    : { cameraLerpSpeed: 3, tokenStepSeconds: 0.22, orbitLights: true };
}

export function boardRenderSettings(signals: BoardRenderSignals): BoardRenderSettings {
  const mobileBudget = signals.viewportWidth < 640 || signals.devicePixelRatio > 2;
  const maxDpr = mobileBudget ? 1 : Math.min(1.5, Math.max(1, signals.devicePixelRatio || 1));

  return {
    dpr: [1, round(maxDpr)],
    antialias: !mobileBudget,
    shadows: signals.visible && !mobileBudget,
    frameloop: signals.visible ? "always" : "demand",
    powerPreference: mobileBudget ? "default" : "high-performance",
  };
}

export function frameLerp(deltaSeconds: number, speed: number): number {
  if (speed <= 0) return 1;
  return Math.min(1, round(deltaSeconds * speed));
}

export function orbitLightPosition(timeSeconds: number, reducedMotion: boolean): Vec3 {
  if (reducedMotion) return [-4.5, 5.2, -3.5];
  const angle = timeSeconds * 0.6;
  return [round(Math.cos(angle) * 5.5), round(4.8 + Math.sin(timeSeconds * 1.2) * 0.35), round(Math.sin(angle) * 5.5)];
}

export function slotMaterialStyle(type?: TileType): SlotMaterialStyle {
  return type ? SLOT_STYLE[type] : DEFAULT_SLOT_STYLE;
}

export function terrainMaterialStyle(terrain: MapTerrain = "stone"): TerrainMaterialStyle {
  return TERRAIN_STYLE[terrain];
}

export function supportsWebGL(canvas?: { getContext: (name: string) => unknown } | null): boolean {
  try {
    const target = canvas ?? (typeof document === "undefined" ? null : document.createElement("canvas"));
    return Boolean(
      target?.getContext("webgl2") ?? target?.getContext("webgl") ?? target?.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

function tokenStackOffset(index: number, total: number): Vec3 {
  const safeTotal = Math.max(1, total);
  const columns = Math.min(safeTotal, 3);
  const safeIndex = Math.max(0, index);
  const row = Math.floor(safeIndex / columns);
  const column = safeIndex % columns;
  const spacing = 0.28;
  const x = columns === 1 ? 0 : (column - (columns - 1) / 2) * spacing;
  const z = safeTotal > columns ? (row - 0.5) * spacing : 0;
  return [round(x), round(0.36 + row * 0.08), round(z)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
