import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
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
import type { FacePhotoAlignment, MapArtifact, MapAssetDef, MapTerrace, MapTerraceSurface } from "@essence/shared";
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

/**
 * Textura por defecto de la cara del token: iniciales sobre un disco crema.
 * Es sólo el placeholder inicial — `AvatarFace` recibe cualquier CanvasTexture
 * o THREE.Texture, así que más adelante alcanza con generar una textura a
 * partir de la foto del jugador y pasarla en lugar de esta.
 */
export function makeFaceTexture(initials: string, color: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // esquinas transparentes: sólo pintamos un disco (la placa 3D ya es redonda,
  // pero dejamos el canvas circular para que no se vean bordes cuadrados si
  // se usa la textura en algo que no recorte).
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = canvas.width / 2 - 6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#fbf3df";
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#3a2f22";
  ctx.font = "900 118px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials.slice(0, 2).toUpperCase(), cx, cy + 8);
  return finishTexture(canvas);
}

const DEFAULT_FACE_PHOTO_ALIGNMENT: FacePhotoAlignment = { x: 0.5, y: 0.5, scale: 1, angle: 0 };

export function makePhotoFaceTexture(
  image: HTMLImageElement,
  color: string,
  alignment: FacePhotoAlignment = DEFAULT_FACE_PHOTO_ALIGNMENT
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = canvas.width / 2 - 6;
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const scale = Math.max(canvas.width / imageWidth, canvas.height / imageHeight) * Math.max(0.05, alignment.scale || 1);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const centerX = (Number.isFinite(alignment.x) ? alignment.x : DEFAULT_FACE_PHOTO_ALIGNMENT.x) * canvas.width;
  const centerY = (Number.isFinite(alignment.y) ? alignment.y : DEFAULT_FACE_PHOTO_ALIGNMENT.y) * canvas.height;
  const angle = ((Number.isFinite(alignment.angle ?? 0) ? alignment.angle ?? 0 : 0) * Math.PI) / 180;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#fbf3df";
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.translate(centerX, centerY);
  ctx.rotate(angle);
  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
  ctx.lineWidth = 10;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  return finishTexture(canvas);
}

const PLAYER_PHOTO_EXTENSIONS = ["webp", "jpg", "png"] as const;
const playerPhotoCache = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    if (!src.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export function loadPlayerPhoto(playerId: string): Promise<HTMLImageElement | null> {
  const cached = playerPhotoCache.get(playerId);
  if (cached) return cached;

  const promise = (async () => {
    for (const extension of PLAYER_PHOTO_EXTENSIONS) {
      const image = await loadImage(`/avatars/${encodeURIComponent(playerId)}.${extension}`);
      if (image) return image;
    }
    return null;
  })();
  playerPhotoCache.set(playerId, promise);
  return promise;
}

/**
 * Interior de aula "iluminada" para las ventanas traseras de la escuela: pizarrón
 * verde, un par de siluetas de banco/silla y luz cálida. Se genera UNA sola vez
 * (textura + material a nivel de módulo) y se reutiliza en las 9 ventanas.
 */
function makeClassroomTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  // pared cálida de fondo
  ctx.fillStyle = "#f6e2b8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // zócalo
  ctx.fillStyle = "#e2c891";
  ctx.fillRect(0, 150, canvas.width, 42);
  // pizarrón verde oscuro
  ctx.fillStyle = "#1f4d3d";
  ctx.fillRect(48, 26, 160, 78);
  ctx.strokeStyle = "#8a5a3b";
  ctx.lineWidth = 8;
  ctx.strokeRect(48, 26, 160, 78);
  // tiza (líneas prolijas, decorativas)
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(66, 48);
  ctx.lineTo(150, 48);
  ctx.moveTo(66, 64);
  ctx.lineTo(180, 64);
  ctx.moveTo(66, 80);
  ctx.lineTo(130, 80);
  ctx.stroke();
  // siluetas de banco + silla (cartoonish, bien legibles)
  const desks: Array<[number, number]> = [
    [40, 168],
    [108, 172],
    [176, 168],
  ];
  ctx.fillStyle = "#5b3a24";
  for (const [x, y] of desks) {
    ctx.fillRect(x, y - 22, 44, 8);
    ctx.fillRect(x + 4, y - 14, 6, 16);
    ctx.fillRect(x + 34, y - 14, 6, 16);
  }
  ctx.fillStyle = "#2f2318";
  for (const [x, y] of desks) {
    ctx.fillRect(x + 12, y - 38, 20, 16);
  }
  return finishTexture(canvas);
}

/** Textura + material compartidos de las ventanas de aula (misma instancia en las 9). */
const CLASSROOM_TEXTURE = makeClassroomTexture();
const CLASSROOM_WINDOW_MATERIAL = new MeshStandardMaterial({
  map: CLASSROOM_TEXTURE,
  emissive: new Color("#fde9b8"),
  emissiveMap: CLASSROOM_TEXTURE,
  emissiveIntensity: 0.45,
  roughness: 0.55,
});

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

// ── Map props ─────────────────────────────────────────────────────────────────
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
  // El map prop apoya sobre el terreno: worldY = elevación de terraza + (z ?? 0)
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
    case "fallen-fernet":
      return <FallenFernet position={position} rotationY={rotationY} scale={scale} />;
    case "vomiting-person":
      return <VomitingPerson position={position} rotationY={rotationY} scale={scale} />;
    case "blue-ikea-bag":
      return <BlueMarketBag position={position} rotationY={rotationY} scale={scale} />;
    case "hockey-stick":
      return <HockeyStick position={position} rotationY={rotationY} scale={scale} />;
    case "condom-bolas":
      return <CondomBolas position={position} rotationY={rotationY} scale={scale} />;
    case "botherlands-disc":
      return <BotherlandsDisc position={position} rotationY={rotationY} scale={scale} />;
    case "hoodie-log":
      return <HoodieLog position={position} rotationY={rotationY} scale={scale} />;
    case "cut-branch-oak":
      return <CutBranchOak position={position} rotationY={rotationY} scale={scale} />;
    case "uade-building":
      return <UadeBuilding position={position} rotationY={rotationY} scale={scale} />;
    case "uba-building":
      return <UbaBuilding position={position} rotationY={rotationY} scale={scale} />;
    case "desk-chair-tower":
      return <DeskChairTower position={position} rotationY={rotationY} scale={scale} />;
    case "croissant":
      return <Croissant position={position} rotationY={rotationY} scale={scale} />;
    case "wedding-ring":
      return <WeddingRing position={position} rotationY={rotationY} scale={scale} />;
    case "ukulele":
      return <Ukulele position={position} rotationY={rotationY} scale={scale} />;
    case "rugby-ball":
      return <SportsBall position={position} rotationY={rotationY} scale={scale} sport="rugby" />;
    case "basketball":
      return <SportsBall position={position} rotationY={rotationY} scale={scale} sport="basketball" />;
    case "football-ball":
      return <SportsBall position={position} rotationY={rotationY} scale={scale} sport="football" />;
    case "tuna-can":
      return <FoodCan position={position} rotationY={rotationY} scale={scale} label="ATUN" color="#6b7280" stripe="#60a5fa" />;
    case "jardinera-can":
      return <FoodCan position={position} rotationY={rotationY} scale={scale} label="JARD" color="#15803d" stripe="#f97316" />;
    case "sunscreen":
      return <Sunscreen position={position} rotationY={rotationY} scale={scale} />;
    case "vodka-bottle":
      return <VodkaBottle position={position} rotationY={rotationY} scale={scale} />;
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

