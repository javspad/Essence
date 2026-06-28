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
