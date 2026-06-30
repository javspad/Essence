import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CanvasTexture, DoubleSide, LinearFilter, SRGBColorSpace, Vector3, type Group, type PointLight } from "three";
import type { MapArtifact, MapRoute, Player, Tile } from "@essence/shared";
import {
  board3DMapBounds,
  board3DSlots,
  boardMotionSettings,
  boardRenderSettings,
  cameraFollowPosition,
  frameLerp,
  routeWorldPoints,
  orbitLightPosition,
  slotMaterialStyle,
  supportsWebGL,
  terrainMaterialStyle,
  tokenPathPositions,
  tokenWorldPosition,
  type Board3DMapBounds,
  type Board3DSlot,
  type BoardMotionSettings,
  type SlotDecal,
  type Vec3,
} from "../board3d";
import { movementPath } from "../boardView";

interface Board3DShellProps {
  tiles: Tile[];
  players?: Player[];
  routes?: MapRoute[];
  artifacts?: MapArtifact[];
  activeId?: string;
  lastRoll?: number | null;
  boardLength?: number;
  children?: ReactNode;
  className?: string;
  interactive?: boolean;
}

export default function Board3DShell({
  tiles,
  players = [],
  routes = [],
  artifacts = [],
  activeId,
  lastRoll = null,
  boardLength = tiles.length,
  children,
  className,
  interactive = false,
}: Board3DShellProps) {
  const reducedMotion = useReducedMotion();
  const visible = usePageVisible();
  const renderViewport = useRenderViewport();
  const motion = useMemo(() => boardMotionSettings(reducedMotion, visible), [reducedMotion, visible]);
  const renderSettings = useMemo(
    () => boardRenderSettings({ ...renderViewport, visible }),
    [renderViewport.devicePixelRatio, renderViewport.viewportWidth, visible]
  );
  const [webGLAvailable, setWebGLAvailable] = useState(() => supportsWebGL());
  const disableWebGL = useCallback(() => setWebGLAvailable(false), []);
  const bounds = useMemo(() => board3DMapBounds(tiles, routes, artifacts), [artifacts, routes, tiles]);
  const slots = useMemo(() => board3DSlots(tiles, 1.35, bounds), [bounds, tiles]);
  const slotPositions = useMemo(() => new Map(slots.map((slot) => [slot.id, slot.position] as const)), [slots]);
  const activePlayer = activeId ? players.find((player) => player.id === activeId) : undefined;
  const activeSlot = slotPositions.get(activePlayer?.position ?? 0) ?? [0, 0, 0];
  const activePath = new Set(movementPath(activePlayer?.position ?? -1, lastRoll, boardLength));
  const occupancy = useMemo(() => playersByPosition(players), [players]);
  const tokens = useMemo(
    () =>
      players.map((player) => {
        const stack = occupancy.get(player.position) ?? [];
        const stackIndex = Math.max(0, stack.findIndex((p) => p.id === player.id));
        const tilePath = player.id === activeId ? movementPath(player.position, lastRoll, boardLength) : [];
        const path = tokenPathPositions(
          slotPositions,
          tilePath.length ? tilePath : [player.position],
          stackIndex,
          stack.length
        );
        const fallback = tokenWorldPosition(slotPositions.get(player.position) ?? [0, 0, 0], stackIndex, stack.length);
        return {
          player,
          active: player.id === activeId,
          path: path.length ? path : [fallback],
        };
      }),
    [activeId, boardLength, lastRoll, occupancy, players, slotPositions]
  );

  const shellClassName =
    className ??
    `${interactive ? "" : "pointer-events-none"} absolute inset-0 z-0 overflow-hidden rounded-[1.5rem] bg-slate-950/60`;

  if (!webGLAvailable) return <Board3DFallback className={shellClassName} />;

  return (
    <div aria-hidden={interactive ? undefined : true} className={shellClassName}>
      <Canvas
        camera={{ position: [0, 7.2, 9], fov: 42, near: 0.1, far: 100 }}
        dpr={renderSettings.dpr}
        fallback={<Board3DFallback />}
        frameloop={renderSettings.frameloop}
        gl={{ antialias: renderSettings.antialias, alpha: true, powerPreference: renderSettings.powerPreference }}
        shadows={renderSettings.shadows}
      >
        <WebGLContextGuard onLost={disableWebGL} />
        <FollowCamera target={activeSlot} motion={motion} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 8, 6]} intensity={1.9} castShadow />
        <AnimatedPartyLights motion={motion} />

        <BoardTable artifacts={artifacts} bounds={bounds} />
        <PathRibbons slots={slots} routes={routes} slotPositions={slotPositions} bounds={bounds} />

        {slots.map((slot) => (
          <SlotPlatform
            key={slot.id}
            slot={slot}
            active={slot.id === activePlayer?.position}
            stepped={activePath.has(slot.id)}
            occupiedCount={occupancy.get(slot.id)?.length ?? 0}
          />
        ))}

        {tokens.map(({ player, active, path }) => (
          <PlayerToken key={player.id} player={player} active={active} path={path} motion={motion} />
        ))}

        {children}
      </Canvas>
    </div>
  );
}

