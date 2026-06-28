import type { Tile, TileLayout, TileType } from "@essence/shared";
import { perimeterLayout } from "./boardView";

type Board3DTile = Pick<Tile, "id" | "layout"> & Partial<Pick<Tile, "type">>;
export type Vec3 = [number, number, number];

export interface Board3DSlot {
  id: number;
  type?: TileType;
  position: Vec3;
  rotationY: number;
}

export type SlotDecal = "ring" | "coin" | "star" | "diamond" | "bolt";

export interface SlotMaterialStyle {
  top: string;
  side: string;
  accent: string;
  emissive: string;
  decal: SlotDecal;
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

export function board3DSlots(tiles: Board3DTile[], spacing = 1.35): Board3DSlot[] {
  const layouts = tiles.map((tile, index) => tile.layout ?? perimeterLayout(index, tiles.length));
  const maxX = Math.max(1, ...layouts.map((layout) => layout.x));
  const maxY = Math.max(1, ...layouts.map((layout) => layout.y));

  return tiles.map((tile, index) => ({
    id: tile.id,
    ...(tile.type ? { type: tile.type } : {}),
    position: layoutToWorldPosition(layouts[index], maxX, maxY, spacing),
    rotationY: ((layouts[index].rot ?? 0) / 180) * Math.PI,
  }));
}

export function layoutToWorldPosition(
  layout: TileLayout,
  maxX: number,
  maxY: number,
  spacing = 1.35
): Vec3 {
  return [
    (layout.x - maxX / 2) * spacing,
    layout.z ?? 0,
    (layout.y - maxY / 2) * spacing,
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
