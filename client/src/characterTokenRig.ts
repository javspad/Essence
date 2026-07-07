import type { FaceAnchor } from "@essence/shared";

export type TokenAnchorScope = "face" | "body";

export interface TokenAnchorHandle {
  id: string;
  scope: TokenAnchorScope;
}

export interface TokenAnchorSurface {
  position: [number, number, number];
  normal: [number, number, number];
}

export const TOKEN_PREVIEW_GROUP_POSITION: [number, number, number] = [0, -0.78, 0];
export const TOKEN_PREVIEW_GROUP_SCALE = 2.35;
export const TOKEN_FACE_SURFACE_CENTER: [number, number, number] = [0, 0.506, 0.136];
export const TOKEN_FACE_SURFACE_NORMAL: [number, number, number] = [0, 0.15, 0.989];
export const TOKEN_FACE_SURFACE_UP: [number, number, number] = [0, 0.989, -0.15];
export const TOKEN_FACE_ANCHOR_SPAN = 0.74;

export function defaultTokenAnchor(id: string): FaceAnchor {
  switch (id) {
    case "leftEye":
      return { x: 0.42, y: 0.38, angle: 0 };
    case "rightEye":
      return { x: 0.58, y: 0.38, angle: 0 };
    case "mouth":
      return { x: 0.5, y: 0.62, angle: 0 };
    case "head":
      return { x: 0.5, y: 0.16, angle: 0 };
    case "chest":
      return { x: 0.5, y: 0.44, angle: 0 };
    case "leftHand":
      return { x: 0.28, y: 0.46, angle: 0 };
    case "rightHand":
      return { x: 0.72, y: 0.46, angle: 0 };
    case "back":
      return { x: 0.5, y: 0.48, angle: 0 };
    default:
      return { x: 0.5, y: 0.5, angle: 0 };
  }
}

export function tokenAnchorSurface(handle: TokenAnchorHandle, anchor: FaceAnchor = defaultTokenAnchor(handle.id)): TokenAnchorSurface {
  if (handle.scope === "face") return faceAnchorSurface(anchor);
  return bodyAnchorSurface(handle.id, anchor);
}

function faceAnchorSurface(anchor: FaceAnchor): TokenAnchorSurface {
  const x = (anchor.x - 0.5) * TOKEN_FACE_ANCHOR_SPAN;
  const up = (0.5 - anchor.y) * TOKEN_FACE_ANCHOR_SPAN;
  return {
    position: [
      x,
      TOKEN_FACE_SURFACE_CENTER[1] + up * TOKEN_FACE_SURFACE_UP[1],
      TOKEN_FACE_SURFACE_CENTER[2] + up * TOKEN_FACE_SURFACE_UP[2],
    ],
    normal: TOKEN_FACE_SURFACE_NORMAL,
  };
}

function bodyAnchorSurface(id: string, anchor: FaceAnchor): TokenAnchorSurface {
  const isHand = id === "leftHand" || id === "rightHand";
  const width = isHand ? 0.96 : 0.68;
  const x = (anchor.x - 0.5) * width;
  const y = 0.72 - anchor.y * 0.88;

  if (id === "back") {
    return {
      position: [x * 0.62, y, -frontZForBody(x * 0.62, y) - 0.025],
      normal: [0, 0, -1],
    };
  }

  if (id === "leftHand") {
    return {
      position: [x - 0.025, y, Math.max(0.08, frontZForBody(x * 0.5, y) * 0.74)],
      normal: [-0.62, 0.08, 0.78],
    };
  }

  if (id === "rightHand") {
    return {
      position: [x + 0.025, y, Math.max(0.08, frontZForBody(x * 0.5, y) * 0.74)],
      normal: [0.62, 0.08, 0.78],
    };
  }

  return {
    position: [x, y, frontZForBody(x, y) + 0.018],
    normal: [0, 0.1, 0.995],
  };
}

function frontZForBody(x: number, y: number): number {
  if (y > 0.4) {
    const radius = 0.145;
    const dy = y - 0.5;
    return Math.sqrt(Math.max(0.004, radius * radius - x * x - dy * dy));
  }

  const radius = 0.19;
  const dy = (y - 0.235) / 1.15;
  return Math.sqrt(Math.max(0.01, radius * radius - x * x - dy * dy));
}