// ── "Escuela Argentina de 3 plantas" ──────────────────────────────────────────
// Bloque rectangular: nivel sótano (entrada semi-hundida) + 3 plantas de aulas.
// Frente (+Z local): galería exterior con baranda en cada planta + bloque de
// escalera ciego en el extremo -X. Contrafrente (-Z local): ladrillo continuo
// con la grilla 3×3 de ventanas de aula iluminadas.
const SCHOOL_CONCRETE = "#d9d2c4";
const SCHOOL_METAL = "#2f3540";
const SCHOOL_WHITE = "#f8fafc";
const SCHOOL_GLASS = "#bfe0f5";
const SCHOOL_ARG_BLUE = "#74acdf";

const SCHOOL_FLOOR_H = 0.42;
const SCHOOL_BASE_H = 0.26;
// Y de piso (donde apoyan puertas/galería) para cada una de las 3 plantas.
const SCHOOL_FLOOR_YS = [0, 1, 2].map((i) => SCHOOL_BASE_H + i * SCHOOL_FLOOR_H);
const SCHOOL_BODY_W = 2.2;
const SCHOOL_BODY_D = 1.0;
const SCHOOL_STAIR_W = 0.34;
// centro del bloque de aulas (todo menos la escalera), del lado +X del edificio
const SCHOOL_CLASS_W = SCHOOL_BODY_W - SCHOOL_STAIR_W;
const SCHOOL_CLASS_CENTER_X = SCHOOL_STAIR_W / 2;
const SCHOOL_STAIR_CENTER_X = -SCHOOL_BODY_W / 2 + SCHOOL_STAIR_W / 2;
const SCHOOL_TOTAL_H = SCHOOL_BASE_H + 3 * SCHOOL_FLOOR_H; // altura de muros hasta el techo

// ── Materiales compartidos (una instancia por tipo, reutilizada en todo el edificio) ──
const SCHOOL_DOOR_MATERIAL = new MeshStandardMaterial({ color: SCHOOL_WHITE, roughness: 0.45 });
const SCHOOL_WINDOW_FRAME_MATERIAL = new MeshStandardMaterial({ color: SCHOOL_WHITE, roughness: 0.5 });
const SCHOOL_GLASS_MATERIAL = new MeshStandardMaterial({ color: SCHOOL_GLASS, roughness: 0.2, metalness: 0.05 });
const SCHOOL_RAILING_MATERIAL = new MeshStandardMaterial({ color: SCHOOL_METAL, roughness: 0.5, metalness: 0.4 });
const SCHOOL_CONCRETE_MATERIAL = new MeshStandardMaterial({ color: SCHOOL_CONCRETE, roughness: 0.72 });
const SCHOOL_ROOF_MATERIAL = new MeshStandardMaterial({ color: SCHOOL_CONCRETE, roughness: 0.6 });

// ── Geometrías compartidas (misma malla para cada repetición) ─────────────────
const SCHOOL_DOOR_GEOMETRY = new BoxGeometry(0.22, 0.32, 0.02);
const SCHOOL_SLIM_WINDOW_GEOMETRY = new BoxGeometry(0.09, 0.2, 0.015);
const SCHOOL_RAIL_TOPBAR_GEOMETRY = new BoxGeometry(1, 0.02, 0.02); // escalada en X por planta
const SCHOOL_RAIL_POST_GEOMETRY = new BoxGeometry(0.018, 0.28, 0.018);
const SCHOOL_BACK_WINDOW_FRAME_GEOMETRY = new BoxGeometry(0.34, 0.3, 0.03);
const SCHOOL_BACK_WINDOW_GLASS_GEOMETRY = new BoxGeometry(0.28, 0.24, 0.015);

/** Baranda de galería: barra superior escalada + postes verticales (low-poly, 6 postes). */
function CorridorRailing({ width, y, z }: { width: number; y: number; z: number }) {
  const postXs = useMemo(() => {
    const count = 6;
    const arr: number[] = [];
    for (let i = 0; i < count; i++) arr.push(-width / 2 + (i * width) / (count - 1));
    return arr;
  }, [width]);
  return (
    <group position={[0, y, z]}>
      <mesh position={[0, 0.28, 0]} scale={[width, 1, 1]} geometry={SCHOOL_RAIL_TOPBAR_GEOMETRY} material={SCHOOL_RAILING_MATERIAL} dispose={null} />
      {postXs.map((x) => (
        <mesh key={x} position={[x, 0.14, 0]} geometry={SCHOOL_RAIL_POST_GEOMETRY} material={SCHOOL_RAILING_MATERIAL} dispose={null} />
      ))}
    </group>
  );
}

/** Una planta del frente: losa de galería + baranda + 3 puertas + ventanas angostas. */
function SchoolFrontFloor({ y }: { y: number }) {
  const doorXs = [-SCHOOL_CLASS_W * 0.3, 0, SCHOOL_CLASS_W * 0.3];
  const windowXs = [-SCHOOL_CLASS_W * 0.45, -SCHOOL_CLASS_W * 0.15, SCHOOL_CLASS_W * 0.15, SCHOOL_CLASS_W * 0.45];
  const frontZ = SCHOOL_BODY_D / 2;
  return (
    <group position={[SCHOOL_CLASS_CENTER_X, y, 0]}>
      {/* losa de galería que sobresale */}
      <mesh receiveShadow position={[0, 0.015, frontZ + 0.07]}>
        <boxGeometry args={[SCHOOL_CLASS_W, 0.03, 0.14]} />
        <primitive object={SCHOOL_CONCRETE_MATERIAL} attach="material" />
      </mesh>
      <CorridorRailing width={SCHOOL_CLASS_W - 0.06} y={0.03} z={frontZ + 0.13} />
      {/* puertas blancas de aula */}
      {doorXs.map((x) => (
        <mesh key={`door-${x}`} castShadow position={[x, 0.16, frontZ + 0.011]} geometry={SCHOOL_DOOR_GEOMETRY} material={SCHOOL_DOOR_MATERIAL} dispose={null} />
      ))}
      {/* ventanas angostas entre puertas */}
      {windowXs.map((x) => (
        <mesh key={`win-${x}`} position={[x, 0.2, frontZ + 0.011]} geometry={SCHOOL_SLIM_WINDOW_GEOMETRY} material={SCHOOL_GLASS_MATERIAL} dispose={null} />
      ))}
    </group>
  );
}

