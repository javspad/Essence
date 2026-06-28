import type { TileLayout } from "@essence/shared";

export interface ScreenPosition {
  left: number;
  top: number;
}

export interface CameraFocus {
  x: number;
  y: number;
  scale: number;
}

export function screenPosition(layout: TileLayout, maxX: number, maxY: number): ScreenPosition {
  const x = layout.x / maxX;
  const y = layout.y / maxY;
  return {
    left: 50 + (x - y) * 34,
    top: 18 + (x + y) * 32,
  };
}

export function cameraFocus(pos: ScreenPosition): CameraFocus {
  return {
    x: clamp(50 - pos.left, -18, 18),
    y: clamp(50 - pos.top, -14, 18),
    scale: 1.08,
  };
}

export function movementPath(position: number, lastRoll: number | null, boardLength: number): number[] {
  if (!lastRoll || lastRoll < 1 || boardLength < 1) return [];
  const end = clamp(Math.floor(position), 0, boardLength - 1);
  const start = clamp(end - Math.floor(lastRoll), 0, boardLength - 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function perimeterLayout(index: number, count: number): TileLayout {
  const edge = Math.max(1, Math.ceil(count / 4));
  const i = index % (edge * 4);

  if (i <= edge) return { x: i, y: 0, rot: 0 };
  if (i <= edge * 2) return { x: edge, y: i - edge, rot: 90 };
  if (i <= edge * 3) return { x: edge - (i - edge * 2), y: edge, rot: 180 };
  return { x: 0, y: edge - (i - edge * 3), rot: -90 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
