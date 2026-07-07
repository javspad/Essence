import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Rotate3D, RotateCcw } from "lucide-react";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { CharacterDef, CosmeticDef, FaceAnchor, FacePhotoAlignment } from "@essence/shared";
import { characterDisplayName } from "@essence/shared/characters";
import {
  TOKEN_PREVIEW_GROUP_POSITION,
  TOKEN_PREVIEW_GROUP_SCALE,
  defaultTokenAnchor,
  tokenAnchorSurface,
  type TokenAnchorHandle,
} from "../characterTokenRig";
import { PlayerTokenPawn } from "./Board3DShell";

export const DEFAULT_TOKEN_PREVIEW_ROTATION = { yaw: 0, pitch: 0 };
export const TOKEN_PREVIEW_VIEWS = [
  { id: "front", label: "Front", yaw: 0, pitch: 0 },
  { id: "left", label: "Left", yaw: Math.PI / 2, pitch: 0 },
  { id: "back", label: "Back", yaw: Math.PI, pitch: 0 },
  { id: "right", label: "Right", yaw: -Math.PI / 2, pitch: 0 },
] as const;

export type TokenPreviewRotation = typeof DEFAULT_TOKEN_PREVIEW_ROTATION;

export interface TokenPreviewAnchorHandle extends TokenAnchorHandle {
  id: string;
  label: string;
  scope: "face" | "body";
}

export interface ProjectedTokenAnchor {
  x: number;
  y: number;
  visible: boolean;
}

interface TokenPreviewCanvasProps {
  character: CharacterDef;
  cosmetics: Record<string, CosmeticDef>;
  cosmeticIds?: string[];
  previewRotation: TokenPreviewRotation;
  anchorProjectionInput?: Array<{ handle: TokenPreviewAnchorHandle; anchor: FaceAnchor }>;
  onAnchorsProjected?: (anchors: Record<string, ProjectedTokenAnchor>) => void;
  facePhotoAlignmentFallback?: FacePhotoAlignment;
  className?: string;
}

export function useTokenPreviewRotation() {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewRotation, setPreviewRotation] = useState<TokenPreviewRotation>(DEFAULT_TOKEN_PREVIEW_ROTATION);
  const [previewDrag, setPreviewDrag] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    rotation: TokenPreviewRotation;
  } | null>(null);

  const beginPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    previewRef.current?.setPointerCapture(event.pointerId);
    setPreviewDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rotation: previewRotation,
    });
  };

  const movePreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!previewDrag || previewDrag.pointerId !== event.pointerId) return;
    setPreviewRotation({
      yaw: previewDrag.rotation.yaw + (event.clientX - previewDrag.startX) * 0.012,
      pitch: clamp(previewDrag.rotation.pitch + (event.clientY - previewDrag.startY) * 0.008, -0.55, 0.55),
    });
  };

  const endPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!previewDrag || previewDrag.pointerId !== event.pointerId) return;
    if (previewRef.current?.hasPointerCapture(event.pointerId)) {
      previewRef.current.releasePointerCapture(event.pointerId);
    }
    setPreviewDrag(null);
  };

  return {
    previewRef,
    previewRotation,
    setPreviewRotation,
    beginPreviewDrag,
    movePreviewDrag,
    endPreviewDrag,
    isPreviewDragging: Boolean(previewDrag),
  };
}

export function TokenPreviewViewControls({
  setPreviewRotation,
  onViewChange,
}: {
  setPreviewRotation: (rotation: TokenPreviewRotation) => void;
  onViewChange?: () => void;
}) {
  return (
    <>
      <div className="flex overflow-hidden rounded-md border border-white/10 bg-black/20">
        {TOKEN_PREVIEW_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            data-preview-view={view.id}
            onClick={() => {
              onViewChange?.();
              setPreviewRotation({ yaw: view.yaw, pitch: view.pitch });
            }}
            className="border-r border-white/10 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-300 transition last:border-r-0 hover:bg-white/10 hover:text-white"
          >
            {view.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          onViewChange?.();
          setPreviewRotation(DEFAULT_TOKEN_PREVIEW_ROTATION);
        }}
        className="builder-button compact"
        aria-label="Reset preview rotation"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </>
  );
}

export function TokenPreviewMoveBadge({ label = "Move" }: { label?: string }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.12em] text-slate-300">
      <Rotate3D className="h-3.5 w-3.5 text-cyan-200" />
      {label}
    </div>
  );
}

