import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  LinearFilter,
  MeshStandardMaterial,
  Shape,
  SRGBColorSpace,
  type Mesh,
} from "three";
import type { MapArtifact, MapAssetDef, MapTerrace, MapTerraceSurface } from "@essence/shared";
import { localAssetProjection } from "../artifactProjection";
import { BOARD_GRID_SPACING, layoutToWorldPosition, type Board3DMapBounds, type Vec3 } from "../board3d";

// ── Paleta del diorama (ver spec de restructura de mapa) ─────────────────────
export const GRASS_TOP = "#7ccf63";
export const BASE_FIELD = "#6fbe54";
export const STRATA = ["#d9a05f", "#b97a45", "#8a5a3b"] as const;
export const SAND = "#ecd9a8";
export const STONE_TOP = "#e6cf9d";
export const STONE_SIDE = "#c9a86a";
export const WATER = "#5bc4ea";
export const FOAM = "#bae6fd";

function shade(hex: string, factor: number): string {
  return `#${new Color(hex).multiplyScalar(factor).getHexString()}`;
}

function surfaceTopColor(surface: MapTerraceSurface | undefined, color: string | undefined): string {
  if (color && !surface) return color;
  if (surface === "sand") return SAND;
  if (surface === "stone") return "#cfc5ae";
  if (surface === "plaza") return "#f4d790";
  return GRASS_TOP;
}

// ── Geometría/materiales compartidos (una sola instancia para todo el tablero) ──
export const STONE_TILE_HEIGHT = 0.3;

function roundedRectShape(width: number, height: number, radius: number): Shape {
  const shape = new Shape();
  const hw = width / 2;
  const hh = height / 2;
  shape.moveTo(-hw + radius, -hh);
  shape.lineTo(hw - radius, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + radius);
  shape.lineTo(hw, hh - radius);
  shape.quadraticCurveTo(hw, hh, hw - radius, hh);
  shape.lineTo(-hw + radius, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - radius);
  shape.lineTo(-hw, -hh + radius);
  shape.quadraticCurveTo(-hw, -hh, -hw + radius, -hh);
  return shape;
}

/** Baldosa de piedra redondeada (extruida hacia arriba tras rotar -90° en X). */
export const STONE_TILE_GEOMETRY = new ExtrudeGeometry(roundedRectShape(1.04, 1.04, 0.3), {
  depth: STONE_TILE_HEIGHT,
  bevelEnabled: false,
  curveSegments: 5,
});

/** [tapa, lateral] — ExtrudeGeometry usa material 0 para tapas y 1 para el costado. */
export const STONE_TILE_MATERIALS = [
  new MeshStandardMaterial({ color: STONE_TOP, roughness: 0.55, metalness: 0.04 }),
  new MeshStandardMaterial({ color: STONE_SIDE, roughness: 0.72, metalness: 0.02 }),
];

// ── Texturas de texto (canvas) ────────────────────────────────────────────────
export function makeLabelTexture(text: string, background: string, color: string): CanvasTexture {
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
  return finishTexture(canvas);
}

/** Disco "META ↑" para el casillero final (como el THE END de la referencia). */
export function makeMetaDiscTexture(label = "META"): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#26406e";
  ctx.beginPath();
  ctx.arc(256, 256, 256, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 26;
  ctx.strokeStyle = "#f5c84c";
  ctx.beginPath();
  ctx.arc(256, 256, 216, 0, Math.PI * 2);
  ctx.stroke();
  // flecha para arriba
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.moveTo(256, 92);
  ctx.lineTo(324, 194);
  ctx.lineTo(284, 194);
  ctx.lineTo(284, 252);
  ctx.lineTo(228, 252);
  ctx.lineTo(228, 194);
  ctx.lineTo(188, 194);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.font = "900 122px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 256, 360);
  return finishTexture(canvas);
}

