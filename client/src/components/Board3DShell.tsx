import { useLayoutEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { Tile, TileType } from "@essence/shared";
import { board3DSlots, type Board3DSlot } from "../board3d";

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

export default function Board3DShell({ tiles }: { tiles: Tile[] }) {
  const slots = useMemo(() => board3DSlots(tiles), [tiles]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[1.5rem] bg-slate-950/60">
      <Canvas
        camera={{ position: [0, 7.2, 9], fov: 42, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ antialias: true, alpha: true }}
        shadows
      >
        <StaticCamera />
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 8, 6]} intensity={1.8} castShadow />
        <pointLight position={[-5, 5, -4]} intensity={0.55} color="#67e8f9" />

        <mesh position={[0, -0.18, 0]} receiveShadow>
          <cylinderGeometry args={[5.4, 5.8, 0.28, 64]} />
          <meshStandardMaterial color="#0f766e" roughness={0.78} metalness={0.08} />
        </mesh>

        {slots.map((slot) => (
          <SlotPlatform key={slot.id} slot={slot} />
        ))}
      </Canvas>
    </div>
  );
}

function StaticCamera() {
  const { camera, invalidate } = useThree();

  useLayoutEffect(() => {
    camera.position.set(0, 7.2, 9);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate]);

  return null;
}

function SlotPlatform({ slot }: { slot: Board3DSlot }) {
  const color = slot.type ? SLOT_COLOR[slot.type] : "#64748b";

  return (
    <group position={slot.position} rotation={[0, slot.rotationY, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.92, 0.2, 0.92]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.42, 24]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.22} />
      </mesh>
    </group>
  );
}