function BoardTable({ artifacts, bounds }: { artifacts: MapArtifact[]; bounds: Board3DMapBounds }) {
  return (
    <group>
      <mesh position={[0, -0.78, 0]} receiveShadow>
        <boxGeometry args={[14.2, 0.42, 9.4]} />
        <meshStandardMaterial color="#7c4a21" roughness={0.78} />
      </mesh>
      <mesh position={[0, -0.49, 0]} receiveShadow>
        <boxGeometry args={[12.9, 0.35, 8.25]} />
        <meshStandardMaterial color="#8b4a22" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.28, 0]} receiveShadow>
        <boxGeometry args={[12.45, 0.28, 7.75]} />
        <meshStandardMaterial color="#256f3a" roughness={0.72} />
      </mesh>
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[12.05, 0.12, 7.35]} />
        <meshStandardMaterial color="#6fbe54" roughness={0.78} />
      </mesh>
      <MapArtifacts artifacts={artifacts} bounds={bounds} />
    </group>
  );
}

function PathRibbons({
  slots,
  routes,
  slotPositions,
  bounds,
}: {
  slots: Board3DSlot[];
  routes: MapRoute[];
  slotPositions: Map<number, Vec3>;
  bounds: Board3DMapBounds;
}) {
  const renderedRoutes =
    routes.length > 0
      ? routes
      : slots.slice(0, -1).map((slot, index) => ({
          id: `linear-${slot.id}-${slots[index + 1].id}`,
          from: slot.id,
          to: slots[index + 1].id,
          terrain: "stone" as const,
        }));

  return (
    <group>
      {renderedRoutes.flatMap((route) => {
        const style = terrainMaterialStyle(route.terrain);
        const points = routeWorldPoints(route, slotPositions, bounds);
        return points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          const dx = next[0] - point[0];
          const dz = next[2] - point[2];
          const length = Math.hypot(dx, dz);
          if (length < 0.01) return null;
          const y = (point[1] + next[1]) / 2 + 0.08;
          return (
            <group key={`${route.id}-${index}`}>
              <mesh
                position={[(point[0] + next[0]) / 2, y, (point[2] + next[2]) / 2]}
                rotation={[0, -Math.atan2(dz, dx), 0]}
                receiveShadow
              >
                <boxGeometry args={[Math.max(0.2, length - 0.6), 0.05, style.width]} />
                <meshStandardMaterial color={style.top} roughness={0.48} metalness={0.04} />
              </mesh>
              <mesh
                position={[(point[0] + next[0]) / 2, y - 0.035, (point[2] + next[2]) / 2]}
                rotation={[0, -Math.atan2(dz, dx), 0]}
              >
                <boxGeometry args={[Math.max(0.2, length - 0.55), 0.04, style.width + 0.14]} />
                <meshStandardMaterial color={style.side} roughness={0.65} transparent opacity={0.52} />
              </mesh>
              {route.choiceLabel && index === 0 && (
                <mesh position={[(point[0] + next[0]) / 2, y + 0.05, (point[2] + next[2]) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.16, 0.21, 24]} />
                  <meshStandardMaterial color={style.glow} emissive={style.glow} emissiveIntensity={0.12} transparent opacity={0.82} side={DoubleSide} />
                </mesh>
              )}
            </group>
          );
        });
      })}
    </group>
  );
}

function MapArtifacts({ artifacts, bounds }: { artifacts: MapArtifact[]; bounds: Board3DMapBounds }) {
  return (
    <group>
      {artifacts
        .filter((artifact) => artifact.visible !== false)
        .map((artifact) => (
          <MapArtifactMesh key={artifact.id} artifact={artifact} bounds={bounds} />
        ))}
    </group>
  );
}