function finishTexture(canvas: HTMLCanvasElement): CanvasTexture {
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

// ── Terreno en mesetas (terrazas) ─────────────────────────────────────────────
export function TerracedTerrain({
  terraces,
  bounds,
  animated,
}: {
  terraces?: MapTerrace[];
  bounds: Board3DMapBounds;
  animated: boolean;
}) {
  const sorted = useMemo(() => [...(terraces ?? [])].sort((a, b) => a.elevation - b.elevation), [terraces]);
  if (!sorted.length) return null;
  return (
    <group>
      {sorted.map((terrace) => (
        <TerracePlateau key={terrace.id} terrace={terrace} bounds={bounds} animated={animated} />
      ))}
    </group>
  );
}

function TerracePlateau({ terrace, bounds, animated }: { terrace: MapTerrace; bounds: Board3DMapBounds; animated: boolean }) {
  const layout = useMemo(() => {
    const centerGX = bounds.minX + (bounds.maxX - bounds.minX) / 2;
    const centerGY = bounds.minY + (bounds.maxY - bounds.minY) / 2;
    // rect inclusive: la meseta cubre media celda más allá de los centros extremos
    const width = (terrace.maxX - terrace.minX + 1) * bounds.spacing;
    const depth = (terrace.maxY - terrace.minY + 1) * bounds.spacing;
    const x = ((terrace.minX + terrace.maxX) / 2 - centerGX) * bounds.spacing;
    const z = ((terrace.minY + terrace.maxY) / 2 - centerGY) * bounds.spacing;
    const top = Math.max(terrace.elevation, 0.12);
    const capHeight = 0.14;
    const rimHeight = 0.05;
    const bodyTop = top - capHeight - rimHeight;
    const isWater = terrace.surface === "water";
    const topColor = isWater ? SAND : surfaceTopColor(terrace.surface, terrace.color);
    // estratos: si la terraza trae color (ej. loma rosa de la META) derivamos
    // tonos oscureciendo hacia abajo; si no, bandas tierra de la paleta
    const bandColors = terrace.color
      ? [shade(terrace.color, 0.96), shade(terrace.color, 0.78), shade(terrace.color, 0.6)]
      : [...STRATA];
    const bandCount = bodyTop > 0.9 ? 3 : bodyTop > 0.06 ? 2 : 0;
    const bandHeight = bandCount ? bodyTop / bandCount : 0;
    return { width, depth, x, z, top, capHeight, rimHeight, bodyTop, isWater, topColor, bandColors, bandCount, bandHeight };
  }, [bounds, terrace]);

  return (
    <group position={[layout.x, 0, layout.z]}>
      {/* tapa con leve alero para que se lea el nivel */}
      <mesh castShadow receiveShadow position={[0, layout.top - layout.capHeight / 2, 0]}>
        <boxGeometry args={[layout.width, layout.capHeight, layout.depth]} />
        <meshStandardMaterial color={layout.topColor} roughness={0.78} />
      </mesh>
      {/* franja de borde contrastante bajo la tapa */}
      {layout.bodyTop > 0 && (
        <mesh receiveShadow position={[0, layout.top - layout.capHeight - layout.rimHeight / 2, 0]}>
          <boxGeometry args={[layout.width - 0.07, layout.rimHeight, layout.depth - 0.07]} />
          <meshStandardMaterial color={shade(layout.topColor, 0.68)} roughness={0.82} />
        </mesh>
      )}
      {/* estratos del acantilado, más oscuros hacia abajo */}
      {Array.from({ length: layout.bandCount }, (_, index) => (
        <mesh
          key={index}
          castShadow
          receiveShadow
          position={[0, layout.bodyTop - layout.bandHeight * (index + 0.5), 0]}
        >
          <boxGeometry args={[layout.width - 0.16, layout.bandHeight + 0.012, layout.depth - 0.16]} />
          <meshStandardMaterial color={layout.bandColors[Math.min(index, layout.bandColors.length - 1)]} roughness={0.86} />
        </mesh>
      ))}
      {/* espejo de agua con anillo de espuma, embutido en la meseta */}
      {layout.isWater && (
        <>
          <mesh position={[0, layout.top + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[Math.max(0.3, layout.width - 0.24), Math.max(0.3, layout.depth - 0.24)]} />
            <meshStandardMaterial color={FOAM} roughness={0.42} transparent opacity={0.85} />
          </mesh>
          <WaterSurface
            width={Math.max(0.24, layout.width - 0.44)}
            depth={Math.max(0.24, layout.depth - 0.44)}
            y={layout.top + 0.028}
            animated={animated}
          />
        </>
      )}
    </group>
  );
}

function WaterSurface({ width, depth, y, animated }: { width: number; depth: number; y: number; animated: boolean }) {
  const mesh = useRef<Mesh | null>(null);

  useFrame((state) => {
    if (!mesh.current || !animated) return;
    mesh.current.position.y = y + Math.sin(state.clock.elapsedTime * 1.3) * 0.011;
    const material = mesh.current.material as MeshStandardMaterial;
    material.opacity = 0.78 + Math.sin(state.clock.elapsedTime * 2.1) * 0.05;
  });

  return (
    <mesh ref={mesh} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color={WATER} transparent opacity={0.8} roughness={0.22} metalness={0.05} />
    </mesh>
  );
}

// ── Artefactos del mapa ───────────────────────────────────────────────────────
export function MapArtifacts({
  artifacts,
  assetCatalog,
  bounds,
  terraces,
}: {
  artifacts: MapArtifact[];
  assetCatalog: MapAssetDef[];
  bounds: Board3DMapBounds;
  terraces?: MapTerrace[];
}) {
  const assetById = useMemo(() => new Map(assetCatalog.map((asset) => [asset.id, asset] as const)), [assetCatalog]);
  return (
    <group>
      {artifacts
        .filter((artifact) => artifact.visible !== false)
        .map((artifact) => (
          <MapArtifactMesh key={artifact.id} artifact={artifact} asset={assetById.get(artifact.assetId)} bounds={bounds} terraces={terraces} />
        ))}
    </group>
  );
}

function MapArtifactMesh({
  artifact,
  asset,
  bounds,
  terraces,
}: {
  artifact: MapArtifact;
  asset?: MapAssetDef;
  bounds: Board3DMapBounds;
  terraces?: MapTerrace[];
}) {
  // el artefacto apoya sobre el terreno: worldY = elevación de terraza + (z ?? 0)
  const position = layoutToWorldPosition(
    artifact.position,
    bounds.maxX,
    bounds.maxY,
    bounds.spacing,
    bounds.minX,
    bounds.minY,
    terraces
  );
  const rotationY = ((artifact.position.rot ?? 0) / 180) * Math.PI;
  const scale = artifact.scale ?? 1;
  const tint = artifact.tint;

  switch (artifact.assetId) {
    case "river":
      return <River position={position} rotationY={rotationY} scale={scale} />;
    case "pond":
      return <Pond position={position} scale={scale} />;
    case "plaza":
      return <Plaza position={position} scale={scale} />;
    case "mini-court":
      return <Court position={position} rotationY={rotationY} scale={scale} />;
    case "club-house":
      return <School position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    case "glass-building":
      return <GlassBuilding position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    case "mountain-cluster":
      return <Mountains position={position} rotationY={rotationY} scale={scale} />;
    case "party-van":
      return <Van position={position} rotationY={rotationY} scale={scale} />;
    case "oak-tree":
      return <Pine position={position} scale={scale} tint={tint} />;
    case "start-sign":
    case "finish-sign":
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
    case "fountain":
      return <Fountain position={position} scale={scale} />;
    case "bench":
      return <Bench position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    case "palm-tree":
      return <PalmTree position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    case "flower-bed":
      return <FlowerBed position={position} scale={scale} />;
    case "beach-set":
      return <BeachSet position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    case "sailboat":
      return <Sailboat position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    case "waterfall":
      return <Waterfall position={position} rotationY={rotationY} scale={scale} />;
    case "wedding-arch":
      return <WeddingArch position={position} rotationY={rotationY} scale={scale} />;
    case "fence":
      return <Fence position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    case "streetlamp":
      return <Streetlamp position={position} scale={scale} />;
    case "rock":
      return <Rocks position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    case "billboard":
      return <Billboard position={position} rotationY={rotationY} scale={scale} label={artifact.label} />;
    case "bus":
      return <Bus position={position} rotationY={rotationY} scale={scale} tint={tint} />;
    default:
      return <ProjectedAssetBlock artifact={artifact} asset={asset} position={position} rotationY={rotationY} scale={scale} />;
  }
}

interface AssetProps {
  position: Vec3;
  rotationY?: number;
  scale?: number;
  tint?: string;
}

// ── Assets existentes (mejorados) ─────────────────────────────────────────────

function River({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh receiveShadow>
        <boxGeometry args={[5.15, 0.05, 0.5]} />
        <meshStandardMaterial color={WATER} roughness={0.24} metalness={0.03} transparent opacity={0.82} />
      </mesh>
      {/* orillas de espuma */}
      {[-0.27, 0.27].map((z) => (
        <mesh key={z} position={[0, 0.005, z]}>
          <boxGeometry args={[5.15, 0.045, 0.05]} />
          <meshStandardMaterial color={FOAM} roughness={0.4} transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  );
}

function Pond({ position, scale = 1 }: AssetProps) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      {/* borde de arena */}
      <mesh receiveShadow>
        <cylinderGeometry args={[1.14, 1.24, 0.05, 36]} />
        <meshStandardMaterial color={SAND} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.035, 0]} receiveShadow>
        <cylinderGeometry args={[0.94, 0.98, 0.05, 32]} />
        <meshStandardMaterial color={WATER} roughness={0.24} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function Plaza({ position, scale = 1 }: AssetProps) {
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

function Court({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh receiveShadow>
        <boxGeometry args={[1.7, 0.05, 1.1]} />
        <meshStandardMaterial color="#7cc879" roughness={0.6} />
      </mesh>
      {/* líneas pintadas: perímetro + medio + círculo central */}
      {[[-0.75, 0], [0.75, 0]].map(([x]) => (
        <mesh key={`v${x}`} position={[x, 0.032, 0]}>
          <boxGeometry args={[0.035, 0.012, 0.95]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      ))}
      {[[-0.46], [0.46]].map(([z]) => (
        <mesh key={`h${z}`} position={[0, 0.032, z]}>
          <boxGeometry args={[1.53, 0.012, 0.035]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      ))}
      <mesh position={[0, 0.032, 0]}>
        <boxGeometry args={[0.035, 0.012, 0.95]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.19, 24]} />
        <meshStandardMaterial color="#f8fafc" side={DoubleSide} />
      </mesh>
      {/* aro con tablero */}
      <mesh position={[0.68, 0.26, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.52, 8]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      <mesh position={[0.68, 0.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.34, 0.22, 0.025]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.45} />
      </mesh>
      <mesh position={[0.61, 0.43, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.09, 0.014, 8, 18]} />
        <meshStandardMaterial color="#f97316" />
      </mesh>
    </group>
  );
}

function School({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const brick = tint ?? "#b3543a";
  const windows = useMemo(() => {
    const cols = [-0.78, -0.28, 0.28, 0.78];
    const rows = [0.72, 0.34];
    return cols.flatMap((x) => rows.map((y) => [x, y] as const));
  }, []);

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* cuerpo de ladrillo apoyado en el piso */}
      <mesh castShadow receiveShadow position={[0, 0.55, 0]}>
        <boxGeometry args={[2.15, 1.1, 1.2]} />
        <meshStandardMaterial color={brick} roughness={0.78} />
      </mesh>
      {/* techo plano con cornisa clara */}
      <mesh position={[0, 1.16, 0]} castShadow>
        <boxGeometry args={[2.32, 0.14, 1.34]} />
        <meshStandardMaterial color="#e8d6bd" roughness={0.55} />
      </mesh>
      {/* grilla de ventanas */}
      {windows.map(([x, y]) => (
        <mesh key={`${x}:${y}`} position={[x, y, 0.615]}>
          <boxGeometry args={[0.3, 0.24, 0.025]} />
          <meshStandardMaterial color="#1e293b" emissive="#7dd3fc" emissiveIntensity={0.12} roughness={0.3} />
        </mesh>
      ))}
      {/* puerta con dintel */}
      <mesh position={[0, 0.21, 0.63]}>
        <boxGeometry args={[0.36, 0.42, 0.035]} />
        <meshStandardMaterial color="#334155" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.46, 0.635]}>
        <boxGeometry args={[0.46, 0.06, 0.03]} />
        <meshStandardMaterial color="#e8d6bd" roughness={0.5} />
      </mesh>
      {/* mástil con bandera */}
      <mesh position={[1.28, 0.55, 0.35]} castShadow>
        <cylinderGeometry args={[0.018, 0.024, 1.1, 8]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.35} roughness={0.4} />
      </mesh>
      <mesh position={[1.42, 1.0, 0.35]}>
        <boxGeometry args={[0.26, 0.16, 0.015]} />
        <meshStandardMaterial color="#7dd3fc" roughness={0.5} side={DoubleSide} />
      </mesh>
    </group>
  );
}

function GlassBuilding({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const glass = tint ?? "#9cc6ee";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* zócalo */}
      <mesh castShadow receiveShadow position={[0, 0.09, 0]}>
        <boxGeometry args={[1.16, 0.18, 1.02]} />
        <meshStandardMaterial color="#64748b" roughness={0.6} />
      </mesh>
      {/* torre de vidrio */}
      <mesh castShadow receiveShadow position={[0, 1.02, 0]}>
        <boxGeometry args={[1.02, 1.7, 0.9]} />
        <meshStandardMaterial color={glass} roughness={0.14} metalness={0.1} transparent opacity={0.78} />
      </mesh>
      {/* parantes verticales */}
      {[-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, 1.02, 0]}>
          <boxGeometry args={[0.03, 1.7, 0.93]} />
          <meshStandardMaterial color="#3c5570" roughness={0.4} metalness={0.3} />
        </mesh>
      ))}
      {/* líneas de piso envolventes */}
      {[0.62, 1.04, 1.46].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[1.05, 0.026, 0.93]} />
          <meshStandardMaterial color="#3c5570" roughness={0.4} metalness={0.3} />
        </mesh>
      ))}
      {/* equipo de azotea */}
      <mesh castShadow position={[0.22, 1.96, 0.12]}>
        <boxGeometry args={[0.3, 0.18, 0.26]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.55} />
      </mesh>
    </group>
  );
}