/** Ventana grande de aula del contrafrente: marco blanco + vidrio con el aula iluminada. */
function SchoolBackWindow({ x, y }: { x: number; y: number }) {
  return (
    <group position={[x, y, -SCHOOL_BODY_D / 2 - 0.001]}>
      <mesh geometry={SCHOOL_BACK_WINDOW_FRAME_GEOMETRY} material={SCHOOL_WINDOW_FRAME_MATERIAL} dispose={null} />
      <mesh position={[0, 0, -0.016]} geometry={SCHOOL_BACK_WINDOW_GLASS_GEOMETRY} material={CLASSROOM_WINDOW_MATERIAL} dispose={null} />
    </group>
  );
}

/** Mástil low-poly con bandera (blanca lisa o celeste-blanco-celeste argentina). */
function Flagpole({ x, z, variant }: { x: number; z: number; variant: "white" | "argentina" }) {
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.012, 0.016, 0.9, 7]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.35} roughness={0.4} />
      </mesh>
      {variant === "white" ? (
        <mesh position={[0.09, 0.82, 0]}>
          <boxGeometry args={[0.18, 0.12, 0.012]} />
          <meshStandardMaterial color={SCHOOL_WHITE} roughness={0.5} side={DoubleSide} />
        </mesh>
      ) : (
        <group position={[0.09, 0.82, 0]}>
          {[-0.04, 0, 0.04].map((bandY, index) => (
            <mesh key={bandY} position={[0, bandY, 0]}>
              <boxGeometry args={[0.18, 0.04, 0.012]} />
              <meshStandardMaterial color={index === 1 ? SCHOOL_WHITE : SCHOOL_ARG_BLUE} roughness={0.5} side={DoubleSide} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/** Rampa de acceso dividida: dos tramos cortos con baranda central. */
function EntranceRamp() {
  const z = SCHOOL_BODY_D / 2 + 0.1;
  return (
    <group position={[SCHOOL_CLASS_CENTER_X, 0, z]}>
      {[-0.11, 0.11].map((x) => (
        <mesh key={x} receiveShadow position={[x, 0.045, 0.06]} rotation={[-0.32, 0, 0]}>
          <boxGeometry args={[0.18, 0.02, 0.22]} />
          <primitive object={SCHOOL_CONCRETE_MATERIAL} attach="material" />
        </mesh>
      ))}
      {/* baranda central de la rampa */}
      <mesh position={[0, 0.13, 0.03]}>
        <boxGeometry args={[0.018, 0.16, 0.018]} />
        <primitive object={SCHOOL_RAILING_MATERIAL} attach="material" />
      </mesh>
      <mesh position={[0, 0.19, 0.03]} rotation={[-0.32, 0, 0]}>
        <boxGeometry args={[0.018, 0.018, 0.24]} />
        <primitive object={SCHOOL_RAILING_MATERIAL} attach="material" />
      </mesh>
    </group>
  );
}

function School({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const brick = tint ?? "#b5533c";
  const brickMaterial = useMemo(() => new MeshStandardMaterial({ color: brick, roughness: 0.78 }), [brick]);
  useEffect(() => () => brickMaterial.dispose(), [brickMaterial]);

  const backWindows = useMemo(() => {
    const cols = [-SCHOOL_CLASS_W * 0.32, SCHOOL_CLASS_CENTER_X, SCHOOL_CLASS_CENTER_X + SCHOOL_CLASS_W * 0.32];
    return SCHOOL_FLOOR_YS.map((y) => cols.map((x) => [x, y + SCHOOL_FLOOR_H * 0.5] as const)).flat();
  }, []);

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* cuerpo de ladrillo (zona de aulas), apoyado en el piso */}
      <mesh castShadow receiveShadow position={[SCHOOL_CLASS_CENTER_X, SCHOOL_TOTAL_H / 2, 0]} material={brickMaterial}>
        <boxGeometry args={[SCHOOL_CLASS_W, SCHOOL_TOTAL_H, SCHOOL_BODY_D]} />
      </mesh>
      {/* bloque de escalera: ligeramente más alto y proa hacia +Z, ciego atrás/costado */}
      <mesh
        castShadow
        receiveShadow
        position={[SCHOOL_STAIR_CENTER_X, (SCHOOL_TOTAL_H + 0.08) / 2, 0.03]}
        material={brickMaterial}
      >
        <boxGeometry args={[SCHOOL_STAIR_W, SCHOOL_TOTAL_H + 0.08, SCHOOL_BODY_D + 0.06]} />
      </mesh>

      {/* nivel sótano: entrada recesada */}
      <mesh position={[SCHOOL_CLASS_CENTER_X, SCHOOL_BASE_H / 2, SCHOOL_BODY_D / 2 - 0.04]}>
        <boxGeometry args={[0.5, SCHOOL_BASE_H - 0.03, 0.08]} />
        <meshStandardMaterial color="#241b16" roughness={0.9} />
      </mesh>

      {/* 3 plantas de galería frontal */}
      {SCHOOL_FLOOR_YS.map((y) => (
        <SchoolFrontFloor key={y} y={y} />
      ))}

      {/* puertas de emergencia del bloque de escalera: una por planta, donde la galería lo toca */}
      {SCHOOL_FLOOR_YS.map((y) => (
        <mesh
          key={`stair-door-${y}`}
          castShadow
          position={[SCHOOL_STAIR_CENTER_X + SCHOOL_STAIR_W / 2 - 0.01, y + 0.16, SCHOOL_BODY_D / 2 + 0.06]}
          geometry={SCHOOL_DOOR_GEOMETRY}
          material={SCHOOL_DOOR_MATERIAL}
          dispose={null}
        />
      ))}

      {/* techo plano con parapeto, sobre la zona de aulas */}
      <mesh castShadow position={[SCHOOL_CLASS_CENTER_X, SCHOOL_TOTAL_H + 0.04, 0]} material={SCHOOL_ROOF_MATERIAL}>
        <boxGeometry args={[SCHOOL_CLASS_W + 0.1, 0.08, SCHOOL_BODY_D + 0.1]} />
      </mesh>
      <mesh position={[SCHOOL_CLASS_CENTER_X, SCHOOL_TOTAL_H + 0.1, 0]} material={SCHOOL_ROOF_MATERIAL}>
        <boxGeometry args={[SCHOOL_CLASS_W - 0.04, 0.05, SCHOOL_BODY_D - 0.04]} />
      </mesh>
      {/* techo propio del bloque de escalera, un poco más alto */}
      <mesh position={[SCHOOL_STAIR_CENTER_X, SCHOOL_TOTAL_H + 0.12, 0.03]} material={SCHOOL_ROOF_MATERIAL}>
        <boxGeometry args={[SCHOOL_STAIR_W + 0.05, 0.08, SCHOOL_BODY_D + 0.11]} />
      </mesh>

      {/* contrafrente: grilla 3×3 de ventanas grandes de aula iluminada */}
      {backWindows.map(([x, y]) => (
        <SchoolBackWindow key={`${x}:${y}`} x={x} y={y} />
      ))}

      {/* rampa de acceso dividida + mástiles frente a la entrada */}
      <EntranceRamp />
      <Flagpole x={SCHOOL_CLASS_CENTER_X - 0.4} z={SCHOOL_BODY_D / 2 + 0.2} variant="white" />
      <Flagpole x={SCHOOL_CLASS_CENTER_X + 0.4} z={SCHOOL_BODY_D / 2 + 0.2} variant="argentina" />
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

function MiniLabel({
  text,
  background,
  color = "#ffffff",
  width = 0.34,
  height = 0.16,
}: {
  text: string;
  background: string;
  color?: string;
  width?: number;
  height?: number;
}) {
  const texture = useMemo(() => makeLabelTexture(text, background, color), [background, color, text]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} side={DoubleSide} />
    </mesh>
  );
}

function MiniPlane({ color, width, height }: { color: string; width: number; height: number }) {
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial color={color} roughness={0.62} side={DoubleSide} />
    </mesh>
  );
}

function FallenFernet({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, -Math.PI / 2]} scale={[scale, scale, scale]}>
      <mesh position={[-0.54, 0.014, 0.02]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.23, 0.1, 0.018, 20]} />
        <meshStandardMaterial color="#4a2513" roughness={0.72} transparent opacity={0.78} />
      </mesh>
      <mesh position={[-0.34, 0.016, -0.13]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.12, 0.05, 0.014, 16]} />
        <meshStandardMaterial color="#7c3f1d" roughness={0.68} transparent opacity={0.62} />
      </mesh>
      <mesh castShadow position={[0, 0.095, 0]}>
        <cylinderGeometry args={[0.085, 0.1, 0.7, 16]} />
        <meshStandardMaterial color="#1a120d" roughness={0.32} metalness={0.05} transparent opacity={0.88} />
      </mesh>
      <mesh position={[-0.1, 0.18, 0.035]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.025, 0.42, 0.012]} />
        <meshStandardMaterial color="#fef3c7" roughness={0.18} transparent opacity={0.52} />
      </mesh>
      <mesh position={[0, 0.08, 0.083]} rotation={[0, 0, Math.PI / 2]}>
        <MiniLabel text="FERNET" background="#f5c542" color="#111827" width={0.34} height={0.18} />
      </mesh>
      <mesh position={[0.05, 0.08, -0.088]} rotation={[0, 0, Math.PI / 2]}>
        <MiniLabel text="BRANCA" background="#f8fafc" color="#991b1b" width={0.24} height={0.08} />
      </mesh>
      <mesh castShadow position={[0.43, 0.095, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.22, 14]} />
        <meshStandardMaterial color="#2d1a12" roughness={0.34} />
      </mesh>
      <mesh castShadow position={[0.58, 0.095, 0]}>
        <cylinderGeometry args={[0.048, 0.048, 0.07, 14]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.38} metalness={0.12} />
      </mesh>
      <mesh position={[0.67, 0.03, -0.12]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.025, 14]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.5} metalness={0.18} />
      </mesh>
    </group>
  );
}