function MapArtifactMesh({ artifact, bounds }: { artifact: MapArtifact; bounds: Board3DMapBounds }) {
  const position = layoutToWorldVec(artifact.position, bounds);
  const rotationY = ((artifact.position.rot ?? 0) / 180) * Math.PI;
  const scale = artifact.scale ?? 1;

  if (artifact.assetId === "river") return <River position={position} rotationY={rotationY} scale={scale} />;
  if (artifact.assetId === "pond") return <Pond position={position} scale={scale} />;
  if (artifact.assetId === "plaza") return <Plaza position={position} scale={scale} />;
  if (artifact.assetId === "mini-court") return <Court position={position} rotationY={rotationY} scale={scale} />;
  if (artifact.assetId === "club-house") return <School position={position} rotationY={rotationY} scale={scale} />;
  if (artifact.assetId === "glass-building") return <GlassBuilding position={position} rotationY={rotationY} scale={scale} />;
  if (artifact.assetId === "mountain-cluster") return <Mountains position={position} rotationY={rotationY} scale={scale} />;
  if (artifact.assetId === "party-van") return <Van position={position} rotationY={rotationY} scale={scale} />;
  if (artifact.assetId === "start-sign" || artifact.assetId === "finish-sign") {
    return (
      <TextSign
        text={artifact.label ?? (artifact.assetId === "start-sign" ? "START" : "THE END")}
        position={position}
        rotationY={rotationY}
        background={artifact.assetId === "start-sign" ? "#475569" : "#34415f"}
        color="#fff7ed"
        scale={scale}
      />
    );
  }
  return <Tree position={position} scale={scale} tint={artifact.tint} />;
}

function layoutToWorldVec(layout: { x: number; y: number; z?: number }, bounds: Board3DMapBounds): Vec3 {
  return [
    (layout.x - bounds.maxX / 2) * bounds.spacing,
    layout.z ?? 0,
    (layout.y - bounds.maxY / 2) * bounds.spacing,
  ];
}

function River({ position, rotationY, scale = 1 }: { position: Vec3; rotationY: number; scale?: number }) {
  return (
    <mesh position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]} receiveShadow>
      <boxGeometry args={[5.15, 0.05, 0.5]} />
      <meshStandardMaterial color="#38bdf8" roughness={0.28} metalness={0.03} transparent opacity={0.8} />
    </mesh>
  );
}

function Pond({ position, scale = 1 }: { position: Vec3; scale?: number }) {
  return (
    <mesh position={position} scale={[scale, scale, scale]} receiveShadow>
      <cylinderGeometry args={[0.9, 1.05, 0.06, 36]} />
      <meshStandardMaterial color="#0ea5e9" roughness={0.25} transparent opacity={0.78} />
    </mesh>
  );
}

function Plaza({ position, scale = 1 }: { position: Vec3; scale?: number }) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh receiveShadow>
        <boxGeometry args={[2.2, 0.06, 1.35]} />
        <meshStandardMaterial color="#f4d790" roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.18, 0]} receiveShadow>
        <cylinderGeometry args={[1.18, 1.32, 0.32, 48]} />
        <meshStandardMaterial color="#8b3f25" roughness={0.68} />
      </mesh>
      <mesh position={[0, 0.37, 0]} receiveShadow>
        <cylinderGeometry args={[0.96, 1.05, 0.12, 48]} />
        <meshStandardMaterial color="#86bf4f" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.45, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.62, 40]} />
        <meshStandardMaterial color="#f4d47b" roughness={0.48} />
      </mesh>
    </group>
  );
}

function Court({ position, rotationY = 0, scale = 1 }: { position: Vec3; rotationY?: number; scale?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh receiveShadow>
        <boxGeometry args={[1.6, 0.04, 1.05]} />
        <meshStandardMaterial color="#7cc879" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[1.45, 0.015, 0.04]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0.55, 0.16, -0.42]}>
        <cylinderGeometry args={[0.02, 0.02, 0.35, 8]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      <mesh position={[0.55, 0.38, -0.42]}>
        <torusGeometry args={[0.12, 0.012, 8, 18]} />
        <meshStandardMaterial color="#f97316" />
      </mesh>
    </group>
  );
}

