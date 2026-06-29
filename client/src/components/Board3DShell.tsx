import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { DoubleSide, Vector3, type Group, type PointLight } from "three";
import type { Player, Tile } from "@essence/shared";
import {
  board3DSlots,
  boardMotionSettings,
  boardRenderSettings,
  cameraFollowPosition,
  frameLerp,
  orbitLightPosition,
  slotMaterialStyle,
  supportsWebGL,
  tokenPathPositions,
  tokenWorldPosition,
  type Board3DSlot,
  type BoardMotionSettings,
  type SlotDecal,
  type Vec3,
} from "../board3d";
import { movementPath } from "../boardView";

interface Board3DShellProps {
  tiles: Tile[];
  players?: Player[];
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
  const slots = useMemo(() => board3DSlots(tiles), [tiles]);
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

        <BoardTable />

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

function BoardTable() {
  const ornaments = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2;
        return {
          id: index,
          color: index % 3 === 0 ? "#facc15" : index % 3 === 1 ? "#38bdf8" : "#fb7185",
          position: [Math.cos(angle) * 4.15, 0.16, Math.sin(angle) * 4.15] as Vec3,
        };
      }),
    []
  );

  return (
    <group>
      <mesh position={[0, -0.28, 0]} receiveShadow>
        <cylinderGeometry args={[5.65, 5.95, 0.36, 96]} />
        <meshStandardMaterial color="#0f766e" roughness={0.72} metalness={0.08} />
      </mesh>
      <mesh position={[0, -0.07, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.35, 0.08, 12, 96]} />
        <meshStandardMaterial color="#facc15" roughness={0.38} metalness={0.25} emissive="#713f12" emissiveIntensity={0.08} />
      </mesh>
      <mesh position={[0, -0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.25, 4.95, 96]} />
        <meshStandardMaterial color="#ccfbf1" transparent opacity={0.14} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 10]}>
        <circleGeometry args={[0.9, 5]} />
        <meshStandardMaterial color="#fde047" roughness={0.42} metalness={0.18} emissive="#facc15" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.05, 1.22, 40]} />
        <meshStandardMaterial color="#fef3c7" transparent opacity={0.35} side={DoubleSide} />
      </mesh>
      {ornaments.map((ornament) => (
        <mesh key={ornament.id} position={ornament.position} castShadow>
          <sphereGeometry args={[0.11, 16, 12]} />
          <meshStandardMaterial color={ornament.color} roughness={0.35} metalness={0.12} emissive={ornament.color} emissiveIntensity={0.08} />
        </mesh>
      ))}
    </group>
  );
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
        <cylinderGeometry args={[0.52, 0.62, height, 32]} />
        <meshStandardMaterial color={style.side} roughness={0.5} metalness={0.16} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, height + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.52, 32]} />
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