function VomitingPerson({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[-0.18, 0.34, -0.02]} rotation={[0.28, 0, -0.12]}>
        <boxGeometry args={[0.26, 0.34, 0.17]} />
        <meshStandardMaterial color="#7c3aed" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[-0.3, 0.61, 0.13]} rotation={[0.5, 0, -0.14]}>
        <sphereGeometry args={[0.12, 14, 10]} />
        <meshStandardMaterial color="#f2c197" roughness={0.55} />
      </mesh>
      <mesh position={[-0.31, 0.72, 0.08]} rotation={[0.34, 0, -0.12]}>
        <sphereGeometry args={[0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#2f1d13" roughness={0.74} />
      </mesh>
      {[
        [-0.28, -0.11, 0.72],
        [0.04, 0.11, -0.55],
      ].map(([x, z, r]) => (
        <mesh key={`${x}:${z}`} castShadow position={[x, 0.12, z]} rotation={[r, 0, 0]}>
          <boxGeometry args={[0.07, 0.25, 0.07]} />
          <meshStandardMaterial color="#1f2937" roughness={0.7} />
        </mesh>
      ))}
      {[[-0.36, -0.08, -0.55], [-0.04, 0.1, 0.42]].map(([x, z, r]) => (
        <mesh key={`shoe-${x}`} castShadow position={[x, 0.035, z]} rotation={[0, r, 0]}>
          <boxGeometry args={[0.14, 0.05, 0.08]} />
          <meshStandardMaterial color="#111827" roughness={0.72} />
        </mesh>
      ))}
      {[[-0.31, 0.18], [-0.02, -0.13]].map(([x, z]) => (
        <mesh key={`hand-${x}`} castShadow position={[x, 0.31, z]} rotation={[0.8, 0, 0.2]}>
          <cylinderGeometry args={[0.026, 0.028, 0.28, 8]} />
          <meshStandardMaterial color="#f2c197" roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[-0.1, 0.18, 0.39]} rotation={[-0.95, 0, -0.1]}>
        <cylinderGeometry args={[0.025, 0.045, 0.55, 8]} />
        <meshStandardMaterial color="#86efac" roughness={0.45} transparent opacity={0.84} />
      </mesh>
      <mesh position={[0.02, 0.024, 0.64]} scale={[1.65, 0.2, 0.78]}>
        <sphereGeometry args={[0.15, 14, 8]} />
        <meshStandardMaterial color="#65a30d" roughness={0.8} transparent opacity={0.82} />
      </mesh>
      {[0.23, 0.36, 0.49].map((z, index) => (
        <mesh key={z} position={[-0.06 + index * 0.05, 0.032, z]} scale={[1, 0.28, 0.72]}>
          <sphereGeometry args={[0.055, 10, 6]} />
          <meshStandardMaterial color={index % 2 ? "#84cc16" : "#bef264"} roughness={0.72} transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  );
}

function BlueMarketBag({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.23, 0]}>
        <boxGeometry args={[0.68, 0.42, 0.36]} />
        <meshStandardMaterial color="#0058a3" roughness={0.7} />
      </mesh>
      {[-0.34, 0.34].map((x) => (
        <mesh key={x} position={[x, 0.25, 0]} rotation={[0, 0, x > 0 ? -0.08 : 0.08]}>
          <boxGeometry args={[0.035, 0.38, 0.38]} />
          <meshStandardMaterial color="#004982" roughness={0.78} />
        </mesh>
      ))}
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.58, 0.035, 0.28]} />
        <meshStandardMaterial color="#0b4f8a" roughness={0.8} />
      </mesh>
      {[-0.18, 0.18].map((x) => (
        <mesh key={`fold-${x}`} position={[x, 0.23, 0.19]}>
          <boxGeometry args={[0.02, 0.32, 0.018]} />
          <meshStandardMaterial color="#0b4f8a" roughness={0.78} />
        </mesh>
      ))}
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} castShadow position={[x, 0.5, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.14, 0.015, 8, 22, Math.PI]} />
          <meshStandardMaterial color="#facc15" roughness={0.52} />
        </mesh>
      ))}
      <mesh position={[0, 0.25, 0.185]}>
        <MiniLabel text="IKEA" background="#facc15" color="#0058a3" width={0.32} height={0.15} />
      </mesh>
      <mesh castShadow position={[0.16, 0.52, -0.02]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.18, 0.14, 0.08]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.66} />
      </mesh>
    </group>
  );
}