function School({ position, rotationY = 0, scale = 1 }: { position: Vec3; rotationY?: number; scale?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.15, 1.1, 1.2]} />
        <meshStandardMaterial color="#b35a37" roughness={0.76} />
      </mesh>
      <mesh position={[0, 0.63, 0]} castShadow>
        <boxGeometry args={[2.32, 0.18, 1.34]} />
        <meshStandardMaterial color="#e8d6bd" roughness={0.55} />
      </mesh>
      {[-0.68, 0, 0.68].map((x) => (
        <mesh key={x} position={[x, 0.05, 0.62]}>
          <boxGeometry args={[0.32, 0.24, 0.025]} />
          <meshStandardMaterial color="#1e293b" emissive="#7dd3fc" emissiveIntensity={0.08} />
        </mesh>
      ))}
      <mesh position={[0, -0.46, 0.63]}>
        <boxGeometry args={[0.36, 0.32, 0.035]} />
        <meshStandardMaterial color="#334155" roughness={0.4} />
      </mesh>
    </group>
  );
}

function GlassBuilding({ position, rotationY = 0, scale = 1 }: { position: Vec3; rotationY?: number; scale?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.85, 1.1]} />
        <meshStandardMaterial color="#dbeafe" roughness={0.18} metalness={0.05} transparent opacity={0.72} />
      </mesh>
      <mesh position={[0, 0, 0.57]}>
        <boxGeometry args={[1.75, 0.58, 0.035]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.3} />
      </mesh>
      <mesh position={[-0.48, -0.2, 0.61]}>
        <boxGeometry args={[0.35, 0.32, 0.04]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
      <mesh position={[0.45, -0.2, 0.61]}>
        <boxGeometry args={[0.35, 0.32, 0.04]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
    </group>
  );
}

function Mountains({ position, rotationY = 0, scale = 1 }: { position: Vec3; rotationY?: number; scale?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {[[-0.42, 0.42, 0.12, 0.9], [0.24, 0.52, -0.08, 1.15], [-0.95, 0.34, 0.34, 0.72]].map(([x, y, z, scale], index) => (
        <group key={index} position={[x, y, z]} scale={[scale, scale, scale]}>
          <mesh castShadow receiveShadow>
            <coneGeometry args={[0.56, 1.35, 5]} />
            <meshStandardMaterial color="#78716c" roughness={0.82} />
          </mesh>
          <mesh position={[0, 0.45, 0]} castShadow>
            <coneGeometry args={[0.28, 0.46, 5]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Tree({ position, scale = 1, tint }: { position: Vec3; scale?: number; tint?: string }) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.11, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.22, 8]} />
        <meshStandardMaterial color="#7c2d12" />
      </mesh>
      <mesh castShadow position={[0, 0.34, 0]}>
        <coneGeometry args={[0.22, 0.48, 10]} />
        <meshStandardMaterial color={tint ?? "#166534"} roughness={0.7} />
      </mesh>
    </group>
  );
}

function Van({ position, rotationY, scale = 1 }: { position: Vec3; rotationY: number; scale?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow>
        <boxGeometry args={[0.62, 0.32, 0.32]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      <mesh position={[0.12, 0.13, 0]} castShadow>
        <boxGeometry args={[0.34, 0.18, 0.3]} />
        <meshStandardMaterial color="#93c5fd" roughness={0.25} transparent opacity={0.8} />
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, -0.17, 0.18]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.04, 12]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
      ))}
    </group>
  );
}

