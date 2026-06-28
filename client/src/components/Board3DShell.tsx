import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Group } from "three";
import type { Player, Tile, TileType } from "@essence/shared";
import {
  board3DSlots,
  cameraFollowPosition,
  tokenPathPositions,
  tokenWorldPosition,
  type Board3DSlot,
  type Vec3,
} from "../board3d";
import { movementPath } from "../boardView";

const SLOT_COLOR: Record<TileType, string> = {
  start: "#94a3b8",
  finish: "#f59e0b",
  minigame: "#6366f1",
  trivia: "#38bdf8",
  vote: "#8b5cf6",
  judge: "#ec4899",
  dare: "#f43f5e",
  fate: "#d946ef",
  groom: "#facc15",
  star: "#fde047",
  reaction: "#22c55e",
  estimate: "#06b6d4",
};

interface Board3DShellProps {
  tiles: Tile[];
  players?: Player[];
  activeId?: string;
  lastRoll?: number | null;
  boardLength?: number;
}

export default function Board3DShell({
  tiles,
  players = [],
  activeId,
  lastRoll = null,
  boardLength = tiles.length,
}: Board3DShellProps) {
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

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[1.5rem] bg-slate-950/60">
      <Canvas
        camera={{ position: [0, 7.2, 9], fov: 42, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        shadows
      >
        <FollowCamera target={activeSlot} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 8, 6]} intensity={1.8} castShadow />
        <pointLight position={[-5, 5, -4]} intensity={0.55} color="#67e8f9" />

        <mesh position={[0, -0.18, 0]} receiveShadow>
          <cylinderGeometry args={[5.4, 5.8, 0.28, 64]} />
          <meshStandardMaterial color="#0f766e" roughness={0.78} metalness={0.08} />
        </mesh>

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
          <PlayerToken key={player.id} player={player} active={active} path={path} />
        ))}
      </Canvas>
    </div>
  );
}

function FollowCamera({ target }: { target: Vec3 }) {
  const { camera } = useThree();
  const initialized = useRef(false);
  const desired = useMemo(() => new Vector3(...cameraFollowPosition(target)), [target]);
  const lookAt = useMemo(() => new Vector3(target[0], 0, target[2]), [target]);

  useLayoutEffect(() => {
    if (initialized.current) return;
    camera.position.copy(desired);
    camera.lookAt(lookAt);
    camera.updateProjectionMatrix();
    initialized.current = true;
  }, [camera, desired, lookAt]);

  useFrame((_, delta) => {
    camera.position.lerp(desired, Math.min(1, delta * 3));
    camera.lookAt(lookAt);
  });

  return null;
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
  const color = slot.type ? SLOT_COLOR[slot.type] : "#64748b";

  return (
    <group position={slot.position} rotation={[0, slot.rotationY, 0]}>
      <mesh castShadow receiveShadow scale={[active ? 1.08 : 1, active ? 1.18 : 1, active ? 1.08 : 1]}>
        <boxGeometry args={[0.92, 0.2, 0.92]} />
        <meshStandardMaterial
          color={color}
          roughness={0.55}
          metalness={0.08}
          emissive={active ? "#fef3c7" : "#000000"}
          emissiveIntensity={active ? 0.25 : 0}
        />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, active || stepped ? 0.48 : 0.42, 24]} />
        <meshStandardMaterial
          color={active ? "#fde047" : stepped ? "#fef3c7" : "#ffffff"}
          transparent
          opacity={active ? 0.65 : stepped ? 0.42 : 0.22}
        />
      </mesh>
      {occupiedCount > 1 && (
        <mesh position={[0, 0.18, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.57, 24]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.18} />
        </mesh>
      )}
    </group>
  );
}

function PlayerToken({ player, active, path }: { player: Player; active: boolean; path: Vec3[] }) {
  const group = useRef<Group | null>(null);
  const segment = useRef(0);
  const progress = useRef(0);
  const pathKey = path.map((point) => point.join(",")).join("|");
  const points = useMemo(() => path.map((point) => new Vector3(...point)), [pathKey]);
  const start = path[0] ?? [0, 0, 0];

  useEffect(() => {
    segment.current = 0;
    progress.current = 0;
    if (group.current && points[0]) group.current.position.copy(points[0]);
  }, [pathKey, points]);

  useFrame((_, delta) => {
    const token = group.current;
    if (!token || points.length === 0) return;
    if (points.length === 1) {
      token.position.lerp(points[0], Math.min(1, delta * 10));
      return;
    }

    const next = Math.min(segment.current + 1, points.length - 1);
    progress.current += delta / 0.22;
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
      <mesh castShadow position={[0, active ? 0.12 : 0, 0]}>
        <sphereGeometry args={[active ? 0.24 : 0.2, 24, 16]} />
        <meshStandardMaterial
          color={player.color}
          roughness={0.35}
          metalness={0.08}
          emissive={active ? player.color : "#000000"}
          emissiveIntensity={active ? 0.35 : 0}
          transparent={!player.connected}
          opacity={player.connected ? 1 : 0.45}
        />
      </mesh>
      {active && (
        <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.28, 0.38, 32]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.75} />
        </mesh>
      )}
    </group>
  );
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