function HockeyStick({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0.18]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.018, 0.018, 0.95, 8]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.45} metalness={0.08} />
      </mesh>
      <mesh castShadow position={[0.53, 0.055, -0.12]} rotation={[0, -0.58, Math.PI / 2]}>
        <boxGeometry args={[0.12, 0.038, 0.32]} />
        <meshStandardMaterial color="#111827" roughness={0.7} />
      </mesh>
      {[-0.25, -0.16, 0.12, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.06, 0.02]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.021, 0.021, 0.045, 8]} />
          <meshStandardMaterial color={x < 0 ? "#ef4444" : "#0ea5e9"} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[-0.5, 0.061, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.022, 0.13, 8]} />
        <meshStandardMaterial color="#111827" roughness={0.62} />
      </mesh>
      <mesh position={[0.44, 0.025, 0.14]} scale={[1, 0.22, 0.72]}>
        <sphereGeometry args={[0.05, 10, 6]} />
        <meshStandardMaterial color="#0f172a" roughness={0.82} />
      </mesh>
    </group>
  );
}

function CondomBolas({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh position={[0, 0.07, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.01, 0.01, 0.8, 6]} />
        <meshStandardMaterial color="#c4b08d" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <sphereGeometry args={[0.045, 10, 6]} />
        <meshStandardMaterial color="#b79b70" roughness={0.7} />
      </mesh>
      {[
        [-0.42, -0.12, -0.16],
        [0.42, 0.12, 0.16],
      ].map(([x, z, r]) => (
        <group key={`${x}:${z}`} position={[x, 0.1, z]} rotation={[0, r, 0]}>
          <mesh scale={[0.7, 1, 0.56]}>
            <sphereGeometry args={[0.16, 18, 10]} />
            <meshStandardMaterial color="#f7ead8" roughness={0.22} transparent opacity={0.66} />
          </mesh>
          <mesh scale={[0.46, 0.75, 0.36]}>
            <sphereGeometry args={[0.16, 14, 8]} />
            <meshStandardMaterial color="#6b3a1d" roughness={0.82} />
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <torusGeometry args={[0.08, 0.01, 8, 16]} />
            <meshStandardMaterial color="#d6c8ad" roughness={0.64} />
          </mesh>
          <mesh position={[0.02, 0.04, 0.06]} scale={[0.35, 0.08, 0.2]}>
            <sphereGeometry args={[0.16, 10, 6]} />
            <meshStandardMaterial color="#4a2414" roughness={0.9} transparent opacity={0.78} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function makeDiscTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#101827";
  ctx.beginPath();
  ctx.arc(256, 256, 246, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(256, 256, 220, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(256, 256, 154, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#facc15";
  ctx.font = "900 54px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("BOTHER", 256, 214);
  ctx.fillText("LANDS", 256, 278);
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "800 30px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("XBOX 360", 256, 346);
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.arc(256, 256, 54, 0, Math.PI * 2);
  ctx.fill();
  return finishTexture(canvas);
}

function BotherlandsDisc({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const texture = useMemo(makeDiscTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0.08, 0.025, -0.06]} rotation={[-Math.PI / 2, 0, -0.12]}>
        <boxGeometry args={[0.74, 0.52, 0.035]} />
        <meshStandardMaterial color="#16a34a" roughness={0.46} />
      </mesh>
      <mesh position={[0.08, 0.052, -0.315]} rotation={[-Math.PI / 2, 0, -0.12]}>
        <MiniLabel text="XBOX 360" background="#f8fafc" color="#166534" width={0.68} height={0.12} />
      </mesh>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.025, 40]} />
        <meshStandardMaterial color="#d1d5db" metalness={0.32} roughness={0.26} />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.292, 40]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function HoodieLog({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, Math.PI / 2]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.2, 0.22, 0.66, 16]} />
        <meshStandardMaterial color="#8b5a2b" roughness={0.86} />
      </mesh>
      {[-0.34, 0.34].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.205, 0.205, 0.018, 18]} />
          <meshStandardMaterial color="#d6b17c" roughness={0.8} />
        </mesh>
      ))}
      {[-0.06, 0.02, 0.1].map((x) => (
        <mesh key={x} position={[x, -0.342, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.1 + x * 0.5, 0.006, 6, 18]} />
          <meshStandardMaterial color="#7a4a24" roughness={0.86} />
        </mesh>
      ))}
      {[-0.2, 0.04, 0.24].map((y) => (
        <mesh key={`bark-${y}`} position={[0.205, y, 0.04]} rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.025, 0.28, 0.014]} />
          <meshStandardMaterial color="#5f3519" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0.02, 0.03, 0.18]} rotation={[0, 0, -Math.PI / 2]}>
        <boxGeometry args={[0.48, 0.06, 0.36]} />
        <meshStandardMaterial color="#334155" roughness={0.82} />
      </mesh>
      <mesh position={[0.01, 0.18, 0.2]} rotation={[Math.PI / 2, 0, -Math.PI / 2]}>
        <torusGeometry args={[0.12, 0.035, 8, 18, Math.PI]} />
        <meshStandardMaterial color="#1f2937" roughness={0.85} />
      </mesh>
      {[-0.13, 0.13].map((z) => (
        <mesh key={z} position={[0, 0.07, 0.39 + z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 0.28, 6]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.64} />
        </mesh>
      ))}
      {[-0.18, 0.18].map((y) => (
        <mesh key={`sleeve-${y}`} position={[0.0, y, 0.2]} rotation={[0, 0, -Math.PI / 2]}>
          <boxGeometry args={[0.22, 0.045, 0.11]} />
          <meshStandardMaterial color="#1f2937" roughness={0.86} />
        </mesh>
      ))}
    </group>
  );
}

function CutBranchOak({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.09, 0.14, 0.76, 10]} />
        <meshStandardMaterial color="#7a4a24" roughness={0.86} />
      </mesh>
      {[
        [0, 0.86, 0, 0.38, "#3f7f3f"],
        [-0.23, 0.76, 0.06, 0.28, "#4f8a42"],
        [0.24, 0.8, -0.04, 0.3, "#2f6f35"],
        [0.04, 1.02, 0.02, 0.26, "#5a9a47"],
      ].map(([x, y, z, radius, color]) => (
        <mesh key={`${x}:${y}`} castShadow position={[x as number, y as number, z as number]} scale={[1.25, 0.85, 1.05]}>
          <sphereGeometry args={[radius as number, 12, 8]} />
          <meshStandardMaterial color={color as string} roughness={0.78} flatShading />
        </mesh>
      ))}
      <mesh castShadow position={[0.24, 0.58, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.045, 0.06, 0.45, 9]} />
        <meshStandardMaterial color="#7a4a24" roughness={0.86} />
      </mesh>
      <mesh position={[0.48, 0.58, 0]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.02, 14]} />
        <meshStandardMaterial color="#d6b17c" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0.55, 0.08, 0.16]} rotation={[0.35, 0.55, Math.PI / 2]}>
        <cylinderGeometry args={[0.04, 0.055, 0.78, 9]} />
        <meshStandardMaterial color="#76451f" roughness={0.86} />
      </mesh>
      <mesh position={[0.82, 0.08, 0.1]} rotation={[0.2, 0.55, Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.032, 0.36, 7]} />
        <meshStandardMaterial color="#76451f" roughness={0.86} />
      </mesh>
      {[0.2, 0.42, 0.62].map((x, index) => (
        <mesh key={x} position={[x, 0.1, 0.4 + index * 0.05]} scale={[1.2, 0.42, 0.75]}>
          <sphereGeometry args={[0.13, 10, 8]} />
          <meshStandardMaterial color={index === 1 ? "#5a9a47" : "#4f8a42"} roughness={0.8} flatShading />
        </mesh>
      ))}
      <mesh position={[0.32, 0.58, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.052, 0.005, 6, 14]} />
        <meshStandardMaterial color="#8b5a2b" roughness={0.8} />
      </mesh>
    </group>
  );
}