function Mountains({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {[
        [-0.55, 0.14, 1.15],
        [0.34, -0.1, 1.45],
        [-1.15, 0.42, 0.85],
      ].map(([x, z, s], index) => (
        <group key={index} position={[x, 0, z]} scale={[s, s, s]}>
          <mesh castShadow receiveShadow position={[0, 0.78, 0]}>
            <coneGeometry args={[0.72, 1.75, 6]} />
            <meshStandardMaterial color="#6d675f" roughness={0.85} flatShading />
          </mesh>
          {/* manto de nieve amplio */}
          <mesh position={[0, 1.28, 0]} castShadow>
            <coneGeometry args={[0.4, 0.72, 6]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.45} flatShading />
          </mesh>
          <mesh position={[0, 1.56, 0]}>
            <coneGeometry args={[0.2, 0.34, 6]} />
            <meshStandardMaterial color="#ffffff" roughness={0.4} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Pino de tres copas (reemplaza el arbolito viejo de una sola copa). */
function Pine({ position, scale = 1, tint }: AssetProps) {
  const foliage = tint ?? "#2d7d46";
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 0.24, 8]} />
        <meshStandardMaterial color="#7c4524" roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0, 0.32, 0]}>
        <coneGeometry args={[0.27, 0.36, 9]} />
        <meshStandardMaterial color={shade(foliage, 0.82)} roughness={0.75} />
      </mesh>
      <mesh castShadow position={[0, 0.54, 0]}>
        <coneGeometry args={[0.2, 0.32, 9]} />
        <meshStandardMaterial color={foliage} roughness={0.75} />
      </mesh>
      <mesh castShadow position={[0, 0.73, 0]}>
        <coneGeometry args={[0.13, 0.26, 9]} />
        <meshStandardMaterial color={shade(foliage, 1.18)} roughness={0.72} />
      </mesh>
    </group>
  );
}