function TextSign({
  text,
  position,
  rotationY = 0,
  background,
  color,
  scale = 1,
}: {
  text: string;
  position: Vec3;
  rotationY?: number;
  background: string;
  color: string;
  scale?: number;
}) {
  const texture = useMemo(() => makeLabelTexture(text, background, color), [background, color, text]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh position={[0, -0.32, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.62, 8]} />
        <meshStandardMaterial color="#5b3418" roughness={0.7} />
      </mesh>
      <mesh>
        <planeGeometry args={[0.9, 0.42]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

function makeLabelTexture(text: string, background: string, color: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 240;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  labelRoundedRect(ctx, 18, 18, canvas.width - 36, canvas.height - 36, 34);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "900 74px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function labelRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function FollowCamera({ target, motion }: { target: Vec3; motion: BoardMotionSettings }) {
  const { camera } = useThree();
  const initialized = useRef(false);
  const desired = useMemo(() => new Vector3(...cameraFollowPosition(target)), [target]);
  const lookAt = useMemo(() => new Vector3(target[0], 0, target[2]), [target]);

  useLayoutEffect(() => {
    if (initialized.current && motion.cameraLerpSpeed !== 0) return;
    camera.position.copy(desired);
    camera.lookAt(lookAt);
    camera.updateProjectionMatrix();
    initialized.current = true;
  }, [camera, desired, lookAt, motion.cameraLerpSpeed]);

  useFrame((_, delta) => {
    const amount = frameLerp(delta, motion.cameraLerpSpeed);
    camera.position.lerp(desired, amount);
    camera.lookAt(lookAt);
  });

  return null;
}

function AnimatedPartyLights({ motion }: { motion: BoardMotionSettings }) {
  const warm = useRef<PointLight | null>(null);
  const cool = useRef<PointLight | null>(null);
  const initial = orbitLightPosition(0, !motion.orbitLights);

  useFrame((state) => {
    if (!warm.current || !cool.current) return;
    const pos = orbitLightPosition(state.clock.elapsedTime, !motion.orbitLights);
    warm.current.position.set(...pos);
    cool.current.position.set(-pos[0], Math.max(3.8, pos[1] - 0.35), -pos[2]);
  });

  return (
    <>
      <pointLight ref={warm} position={initial} intensity={0.78} color="#fef08a" distance={11} />
      <pointLight ref={cool} position={[-initial[0], 4.1, -initial[2]]} intensity={0.45} color="#67e8f9" distance={10} />
    </>
  );
}

function SlotPlatform({
  slot,
  active,
  stepped,
  occupiedCount,
}: {
  slot: Board3DSlot;
  active: boolean;
  stepped: boolean;
  occupiedCount: number;
}) {
  const style = slotMaterialStyle(slot.type);
  const height = active ? 0.34 : occupiedCount > 0 ? 0.28 : 0.24;
  const scale = active ? 1.08 : 1;

  return (
    <group position={slot.position} rotation={[0, slot.rotationY, 0]} scale={[scale, 1, scale]}>
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[0.92, height, 0.72]} />
        <meshStandardMaterial color={style.side} roughness={0.5} metalness={0.16} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, height + 0.016, 0]}>
        <boxGeometry args={[0.88, 0.035, 0.68]} />
        <meshStandardMaterial
          color={style.top}
          roughness={0.42}
          metalness={0.1}
          emissive={active ? style.emissive : "#000000"}
          emissiveIntensity={active ? 0.32 : 0}
        />
      </mesh>
      <SlotDecalMesh decal={style.decal} y={height + 0.032} color={style.accent} active={active} stepped={stepped} />
      <mesh position={[0, height + 0.042, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, active || stepped ? 0.66 : 0.59, 32]} />
        <meshStandardMaterial
          color={active ? "#fde047" : stepped ? "#fef3c7" : style.accent}
          transparent
          opacity={active ? 0.62 : stepped ? 0.42 : 0.18}
          side={DoubleSide}
        />
      </mesh>
      {occupiedCount > 1 && (
        <mesh position={[0, height + 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.67, 0.74, 32]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.18} side={DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function SlotDecalMesh({
  decal,
  y,
  color,
  active,
  stepped,
}: {
  decal: SlotDecal;
  y: number;
  color: string;
  active: boolean;
  stepped: boolean;
}) {
  const opacity = active ? 0.9 : stepped ? 0.66 : 0.48;
  const material = () => (
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 0.16 : 0.04} transparent opacity={opacity} side={DoubleSide} />
  );

  if (decal === "star") {
    return (
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 10]}>
        <circleGeometry args={[0.29, 5]} />
        {material()}
      </mesh>
    );
  }

  if (decal === "diamond") {
    return (
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
        <planeGeometry args={[0.42, 0.42]} />
        {material()}
      </mesh>
    );
  }

  if (decal === "bolt") {
    return (
      <group position={[0, y, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, -0.55]}>
          <planeGeometry args={[0.46, 0.16]} />
          {material()}
        </mesh>
        <mesh position={[0.07, 0.002, -0.09]} rotation={[-Math.PI / 2, 0, -0.55]}>
          <planeGeometry args={[0.34, 0.14]} />
          {material()}
        </mesh>
      </group>
    );
  }

  if (decal === "coin") {
    return (
      <>
        <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.22, 28]} />
          {material()}
        </mesh>
        <mesh position={[0, y + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.28, 0.35, 28]} />
          {material()}
        </mesh>
      </>
    );
  }

  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.18, 0.34, 32]} />
      {material()}
    </mesh>
  );
}