function UadeBuilding({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.08, 0]}>
        <boxGeometry args={[1.42, 0.16, 1.0]} />
        <meshStandardMaterial color="#475569" roughness={0.5} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.95, 0]}>
        <boxGeometry args={[1.25, 1.72, 0.82]} />
        <meshStandardMaterial color="#7dd3fc" roughness={0.08} metalness={0.18} transparent opacity={0.72} />
      </mesh>
      <mesh castShadow receiveShadow position={[0.48, 0.74, -0.06]}>
        <boxGeometry args={[0.28, 1.28, 0.9]} />
        <meshStandardMaterial color="#bae6fd" roughness={0.12} metalness={0.12} transparent opacity={0.58} />
      </mesh>
      {[-0.48, -0.24, 0, 0.24, 0.48].map((x) => (
        <mesh key={`mullion-${x}`} position={[x, 0.96, 0.422]}>
          <boxGeometry args={[0.02, 1.58, 0.025]} />
          <meshStandardMaterial color="#1e3a5f" roughness={0.32} metalness={0.42} />
        </mesh>
      ))}
      {[0.38, 0.66, 0.94, 1.22, 1.5].map((y) => (
        <mesh key={`floor-${y}`} position={[0, y, 0.424]}>
          <boxGeometry args={[1.18, 0.018, 0.026]} />
          <meshStandardMaterial color="#1e3a5f" roughness={0.34} metalness={0.36} />
        </mesh>
      ))}
      {[-0.38, -0.13, 0.13, 0.38].map((x, index) =>
        [0.52, 0.8, 1.08, 1.36].map((y) => (
          <mesh key={`pane-${x}-${y}`} position={[x, y, 0.438]}>
            <boxGeometry args={[0.16, 0.16, 0.012]} />
            <meshStandardMaterial
              color={index % 2 ? "#e0f7ff" : "#93e2ff"}
              roughness={0.08}
              metalness={0.05}
              transparent
              opacity={0.72}
            />
          </mesh>
        ))
      )}
      <mesh castShadow position={[0, 0.22, 0.48]}>
        <boxGeometry args={[0.62, 0.2, 0.08]} />
        <meshStandardMaterial color="#0f172a" roughness={0.36} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.25, 0.525]}>
        <MiniLabel text="UADE" background="#062947" color="#7ff3ff" width={0.5} height={0.16} />
      </mesh>
      <mesh castShadow position={[0, 0.12, 0.64]}>
        <boxGeometry args={[0.36, 0.18, 0.12]} />
        <meshStandardMaterial color="#dbeafe" roughness={0.1} metalness={0.1} transparent opacity={0.75} />
      </mesh>
      {[-0.38, 0, 0.38].map((x) => (
        <mesh key={`light-${x}`} position={[x, 1.72, 0.45]}>
          <boxGeometry args={[0.032, 0.22, 0.032]} />
          <meshStandardMaterial color="#e0f2fe" roughness={0.12} metalness={0.28} />
        </mesh>
      ))}
      <mesh castShadow position={[0.34, 1.9, 0.1]}>
        <boxGeometry args={[0.28, 0.16, 0.22]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.58} />
      </mesh>
      <mesh position={[-0.26, 1.86, 0.16]} rotation={[0, 0, 0.2]}>
        <boxGeometry args={[0.34, 0.025, 0.18]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.32} roughness={0.2} />
      </mesh>
    </group>
  );
}

function PoliticalPoster({ x, y, z, text, color }: { x: number; y: number; z: number; text: string; color: string }) {
  return (
    <group position={[x, y, z]}>
      <MiniLabel text={text} background={color} color="#fff7ed" width={0.26} height={0.14} />
    </group>
  );
}

function UbaBuilding({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.62, 0]}>
        <boxGeometry args={[1.5, 1.24, 0.82]} />
        <meshStandardMaterial color="#9b948a" roughness={0.94} />
      </mesh>
      <mesh castShadow position={[0, 1.33, 0]}>
        <boxGeometry args={[1.64, 0.18, 0.92]} />
        <meshStandardMaterial color="#6f6861" roughness={0.92} />
      </mesh>
      <mesh castShadow position={[0, 0.1, 0.47]}>
        <boxGeometry args={[1.66, 0.2, 0.12]} />
        <meshStandardMaterial color="#5f5750" roughness={0.95} />
      </mesh>
      {[-0.56, -0.28, 0, 0.28, 0.56].map((x) => (
        <mesh key={`column-${x}`} castShadow position={[x, 0.56, 0.45]}>
          <boxGeometry args={[0.075, 0.88, 0.075]} />
          <meshStandardMaterial color="#7c756d" roughness={0.94} />
        </mesh>
      ))}
      {[-0.42, 0, 0.42].map((x, column) =>
        [0.5, 0.86].map((y, row) => (
          <mesh key={`${x}:${y}`} position={[x, y, 0.405]}>
            <boxGeometry args={[0.2, 0.18, 0.025]} />
            <meshStandardMaterial color={row === 0 && column === 1 ? "#3f3a34" : "#cbd5e1"} roughness={0.65} transparent opacity={0.72} />
          </mesh>
        ))
      )}
      {[-0.55, -0.18, 0.18, 0.55].map((x, index) => (
        <mesh key={x} position={[x, 0.22, 0.415]}>
          <boxGeometry args={[0.11, 0.44, 0.035]} />
          <meshStandardMaterial color={index % 2 ? "#57534e" : "#44403c"} roughness={0.9} />
        </mesh>
      ))}
      <PoliticalPoster x={-0.45} y={1.13} z={0.424} text="UBA" color="#dc2626" />
      <PoliticalPoster x={-0.08} y={1.11} z={0.424} text="ASAM" color="#7c3aed" />
      <PoliticalPoster x={0.31} y={1.13} z={0.424} text="LUCHA" color="#15803d" />
      <PoliticalPoster x={0.55} y={0.72} z={0.424} text="NO" color="#0f766e" />
      {[
        [-0.2, 0.74, 0.42, 0.55],
        [0.34, 0.7, 0.42, -0.45],
        [0.02, 1.22, 0.42, 0.7],
        [-0.58, 0.42, 0.42, -0.62],
        [0.56, 1.02, 0.42, 0.48],
      ].map(([x, y, z, r]) => (
        <mesh key={`${x}:${y}`} position={[x, y, z]} rotation={[0, 0, r]}>
          <boxGeometry args={[0.025, 0.38, 0.02]} />
          <meshStandardMaterial color="#292524" roughness={0.95} />
        </mesh>
      ))}
      {[
        [-0.62, 1.34, 0.47],
        [0.1, 0.68, 0.47],
        [0.46, 0.36, 0.47],
      ].map(([x, y, z]) => (
        <mesh key={`patch-${x}`} position={[x, y, z]} rotation={[0, 0, -0.18]}>
          <boxGeometry args={[0.18, 0.035, 0.018]} />
          <meshStandardMaterial color="#4a433c" roughness={0.98} />
        </mesh>
      ))}
      <mesh position={[0, 1.48, 0.01]}>
        <boxGeometry args={[1.3, 0.025, 0.72]} />
        <meshStandardMaterial color="#3f3a34" roughness={0.94} />
      </mesh>
    </group>
  );
}