export function TokenPreviewCanvas({
  character,
  cosmetics,
  cosmeticIds,
  previewRotation,
  anchorProjectionInput = [],
  onAnchorsProjected,
  facePhotoAlignmentFallback,
  className = "pointer-events-none absolute inset-0",
}: TokenPreviewCanvasProps) {
  const tokenCharacter = useMemo(
    () => ({
      id: character.id,
      name: characterDisplayName(character),
      color: character.color ?? "#888888",
      groom: Boolean(character.groom),
    }),
    [character.color, character.groom, character.id, character.displayName, character.name]
  );

  return (
    <Canvas
      camera={{ position: [0, 1.05, 3.4], fov: 32, near: 0.1, far: 20 }}
      className={className}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      shadows
    >
      <PreviewCamera />
      <ambientLight intensity={0.72} color="#fff8e1" />
      <directionalLight position={[3, 5, 4]} intensity={2.7} castShadow />
      <directionalLight position={[-3, 2, -3]} intensity={0.65} color="#b3d4ff" />
      {onAnchorsProjected ? (
        <PreviewAnchorProjector
          anchors={anchorProjectionInput}
          previewRotation={previewRotation}
          onProject={onAnchorsProjected}
        />
      ) : null}
      <group
        position={TOKEN_PREVIEW_GROUP_POSITION}
        rotation={[previewRotation.pitch, previewRotation.yaw, 0]}
        scale={TOKEN_PREVIEW_GROUP_SCALE}
      >
        <PlayerTokenPawn
          character={tokenCharacter}
          facePhoto={character.facePhoto}
          facePhotoAlignment={character.facePhotoAlignment ?? facePhotoAlignmentFallback}
          faceAnchors={character.faceAnchors}
          bodyAnchors={character.bodyAnchors}
          cosmeticIds={cosmeticIds}
          cosmeticCatalog={cosmetics}
          focused
        />
      </group>
      <mesh position={[0, -0.84, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.24, 56]} />
        <meshStandardMaterial color="#0f172a" roughness={0.72} transparent opacity={0.58} />
      </mesh>
    </Canvas>
  );
}

export function tokenPreviewAnchorForCharacter(character: CharacterDef, handle: TokenPreviewAnchorHandle): FaceAnchor {
  const anchors = handle.scope === "face" ? character.faceAnchors : character.bodyAnchors;
  return anchors?.[handle.id] ?? defaultTokenAnchor(handle.id);
}

export function tokenPreviewAnchorLabel(id: string): string {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

export function sameProjectedTokenAnchors(
  a: Record<string, ProjectedTokenAnchor>,
  b: Record<string, ProjectedTokenAnchor>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return bKeys.every((key) => {
    const left = a[key];
    const right = b[key];
    return Boolean(
      left &&
        Math.abs(left.x - right.x) < 0.05 &&
        Math.abs(left.y - right.y) < 0.05 &&
        left.visible === right.visible
    );
  });
}

function PreviewAnchorProjector({
  anchors,
  previewRotation,
  onProject,
}: {
  anchors: Array<{ handle: TokenPreviewAnchorHandle; anchor: FaceAnchor }>;
  previewRotation: TokenPreviewRotation;
  onProject: (anchors: Record<string, ProjectedTokenAnchor>) => void;
}) {
  const { camera } = useThree();
  const anchorKey = useMemo(
    () => anchors.map(({ handle, anchor }) => `${handle.scope}:${handle.id}:${anchor.x}:${anchor.y}:${anchor.angle ?? 0}`).join("|"),
    [anchors]
  );

  useEffect(() => {
    camera.updateMatrixWorld();
    const rotation = new Euler(previewRotation.pitch, previewRotation.yaw, 0);
    const rotationQuaternion = new Quaternion().setFromEuler(rotation);
    const tokenMatrix = new Matrix4().compose(
      new Vector3(...TOKEN_PREVIEW_GROUP_POSITION),
      rotationQuaternion,
      new Vector3(TOKEN_PREVIEW_GROUP_SCALE, TOKEN_PREVIEW_GROUP_SCALE, TOKEN_PREVIEW_GROUP_SCALE)
    );
    const projected: Record<string, ProjectedTokenAnchor> = {};

    for (const { handle, anchor } of anchors) {
      const surface = tokenAnchorSurface(handle, anchor);
      const worldPoint = new Vector3(...surface.position).applyMatrix4(tokenMatrix);
      const normal = new Vector3(...surface.normal).applyQuaternion(rotationQuaternion).normalize();
      const viewDirection = new Vector3().subVectors(camera.position, worldPoint).normalize();
      const clipPoint = worldPoint.clone().project(camera);
      projected[handle.id] = {
        x: ((clipPoint.x + 1) / 2) * 100,
        y: ((1 - clipPoint.y) / 2) * 100,
        visible: clipPoint.z >= -1 && clipPoint.z <= 1 && normal.dot(viewDirection) > -0.05,
      };
    }

    onProject(projected);
  }, [anchorKey, anchors, camera, onProject, previewRotation.pitch, previewRotation.yaw]);

  return null;
}

function PreviewCamera() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 1.05, 3.4);
    camera.lookAt(0, 0.16, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
