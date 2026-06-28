import type { Tile, TileLayout, TileType } from "@essence/shared";
import { perimeterLayout } from "./boardView";

type Board3DTile = Pick<Tile, "id" | "layout"> & Partial<Pick<Tile, "type">>;

export interface Board3DSlot {
  id: number;
  type?: TileType;
  position: [number, number, number];
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
): [number, number, number] {
  return [
    (layout.x - maxX / 2) * spacing,
    layout.z ?? 0,
    (layout.y - maxY / 2) * spacing,
  ];
}