function DeskChairTower({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const layers = [
    [-0.26, 0.13, 0.07, 0.1, "desk"],
    [0.2, 0.28, -0.1, -0.35, "chair"],
    [-0.02, 0.48, 0.05, 0.55, "desk"],
    [-0.27, 0.67, -0.08, -0.65, "chair"],
    [0.15, 0.86, 0.08, 0.42, "desk"],
    [0.0, 1.05, -0.02, -0.25, "chair"],
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh receiveShadow position={[0, 0.025, 0]}>
        <cylinderGeometry args={[0.55, 0.62, 0.05, 18]} />
        <meshStandardMaterial color="#e7d1a1" roughness={0.86} />
      </mesh>
      {layers.map(([x, y, z, r, kind], index) => (
        <group key={index} position={[x as number, y as number, z as number]} rotation={[0, r as number, index % 2 ? 0.12 : -0.08]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={kind === "desk" ? [0.42, 0.045, 0.28] : [0.3, 0.045, 0.28]} />
            <meshStandardMaterial color={kind === "desk" ? "#c08457" : "#b45309"} roughness={0.78} />
          </mesh>
          {[-0.14, 0.14].map((lx) =>
            [-0.09, 0.09].map((lz) => (
              <mesh key={`${lx}:${lz}`} position={[lx, -0.16, lz]}>
                <boxGeometry args={[0.025, 0.32, 0.025]} />
                <meshStandardMaterial color="#475569" roughness={0.55} metalness={0.25} />
              </mesh>
            ))
          )}
          {kind === "chair" ? (
            <>
              <mesh position={[0.04, 0.18, -0.13]} rotation={[-0.28, 0, 0]}>
                <boxGeometry args={[0.28, 0.24, 0.04]} />
                <meshStandardMaterial color="#92400e" roughness={0.76} />
              </mesh>
              <mesh position={[0.04, 0.03, 0.14]}>
                <boxGeometry args={[0.22, 0.035, 0.05]} />
                <meshStandardMaterial color="#78350f" roughness={0.78} />
              </mesh>
            </>
          ) : (
            <>
              <mesh position={[0, 0.035, 0.0]}>
                <boxGeometry args={[0.34, 0.012, 0.2]} />
                <meshStandardMaterial color="#d6a06f" roughness={0.7} />
              </mesh>
              <mesh position={[-0.14, 0.07, 0.12]} rotation={[0, 0, 0.2]}>
                <boxGeometry args={[0.16, 0.018, 0.1]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.62} />
              </mesh>
            </>
          )}
        </group>
      ))}
      <mesh position={[0.3, 0.52, 0.22]} rotation={[0.1, 0.38, -0.25]}>
        <boxGeometry args={[0.16, 0.026, 0.24]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.7} />
      </mesh>
      <mesh position={[-0.35, 0.9, 0.18]} rotation={[0.2, -0.5, 0.35]}>
        <boxGeometry args={[0.18, 0.03, 0.2]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.6} />
      </mesh>
    </group>
  );
}

function Croissant({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, -0.35]}>
        <torusGeometry args={[0.22, 0.065, 12, 28, Math.PI * 1.45]} />
        <meshStandardMaterial color="#d79538" roughness={0.66} />
      </mesh>
      {[-0.24, 0.24].map((x) => (
        <mesh key={`tip-${x}`} castShadow position={[x, 0.08, 0.08]} rotation={[0, 0, x > 0 ? -0.7 : 0.7]}>
          <coneGeometry args={[0.075, 0.17, 10]} />
          <meshStandardMaterial color="#c47a25" roughness={0.7} />
        </mesh>
      ))}
      {[-0.18, -0.06, 0.06, 0.18].map((x) => (
        <mesh key={x} position={[x, 0.145, 0.03]} rotation={[0.2, 0, 0]}>
          <boxGeometry args={[0.025, 0.035, 0.12]} />
          <meshStandardMaterial color="#b86f24" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0.05, 0.165, -0.02]} rotation={[0.25, 0, 0.25]}>
        <boxGeometry args={[0.2, 0.018, 0.05]} />
        <meshStandardMaterial color="#f5c16c" roughness={0.38} transparent opacity={0.62} />
      </mesh>
    </group>
  );
}

function WeddingRing({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh receiveShadow position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 0.05, 24]} />
        <meshStandardMaterial color="#581c87" roughness={0.78} />
      </mesh>
      <mesh castShadow position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.18, 0.035, 14, 30]} />
        <meshStandardMaterial color="#facc15" metalness={0.85} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.082, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.11, 0.008, 8, 24]} />
        <meshStandardMaterial color="#fff7ad" metalness={0.7} roughness={0.2} />
      </mesh>
      <mesh position={[0.0, 0.15, -0.18]}>
        <octahedronGeometry args={[0.055, 0]} />
        <meshStandardMaterial color="#e0f2fe" metalness={0.15} roughness={0.12} transparent opacity={0.86} />
      </mesh>
      {[-0.08, 0.08].map((x) => (
        <mesh key={x} position={[x, 0.13, -0.16]} rotation={[0, 0, x > 0 ? -0.25 : 0.25]}>
          <boxGeometry args={[0.08, 0.02, 0.028]} />
          <meshStandardMaterial color="#fde68a" metalness={0.78} roughness={0.18} />
        </mesh>
      ))}
    </group>
  );
}