function Van({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.17, 0]}>
        <boxGeometry args={[0.62, 0.32, 0.32]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      <mesh position={[0.12, 0.3, 0]} castShadow>
        <boxGeometry args={[0.34, 0.18, 0.3]} />
        <meshStandardMaterial color="#93c5fd" roughness={0.25} transparent opacity={0.8} />
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.07, 0.18]} rotation={[Math.PI / 2, 0, 0]}>
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
      <mesh position={[0, 0.31, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.62, 8]} />
        <meshStandardMaterial color="#5b3418" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.63, 0]}>
        <planeGeometry args={[0.9, 0.42]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} side={DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Assets nuevos del diorama ─────────────────────────────────────────────────

function Fountain({ position, scale = 1 }: AssetProps) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.5, 0.56, 0.18, 20]} />
        <meshStandardMaterial color="#d6d3c9" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.185, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.03, 20]} />
        <meshStandardMaterial color={WATER} roughness={0.22} transparent opacity={0.82} />
      </mesh>
      <mesh castShadow position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.07, 0.1, 0.3, 10]} />
        <meshStandardMaterial color="#c4c0b4" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 0.51, 0]}>
        <cylinderGeometry args={[0.2, 0.24, 0.06, 16]} />
        <meshStandardMaterial color="#d6d3c9" roughness={0.7} />
      </mesh>
      {/* chorro */}
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.028, 0.045, 0.34, 8]} />
        <meshStandardMaterial color={FOAM} transparent opacity={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color={FOAM} transparent opacity={0.85} roughness={0.25} />
      </mesh>
    </group>
  );
}