function PlayerToken({
  player,
  active,
  path,
  motion,
}: {
  player: Player;
  active: boolean;
  path: Vec3[];
  motion: BoardMotionSettings;
}) {
  const group = useRef<Group | null>(null);
  const segment = useRef(0);
  const progress = useRef(0);
  const pathKey = path.map((point) => point.join(",")).join("|");
  const points = useMemo(() => path.map((point) => new Vector3(...point)), [pathKey]);
  const finalPoint = path[path.length - 1] ?? [0, 0, 0];
  const start = motion.tokenStepSeconds === 0 ? finalPoint : path[0] ?? finalPoint;

  useEffect(() => {
    segment.current = 0;
    progress.current = 0;
    if (group.current) group.current.position.copy(new Vector3(...start));
  }, [pathKey, start]);

  useFrame((_, delta) => {
    const token = group.current;
    if (!token || points.length === 0) return;
    if (motion.tokenStepSeconds === 0) {
      token.position.copy(points[points.length - 1]);
      return;
    }
    if (points.length === 1) {
      token.position.lerp(points[0], frameLerp(delta, 10));
      return;
    }

    const next = Math.min(segment.current + 1, points.length - 1);
    progress.current += delta / motion.tokenStepSeconds;
    const t = easeOut(Math.min(1, progress.current));
    token.position.lerpVectors(points[segment.current], points[next], t);

    if (progress.current >= 1) {
      segment.current = next;
      progress.current = 0;
      token.position.copy(points[next]);
    }
  });

  return (
    <group ref={group} position={start}>
      <mesh castShadow position={[0, active ? 0.14 : 0.04, 0]}>
        <sphereGeometry args={[active ? 0.24 : 0.2, 24, 16]} />
        <meshStandardMaterial
          color={player.color}
          roughness={0.32}
          metalness={0.12}
          emissive={active ? player.color : "#000000"}
          emissiveIntensity={active ? 0.38 : 0}
          transparent={!player.connected}
          opacity={player.connected ? 1 : 0.45}
        />
      </mesh>
      <mesh castShadow position={[0, -0.1, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.08, 24]} />
        <meshStandardMaterial color={player.color} roughness={0.45} metalness={0.18} transparent={!player.connected} opacity={player.connected ? 0.9 : 0.38} />
      </mesh>
      {active && (
        <mesh position={[0, -0.13, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.29, 0.42, 36]} />
          <meshStandardMaterial color="#ffffff" emissive={player.color} emissiveIntensity={0.18} transparent opacity={0.78} side={DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function WebGLContextGuard({ onLost }: { onLost: () => void }) {
  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    canvas.addEventListener("webglcontextlost", handleLost);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      gl.renderLists.dispose();
      gl.info.reset();
    };
  }, [gl, onLost]);

  return null;
}

function Board3DFallback({ className = "pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[1.5rem] bg-slate-950/70" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className}>
      <div className="absolute left-1/2 top-1/2 h-[78%] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-amber-300/25 bg-teal-700/20 shadow-inner" />
      <div className="absolute left-1/2 top-1/2 h-[52%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-cyan-200/5" />
      <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rotate-12 rounded-[1.5rem] bg-yellow-300/20" />
    </div>
  );
}

function useRenderViewport(): { devicePixelRatio: number; viewportWidth: number } {
  const [viewport, setViewport] = useState(readRenderViewport);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setViewport(readRenderViewport());
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return viewport;
}

function readRenderViewport(): { devicePixelRatio: number; viewportWidth: number } {
  return {
    devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    viewportWidth: typeof window === "undefined" ? 1024 : window.innerWidth,
  };
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(readPageVisible);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setVisible(readPageVisible());
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

function readPageVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(readReducedMotionPreference);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (event?: MediaQueryListEvent) => setReducedMotion(event?.matches ?? query.matches);
    update();
    if (query.addEventListener) {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  return reducedMotion;
}

function readReducedMotionPreference(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function playersByPosition(players: Player[]): Map<number, Player[]> {
  const positions = new Map<number, Player[]>();
  for (const player of players) {
    const stack = positions.get(player.position) ?? [];
    stack.push(player);
    positions.set(player.position, stack);
  }
  return positions;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