function Ukulele({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, -0.35]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[-0.1, 0.08, 0]} scale={[0.8, 0.24, 1.08]}>
        <sphereGeometry args={[0.18, 14, 8]} />
        <meshStandardMaterial color="#a16207" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0.1, 0.08, 0]} scale={[0.62, 0.2, 0.82]}>
        <sphereGeometry args={[0.15, 14, 8]} />
        <meshStandardMaterial color="#b7791f" roughness={0.7} />
      </mesh>
      <mesh position={[-0.04, 0.105, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.012, 16]} />
        <meshStandardMaterial color="#2f1d13" roughness={0.75} />
      </mesh>
      <mesh castShadow position={[0.43, 0.08, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.07, 0.54, 0.05]} />
        <meshStandardMaterial color="#6b3f1d" roughness={0.74} />
      </mesh>
      {[-0.12, -0.02, 0.08, 0.18].map((x) => (
        <mesh key={`fret-${x}`} position={[0.36 + x, 0.116, 0]} rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.008, 0.075, 0.058]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.38} metalness={0.45} />
        </mesh>
      ))}
      <mesh castShadow position={[0.74, 0.08, 0]}>
        <boxGeometry args={[0.14, 0.08, 0.12]} />
        <meshStandardMaterial color="#4a2b16" roughness={0.74} />
      </mesh>
      {[[-0.03, -0.08], [0.03, -0.08], [-0.03, 0.08], [0.03, 0.08]].map(([x, z]) => (
        <mesh key={`peg-${x}-${z}`} position={[0.78, 0.08 + x, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.07, 8]} />
          <meshStandardMaterial color="#e5e7eb" metalness={0.42} roughness={0.36} />
        </mesh>
      ))}
      {[-0.045, -0.015, 0.015, 0.045].map((z) => (
        <mesh key={z} position={[0.38, 0.145, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.004, 0.004, 0.74, 5]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.35} metalness={0.35} />
        </mesh>
      ))}
      <mesh position={[-0.19, 0.13, 0]}>
        <boxGeometry args={[0.16, 0.018, 0.12]} />
        <meshStandardMaterial color="#4a2b16" roughness={0.76} />
      </mesh>
    </group>
  );
}

function SportsBall({ position, rotationY = 0, scale = 1, sport }: AssetProps & { sport: "rugby" | "basketball" | "football" }) {
  if (sport === "rugby") {
    return (
      <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
        <mesh castShadow position={[0, 0.16, 0]} scale={[1.55, 0.78, 0.92]}>
          <sphereGeometry args={[0.18, 18, 10]} />
          <meshStandardMaterial color="#7c2d12" roughness={0.64} />
        </mesh>
        <mesh position={[0, 0.25, 0.01]} rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.018, 0.26, 0.018]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.5} />
        </mesh>
        {[-0.06, 0, 0.06].map((x) => (
          <mesh key={x} position={[x, 0.245, 0.035]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.012, 0.075, 0.015]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.52} />
          </mesh>
        ))}
      </group>
    );
  }

  if (sport === "basketball") {
    return (
      <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
        <mesh castShadow position={[0, 0.18, 0]}>
          <sphereGeometry args={[0.2, 22, 14]} />
          <meshStandardMaterial color="#f97316" roughness={0.62} />
        </mesh>
        {[0, Math.PI / 2].map((r) => (
          <mesh key={r} position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, r]}>
            <torusGeometry args={[0.202, 0.006, 6, 28]} />
            <meshStandardMaterial color="#111827" roughness={0.72} />
          </mesh>
        ))}
        {[-0.1, 0.1].map((x) => (
          <mesh key={x} position={[x, 0.18, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.17, 0.005, 6, 24, Math.PI]} />
            <meshStandardMaterial color="#111827" roughness={0.72} />
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.18, 0]}>
        <sphereGeometry args={[0.2, 22, 14]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.58} />
      </mesh>
      <mesh position={[0, 0.181, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.16, 0.006, 6, 28]} />
        <meshStandardMaterial color="#111827" roughness={0.75} />
      </mesh>
      {[0, 1, 2, 3, 4].map((index) => {
        const angle = (index / 5) * Math.PI * 2;
        return (
          <mesh key={index} position={[Math.cos(angle) * 0.13, 0.22, Math.sin(angle) * 0.13]} rotation={[-Math.PI / 2, 0, -angle]}>
            <circleGeometry args={[0.045, 5]} />
            <meshStandardMaterial color="#111827" roughness={0.75} side={DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}

function FoodCan({ position, rotationY = 0, scale = 1, label, color, stripe }: AssetProps & { label: string; color: string; stripe: string }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.24, 18]} />
        <meshStandardMaterial color={color} metalness={0.28} roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.12, 0.162]}>
        <MiniLabel text={label} background={stripe} color="#ffffff" width={0.28} height={0.13} />
      </mesh>
      <mesh position={[0, 0.185, 0.164]}>
        <boxGeometry args={[0.28, 0.018, 0.012]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.58} />
      </mesh>
      {[0.005, 0.235].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <cylinderGeometry args={[0.166, 0.166, 0.012, 18]} />
          <meshStandardMaterial color="#d1d5db" metalness={0.55} roughness={0.32} />
        </mesh>
      ))}
      <mesh position={[0.035, 0.246, 0.02]} rotation={[Math.PI / 2, 0, 0.35]}>
        <torusGeometry args={[0.045, 0.007, 6, 14, Math.PI * 1.5]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.55} roughness={0.28} />
      </mesh>
    </group>
  );
}

function Sunscreen({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0.2]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.18, 0]}>
        <boxGeometry args={[0.24, 0.36, 0.12]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.18, 0.065]}>
        <MiniLabel text="SPF" background="#f59e0b" color="#111827" width={0.18} height={0.16} />
      </mesh>
      <mesh position={[0, 0.275, 0.068]} rotation={[0, 0, Math.PI / 4]}>
        <circleGeometry args={[0.045, 12]} />
        <meshStandardMaterial color="#fde047" emissive="#facc15" emissiveIntensity={0.25} roughness={0.46} side={DoubleSide} />
      </mesh>
      {[-0.06, 0.06].map((x) => (
        <mesh key={x} position={[x, 0.08, 0.066]}>
          <boxGeometry args={[0.045, 0.05, 0.012]} />
          <meshStandardMaterial color="#38bdf8" roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.07, 14]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.435, 0]}>
        <cylinderGeometry args={[0.055, 0.065, 0.04, 14]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.4} />
      </mesh>
    </group>
  );
}

function VodkaBottle({ position, rotationY = 0, scale = 1 }: AssetProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.115, 0.105, 0.5, 18]} />
        <meshStandardMaterial color="#dbeafe" roughness={0.08} metalness={0.04} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.095, 0.095, 0.22, 18]} />
        <meshStandardMaterial color="#bfdbfe" roughness={0.18} transparent opacity={0.42} />
      </mesh>
      <mesh castShadow position={[0, 0.54, 0]}>
        <cylinderGeometry args={[0.045, 0.06, 0.22, 14]} />
        <meshStandardMaterial color="#dbeafe" roughness={0.08} transparent opacity={0.58} />
      </mesh>
      <mesh position={[0, 0.28, 0.112]}>
        <MiniLabel text="VODKA" background="#e5e7eb" color="#111827" width={0.18} height={0.18} />
      </mesh>
      <mesh position={[0, 0.4, 0.067]}>
        <MiniLabel text="ICE" background="#1d4ed8" color="#f8fafc" width={0.12} height={0.08} />
      </mesh>
      <mesh position={[0, 0.68, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.05, 14]} />
        <meshStandardMaterial color="#1d4ed8" roughness={0.38} />
      </mesh>
      <mesh position={[0.06, 0.38, 0.05]} rotation={[0, 0, 0.1]}>
        <boxGeometry args={[0.018, 0.28, 0.012]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.18} transparent opacity={0.55} />
      </mesh>
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