function Bench({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const wood = tint ?? "#a3672f";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.18, 0]}>
        <boxGeometry args={[0.56, 0.05, 0.2]} />
        <meshStandardMaterial color={wood} roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 0.34, -0.09]} rotation={[-0.16, 0, 0]}>
        <boxGeometry args={[0.56, 0.2, 0.04]} />
        <meshStandardMaterial color={shade(wood, 1.12)} roughness={0.72} />
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} castShadow position={[x, 0.08, 0]}>
          <boxGeometry args={[0.05, 0.16, 0.18]} />
          <meshStandardMaterial color="#3f3a34" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function PalmTree({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const fronds = tint ?? "#3fae5a";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* tronco curvo por segmentos */}
      {[0, 1, 2, 3].map((index) => (
        <mesh
          key={index}
          castShadow
          position={[index * 0.045, 0.11 + index * 0.2, 0]}
          rotation={[0, 0, -0.1 * index]}
        >
          <cylinderGeometry args={[0.045, 0.055, 0.24, 8]} />
          <meshStandardMaterial color="#a97b48" roughness={0.85} />
        </mesh>
      ))}
      {/* corona de hojas caídas */}
      <group position={[0.16, 0.86, 0]}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <group key={index} rotation={[0, (index * Math.PI) / 3, 0]}>
            <mesh castShadow position={[0.2, 0.02, 0]} rotation={[0, 0, -0.5]}>
              <boxGeometry args={[0.42, 0.025, 0.12]} />
              <meshStandardMaterial color={index % 2 ? fronds : shade(fronds, 0.85)} roughness={0.7} />
            </mesh>
          </group>
        ))}
        <mesh>
          <sphereGeometry args={[0.06, 10, 8]} />
          <meshStandardMaterial color="#8a6236" roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

const FLOWER_COLORS = ["#f472b6", "#fde047", "#fb7185", "#f8fafc", "#c084fc"];

function FlowerBed({ position, scale = 1 }: AssetProps) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh receiveShadow position={[0, 0.045, 0]}>
        <cylinderGeometry args={[0.32, 0.36, 0.09, 16]} />
        <meshStandardMaterial color="#6b4226" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.29, 0.3, 0.035, 16]} />
        <meshStandardMaterial color="#4c9e46" roughness={0.8} />
      </mesh>
      {FLOWER_COLORS.map((color, index) => {
        const angle = (index / FLOWER_COLORS.length) * Math.PI * 2;
        const radius = index === 0 ? 0 : 0.17;
        return (
          <mesh key={color} position={[Math.cos(angle) * radius, 0.15, Math.sin(angle) * radius]}>
            <sphereGeometry args={[0.04, 8, 6]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

function BeachSet({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const canopy = tint ?? "#fb7185";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* sombrilla */}
      <mesh castShadow position={[-0.2, 0.3, 0]} rotation={[0, 0, 0.12]}>
        <cylinderGeometry args={[0.02, 0.025, 0.6, 8]} />
        <meshStandardMaterial color="#e8d6bd" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[-0.24, 0.6, 0]} rotation={[0, 0, 0.12]}>
        <coneGeometry args={[0.38, 0.18, 10]} />
        <meshStandardMaterial color={canopy} roughness={0.6} side={DoubleSide} />
      </mesh>
      {/* dos reposeras */}
      {[0.12, 0.42].map((x, index) => (
        <group key={x} position={[x, 0, index === 0 ? -0.16 : 0.14]}>
          <mesh castShadow position={[0, 0.09, 0]} rotation={[-0.42, 0, 0]}>
            <boxGeometry args={[0.18, 0.03, 0.4]} />
            <meshStandardMaterial color={index === 0 ? "#93c5fd" : "#f8fafc"} roughness={0.6} />
          </mesh>
          {[-0.06, 0.06].map((lx) => (
            <mesh key={lx} position={[lx, 0.035, 0.1]}>
              <boxGeometry args={[0.02, 0.07, 0.02]} />
              <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
            </mesh>
          ))}
        </group>
      ))}
      {/* toalla */}
      <mesh position={[0.28, 0.012, -0.42]} rotation={[-Math.PI / 2, 0, 0.35]}>
        <planeGeometry args={[0.2, 0.42]} />
        <meshStandardMaterial color="#fde047" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** Vela triangular compartida. */
const SAIL_GEOMETRY = (() => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, 0.46);
  shape.lineTo(0.3, 0);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
})();

function Sailboat({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const hull = tint ?? "#f8fafc";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.07, 0]}>
        <boxGeometry args={[0.5, 0.11, 0.2]} />
        <meshStandardMaterial color={hull} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.13, 0]}>
        <boxGeometry args={[0.4, 0.03, 0.14]} />
        <meshStandardMaterial color="#c9a86a" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0.03, 0.42, 0]}>
        <cylinderGeometry args={[0.014, 0.018, 0.56, 8]} />
        <meshStandardMaterial color="#8a6236" roughness={0.7} />
      </mesh>
      <mesh castShadow geometry={SAIL_GEOMETRY} position={[0.05, 0.18, -0.006]} dispose={null}>
        <meshStandardMaterial color="#ffffff" roughness={0.55} side={DoubleSide} />
      </mesh>
      <mesh castShadow geometry={SAIL_GEOMETRY} position={[0.01, 0.18, -0.006]} rotation={[0, Math.PI, 0]} dispose={null}>
        <meshStandardMaterial color="#fde68a" roughness={0.55} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** Cascada: lámina vertical que cae desde el borde del acantilado donde se apoya. */
function Waterfall({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* labio superior */}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.64, 0.07, 0.16]} />
        <meshStandardMaterial color={WATER} transparent opacity={0.82} roughness={0.2} />
      </mesh>
      {/* lámina que cae */}
      <mesh position={[0, -0.6, 0]}>
        <boxGeometry args={[0.6, 1.3, 0.09]} />
        <meshStandardMaterial color={WATER} transparent opacity={0.72} roughness={0.18} />
      </mesh>
      {/* vetas de espuma */}
      {[-0.16, 0.13].map((x) => (
        <mesh key={x} position={[x, -0.55, 0.012]}>
          <boxGeometry args={[0.07, 1.15, 0.09]} />
          <meshStandardMaterial color={FOAM} transparent opacity={0.55} roughness={0.3} />
        </mesh>
      ))}
      {/* espuma en la base */}
      {[-0.18, 0.02, 0.19].map((x, index) => (
        <mesh key={x} position={[x, -1.24, 0.05 * (index - 1)]} scale={[1, 0.45, 1]}>
          <sphereGeometry args={[0.15, 10, 8]} />
          <meshStandardMaterial color={FOAM} transparent opacity={0.9} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function WeddingArch({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {[-0.35, 0.35].map((x) => (
        <mesh key={x} castShadow position={[x, 0.3, 0]}>
          <cylinderGeometry args={[0.035, 0.04, 0.6, 10]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.5} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.6, 0]}>
        <torusGeometry args={[0.35, 0.035, 8, 20, Math.PI]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      {/* flores sobre el arco */}
      {[0.15, 0.45, 0.75].map((t, index) => {
        const angle = t * Math.PI;
        return (
          <mesh key={t} position={[Math.cos(angle) * 0.35, 0.6 + Math.sin(angle) * 0.35, 0]}>
            <sphereGeometry args={[0.055, 8, 6]} />
            <meshStandardMaterial color={index === 1 ? "#f8fafc" : "#f472b6"} roughness={0.55} />
          </mesh>
        );
      })}
      {[-0.35, 0.35].map((x) => (
        <mesh key={`base-${x}`} position={[x, 0.06, 0]}>
          <sphereGeometry args={[0.08, 8, 6]} />
          <meshStandardMaterial color="#4c9e46" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function Fence({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const paint = tint ?? "#f8fafc";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {[-0.3, -0.1, 0.1, 0.3].map((x) => (
        <mesh key={x} castShadow position={[x, 0.15, 0]}>
          <boxGeometry args={[0.05, 0.3, 0.03]} />
          <meshStandardMaterial color={paint} roughness={0.6} />
        </mesh>
      ))}
      {[0.1, 0.21].map((y) => (
        <mesh key={y} position={[0, y, 0.005]}>
          <boxGeometry args={[0.74, 0.04, 0.025]} />
          <meshStandardMaterial color={shade(paint, 0.92)} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function Streetlamp({ position, scale = 1 }: AssetProps) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.028, 0.04, 0.76, 8]} />
        <meshStandardMaterial color="#33393f" roughness={0.55} metalness={0.25} />
      </mesh>
      <mesh position={[0.08, 0.77, 0]}>
        <boxGeometry args={[0.18, 0.03, 0.03]} />
        <meshStandardMaterial color="#33393f" roughness={0.55} metalness={0.25} />
      </mesh>
      <mesh position={[0.16, 0.72, 0]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color="#ffd27a" emissive="#ffb84d" emissiveIntensity={0.95} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Rocks({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const stone = tint ?? "#8b8680";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[-0.08, 0.12, 0]} scale={[1.15, 0.85, 1]}>
        <dodecahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color={stone} roughness={0.9} flatShading />
      </mesh>
      <mesh castShadow position={[0.18, 0.08, 0.1]} scale={[1, 0.75, 1.1]}>
        <dodecahedronGeometry args={[0.11, 0]} />
        <meshStandardMaterial color={shade(stone, 1.12)} roughness={0.9} flatShading />
      </mesh>
      <mesh castShadow position={[0.05, 0.05, -0.16]}>
        <dodecahedronGeometry args={[0.07, 0]} />
        <meshStandardMaterial color={shade(stone, 0.85)} roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

function Billboard({ position, rotationY = 0, scale = 1, label }: AssetProps & { label?: string }) {
  const texture = useMemo(() => makeLabelTexture(label ?? "UADE", "#0d1526", "#7ff3ff"), [label]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {[-0.5, 0.5].map((x) => (
        <mesh key={x} castShadow position={[x, 0.25, 0]}>
          <boxGeometry args={[0.06, 0.5, 0.06]} />
          <meshStandardMaterial color="#1f2933" roughness={0.6} />
        </mesh>
      ))}
      <mesh castShadow receiveShadow position={[0, 0.86, 0]}>
        <boxGeometry args={[1.3, 0.76, 0.07]} />
        <meshStandardMaterial color="#14202e" roughness={0.5} />
      </mesh>
      {/* pantallas brillantes */}
      <mesh position={[-0.34, 0.86, 0.041]}>
        <planeGeometry args={[0.5, 0.6]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh position={[0.2, 1.0, 0.041]}>
        <planeGeometry args={[0.48, 0.3]} />
        <meshStandardMaterial color="#a78bfa" emissive="#8b5cf6" emissiveIntensity={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0.2, 0.68, 0.041]}>
        <planeGeometry args={[0.48, 0.26]} />
        <meshStandardMaterial color="#38e8f8" emissive="#06b6d4" emissiveIntensity={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Bus({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const paint = tint ?? "#f59e0b";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.34, 0]}>
        <boxGeometry args={[1.05, 0.4, 0.42]} />
        <meshStandardMaterial color={paint} roughness={0.45} />
      </mesh>
      <mesh castShadow position={[0, 0.57, 0]}>
        <boxGeometry args={[1.05, 0.07, 0.42]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      {/* banda de ventanillas */}
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.94, 0.15, 0.44]} />
        <meshStandardMaterial color="#bfe3f7" roughness={0.2} metalness={0.05} />
      </mesh>
      {/* puerta */}
      <mesh position={[0.34, 0.3, 0.215]}>
        <boxGeometry args={[0.16, 0.3, 0.015]} />
        <meshStandardMaterial color="#1f2933" roughness={0.4} />
      </mesh>
      {/* ruedas */}
      {[
        [-0.34, 0.215],
        [0.34, 0.215],
        [-0.34, -0.215],
        [0.34, -0.215],
      ].map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.11, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 0.05, 12]} />
          <meshStandardMaterial color="#0f172a" roughness={0.7} />
        </mesh>
      ))}
      {/* faros */}
      {[0.13, -0.13].map((z) => (
        <mesh key={z} position={[0.53, 0.28, z]}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color="#fef9c3" emissive="#fde047" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// ── Fallback genérico para assets sin renderer dedicado ───────────────────────
function ProjectedAssetBlock({
  artifact,
  asset,
  position,
  rotationY,
  scale = 1,
}: {
  artifact: MapArtifact;
  asset?: MapAssetDef;
  position: Vec3;
  rotationY: number;
  scale?: number;
}) {
  const projection = useMemo(() => localAssetProjection(asset), [asset]);
  const width = Math.max(0.18, projection.width * BOARD_GRID_SPACING);
  const depth = Math.max(0.18, projection.height * BOARD_GRID_SPACING);
  const color = artifact.tint ?? asset?.color ?? artifactColor3D(asset?.kind);

  if (projection.shape === "circle" || projection.shape === "ellipse") {
    return (
      <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
        <mesh scale={[width / 2, 1, depth / 2]} receiveShadow>
          <cylinderGeometry args={[1, 1, 0.1, 36]} />
          <meshStandardMaterial color={color} roughness={0.66} />
        </mesh>
      </group>
    );
  }

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh receiveShadow castShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color={color} roughness={0.68} />
      </mesh>
    </group>
  );
}

function artifactColor3D(kind?: MapAssetDef["kind"]): string {
  if (kind === "tree") return "#166534";
  if (kind === "water") return "#0ea5e9";
  if (kind === "vehicle") return "#f8fafc";
  if (kind === "mountain") return "#78716c";
  if (kind === "house") return "#b35a37";
  if (kind === "court") return "#7cc879";
  if (kind === "plaza") return "#f4d790";
  if (kind === "sign") return "#475569";
  if (kind === "decor") return "#e2e8f0";
  return "#94a3b8";
}
