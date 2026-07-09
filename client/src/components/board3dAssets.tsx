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
    case "classroom-giant-log":
      return <ClassroomGiantLog position={position} rotationY={rotationY} scale={scale} />;
    case "split-tree-trunk":
      return <SplitOakStump position={position} rotationY={rotationY} scale={scale} />;
    case "bleach-sound-bomb":
      return <ChlorineFizzBottle position={position} rotationY={rotationY} scale={scale} />;
    case "firecracker-box":
      return <FirecrackerCrate position={position} rotationY={rotationY} scale={scale} />;
    case "upd-noose-chair":
      return <UpdNooseChair position={position} rotationY={rotationY} scale={scale} />;
    case "vinchuca-jar":
      return <VinchucaJar position={position} rotationY={rotationY} scale={scale} />;
    case "broken-window-frame":
      return <BrokenWindowFrame position={position} rotationY={rotationY} scale={scale} />;
    case "school-locker-hiding":
      return <HidingLockerWilly position={position} rotationY={rotationY} scale={scale} />;
    case "locker-row":
      return <HidingLockerBank position={position} rotationY={rotationY} scale={scale} />;
    case "steamy-taxi":
      return <SteamyPortenoTaxi position={position} rotationY={rotationY} scale={scale} />;
    case "just-dance-kinect":
      return <JustDanceKinectPad position={position} rotationY={rotationY} scale={scale} />;
    case "school-desk-pupitre":
      return <SchoolDeskPupitre position={position} rotationY={rotationY} scale={scale} />;
    case "city-barricade-peed":
      return <PeedYellowBarricade position={position} rotationY={rotationY} scale={scale} />;
    case "crumpled-exam-ausente":
      return <CrumpledBioExamAusente position={position} rotationY={rotationY} scale={scale} />;
    case "martina-impact-ball":
      return <PelotazoImpactBall position={position} rotationY={rotationY} scale={scale} />;
    case "teacher-figures":
      return <TeacherFiguresTrio position={position} rotationY={rotationY} scale={scale} />;
    case "giant-groin-cup":
      return <GiantGroinCup position={position} rotationY={rotationY} scale={scale} />;
    case "sleeping-bag":
      return <SleepingBag position={position} rotationY={rotationY} scale={scale} />;
    case "tongue-toy":
      return <CrazyTongueToy position={position} rotationY={rotationY} scale={scale} />;
    case "jony-duck-window":
      return <JonyDuckWindow position={position} rotationY={rotationY} scale={scale} />;
    case "flying-chair":
      return <FlyingChair position={position} rotationY={rotationY} scale={scale} />;
    case "kiosco-24hs":
      return <Kiosco24 position={position} rotationY={rotationY} scale={scale} label={artifact.label} />;
    case "kiosk-bag-nofui":
      return <KioskBagNoFuiYo position={position} rotationY={rotationY} scale={scale} />;
    case "tiny-trophy":
      return <TinyTrophyChiquito position={position} rotationY={rotationY} scale={scale} />;
    case "silly-pool-float":
      return <SillyFlamingoFloat position={position} rotationY={rotationY} scale={scale} />;
    case "broken-umbrella":
      return <BrokenUmbrellaProp position={position} rotationY={rotationY} scale={scale} />;
    case "megaphone":
      return <MegaphoneProp position={position} rotationY={rotationY} scale={scale} />;
    case "stopwatch":
      return <StopwatchProp position={position} rotationY={rotationY} scale={scale} />;
    case "lucky-sock":
      return <LuckySock position={position} rotationY={rotationY} scale={scale} />;
    case "cursed-calculator":
      return <CursedCalculator position={position} rotationY={rotationY} scale={scale} />;
    case "giant-pencil":
      return <GiantPencil position={position} rotationY={rotationY} scale={scale} />;
    case "sticker-suitcase":
      return <StickerSuitcase position={position} rotationY={rotationY} scale={scale} />;
    case "banana-peel-trap":
      return <BananaPeelTrap position={position} rotationY={rotationY} scale={scale} />;
    case "world-cup-trophy":
      return <WorldCupTrophy position={position} rotationY={rotationY} scale={scale} />;
    case "rain-tent":
      return <RainTent position={position} rotationY={rotationY} scale={scale} />;
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
  // Vaso improvisado clásico: botella de Coca-Cola de plástico cortada al medio,
  // llena de fernet con coca (líquido casi negro) y una corona de espuma beige.
  const plastic = "#cfe8dc";
  const liquid = "#160d09";
  const foam = "#e9d9b8";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* base petaloide (5 lóbulos) de la botella */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={`lobe-${i}`} castShadow position={[Math.cos(a) * 0.09, 0.05, Math.sin(a) * 0.09]}>
            <sphereGeometry args={[0.06, 10, 8]} />
            <meshStandardMaterial color={plastic} roughness={0.22} metalness={0.05} transparent opacity={0.5} />
          </mesh>
        );
      })}
      {/* cuerpo cortado (cilindro transparente, abierto arriba) */}
      <mesh castShadow position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.155, 0.135, 0.34, 24, 1, true]} />
        <meshStandardMaterial color={plastic} roughness={0.16} metalness={0.06} transparent opacity={0.4} side={DoubleSide} />
      </mesh>
      {/* borde del corte */}
      <mesh position={[0, 0.41, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.153, 0.007, 8, 24]} />
        <meshStandardMaterial color={plastic} roughness={0.2} transparent opacity={0.6} />
      </mesh>
      {/* líquido fernet-cola */}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.148, 0.13, 0.3, 24]} />
        <meshStandardMaterial color={liquid} roughness={0.28} metalness={0.05} transparent opacity={0.94} />
      </mesh>
      {/* corona de espuma */}
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.152, 0.148, 0.05, 24]} />
        <meshStandardMaterial color={foam} roughness={0.85} />
      </mesh>
      {[[-0.06, 0.05], [0.05, -0.04], [0.02, 0.07], [-0.04, -0.06], [0.07, 0.03]].map(([x, z], i) => (
        <mesh key={`bub-${i}`} position={[x, 0.46, z]}>
          <sphereGeometry args={[0.028, 8, 6]} />
          <meshStandardMaterial color="#f3ead2" roughness={0.8} />
        </mesh>
      ))}
      {/* etiqueta Coca-Cola */}
      <mesh position={[0, 0.2, 0.156]}>
        <MiniLabel text="COCA-COLA" background="#e01c22" color="#ffffff" width={0.2} height={0.07} />
      </mesh>
    </group>
  );
}

function VomitingPerson({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const skin = "#f2c197";
  const shirt = "#7c3aed";
  const pants = "#1f2937";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* Piernas paradas, apenas flexionadas, con zapatillas apoyadas en el piso */}
      {[-0.1, 0.1].map((x) => (
        <group key={`leg-${x}`}>
          <mesh castShadow position={[x, 0.23, -0.05]} rotation={[0.16, 0, 0]}>
            <cylinderGeometry args={[0.062, 0.052, 0.46, 10]} />
            <meshStandardMaterial color={pants} roughness={0.74} />
          </mesh>
          <mesh castShadow position={[x, 0.035, 0.04]}>
            <boxGeometry args={[0.11, 0.06, 0.22]} />
            <meshStandardMaterial color="#111827" roughness={0.7} />
          </mesh>
        </group>
      ))}
      {/* Cadera */}
      <mesh castShadow position={[0, 0.45, -0.04]}>
        <boxGeometry args={[0.28, 0.15, 0.2]} />
        <meshStandardMaterial color={pants} roughness={0.74} />
      </mesh>
      {/* Torso redondeado inclinado hacia adelante (arqueado vomitando) */}
      <mesh castShadow position={[0, 0.54, 0.07]} rotation={[1.0, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.165, 0.4, 14]} />
        <meshStandardMaterial color={shirt} roughness={0.66} />
      </mesh>
      {/* Hombros redondeados al frente */}
      <mesh castShadow position={[0, 0.62, 0.23]}>
        <sphereGeometry args={[0.15, 16, 12]} />
        <meshStandardMaterial color={shirt} roughness={0.66} />
      </mesh>
      {/* Cuello */}
      <mesh position={[0, 0.6, 0.31]} rotation={[0.9, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.055, 0.1, 10]} />
        <meshStandardMaterial color={skin} roughness={0.56} />
      </mesh>
      {/* Cabeza gacha, mirando al piso */}
      <mesh castShadow position={[0, 0.53, 0.37]}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color={skin} roughness={0.55} />
      </mesh>
      {/* Pelo (media esfera arriba y atrás de la cabeza) */}
      <mesh position={[0, 0.6, 0.32]} rotation={[-0.7, 0, 0]}>
        <sphereGeometry args={[0.126, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
        <meshStandardMaterial color="#2f1d13" roughness={0.78} />
      </mesh>
      {/* Brazos: de los hombros bajando a las rodillas (manos apoyadas) */}
      {[-0.15, 0.15].map((x) => (
        <mesh key={`arm-${x}`} castShadow position={[x, 0.45, 0.16]} rotation={[0.42, 0, 0]}>
          <cylinderGeometry args={[0.033, 0.03, 0.44, 8]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
      ))}
      {/* Chorro de vómito desde la boca hacia el charco */}
      <mesh position={[0, 0.3, 0.5]} rotation={[0.62, 0, 0]}>
        <cylinderGeometry args={[0.028, 0.06, 0.42, 9]} />
        <meshStandardMaterial color="#84cc16" roughness={0.45} transparent opacity={0.85} />
      </mesh>
      {/* Charco */}
      <mesh position={[0, 0.02, 0.66]} scale={[1.7, 0.18, 1.05]}>
        <sphereGeometry args={[0.16, 16, 10]} />
        <meshStandardMaterial color="#65a30d" roughness={0.8} transparent opacity={0.85} />
      </mesh>
      {/* Grumos flotando en el charco */}
      {[[-0.07, 0.6], [0.06, 0.72], [0.12, 0.58]].map(([x, z], index) => (
        <mesh key={`chunk-${index}`} position={[x, 0.05, z]} scale={[1, 0.4, 0.85]}>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshStandardMaterial color={index % 2 ? "#a3e635" : "#bef264"} roughness={0.72} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function BlueMarketBag({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Bolso IKEA Frakta con cierre: cuerpo azul ancho, "IKEA" amarillo al frente,
  // asas azules y un cierre amarillo cruzando la tapa.
  const blue = "#1596d8";
  const blueDark = "#0a6aa3";
  const yellow = "#ffd400";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* cuerpo ancho y bajo */}
      <mesh castShadow receiveShadow position={[0, 0.24, 0]}>
        <boxGeometry args={[0.86, 0.44, 0.42]} />
        <meshStandardMaterial color={blue} roughness={0.72} />
      </mesh>
      {/* costuras verticales más oscuras */}
      {[-0.43, 0.43].map((x) => (
        <mesh key={`seam-${x}`} position={[x, 0.24, 0]}>
          <boxGeometry args={[0.022, 0.44, 0.42]} />
          <meshStandardMaterial color={blueDark} roughness={0.78} />
        </mesh>
      ))}
      {/* tapa abombada */}
      <mesh castShadow position={[0, 0.47, 0]}>
        <boxGeometry args={[0.84, 0.06, 0.4]} />
        <meshStandardMaterial color={shade(blue, 1.05)} roughness={0.7} />
      </mesh>
      {/* cierre amarillo a lo largo + tirador */}
      <mesh position={[0, 0.505, 0]}>
        <boxGeometry args={[0.82, 0.02, 0.045]} />
        <meshStandardMaterial color={yellow} roughness={0.45} metalness={0.25} />
      </mesh>
      <mesh position={[0.28, 0.505, 0]}>
        <boxGeometry args={[0.05, 0.018, 0.07]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* dos asas azules arqueadas con "IKEA" */}
      {[-0.24, 0.24].map((x) => (
        <group key={`handle-${x}`}>
          <mesh castShadow position={[x, 0.6, 0.13]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.13, 0.024, 8, 20, Math.PI]} />
            <meshStandardMaterial color={blue} roughness={0.68} />
          </mesh>
          <mesh position={[x, 0.58, 0.156]} rotation={[0.2, 0, 0]}>
            <MiniLabel text="IKEA" background={blue} color={yellow} width={0.12} height={0.045} />
          </mesh>
        </group>
      ))}
      {/* logo IKEA grande al frente */}
      <mesh position={[0, 0.26, 0.212]}>
        <MiniLabel text="IKEA" background={blue} color={yellow} width={0.34} height={0.16} />
      </mesh>
    </group>
  );
}

function HockeyStick({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Palo de hockey de campo (estilo STX): mango recto negro con banda menta y
  // el gancho "J" curvado en la punta. De arma improvisada: vidrios clavados.
  const shaft = "#1c1c22";
  const accent = "#3fd0b8";
  const glass = "#a5e8f7";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* mango recto apoyado en el piso */}
      <mesh castShadow position={[-0.12, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.028, 0.032, 0.86, 12]} />
        <meshStandardMaterial color={shaft} roughness={0.55} metalness={0.06} />
      </mesh>
      {/* banda menta en la transición al gancho */}
      <mesh position={[0.27, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.034, 0.034, 0.1, 12]} />
        <meshStandardMaterial color={accent} roughness={0.4} />
      </mesh>
      {/* gancho J curvando hacia arriba en la punta */}
      <mesh castShadow position={[0.33, 0.11, 0]} rotation={[Math.PI / 2, 0, -0.25]}>
        <torusGeometry args={[0.1, 0.034, 10, 16, Math.PI / 1.5]} />
        <meshStandardMaterial color={accent} roughness={0.45} />
      </mesh>
      {/* puntera del gancho */}
      <mesh castShadow position={[0.28, 0.21, 0]}>
        <sphereGeometry args={[0.042, 10, 8]} />
        <meshStandardMaterial color={accent} roughness={0.45} />
      </mesh>
      {/* grip de cinta en el otro extremo */}
      {[-0.42, -0.35, -0.28].map((x) => (
        <mesh key={`grip-${x}`} position={[x, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.035, 0.035, 0.04, 12]} />
          <meshStandardMaterial color="#0a0a0d" roughness={0.72} />
        </mesh>
      ))}
      {/* vidrios clavados a lo largo del mango */}
      {[-0.3, -0.15, 0.0, 0.13].map((x, i) => (
        <mesh key={`glass-${i}`} position={[x, 0.09, 0]} rotation={[0, i * 0.8, 0.18 * (i % 2 ? 1 : -1)]}>
          <coneGeometry args={[0.02, 0.11, 4]} />
          <meshStandardMaterial color={glass} roughness={0.08} metalness={0.1} transparent opacity={0.72} />
        </mesh>
      ))}
    </group>
  );
}

function CondomBolas({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Boleadoras míticas de Beltrán (condones panzones llenos de caca) siendo
  // revoleadas por encima de la cabeza por un gaucho, tipo vaquero por enlazar.
  const latex = "#ded0b4";
  const poop = "#5a3418";
  const skin = "#f2c197";
  const shirt = "#2563eb";
  const pants = "#374151";
  const cord = "#e7d8b4";
  const hand: [number, number] = [0.3, 1.12];
  const center: [number, number] = [0.0, 1.5];
  const balls: [number, number][] = [
    [-0.36, 1.62],
    [0.34, 1.4],
  ];
  const link = (a: [number, number], b: [number, number], key: string, r = 0.011) => (
    <mesh key={key} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]} rotation={[0, 0, Math.atan2(a[0] - b[0], b[1] - a[1])]}>
      <cylinderGeometry args={[r, r, Math.hypot(a[0] - b[0], a[1] - b[1]), 6]} />
      <meshStandardMaterial color={cord} roughness={0.72} />
    </mesh>
  );
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* ── Gaucho ── */}
      {[-0.1, 0.1].map((x) => (
        <mesh key={`leg-${x}`} castShadow position={[x, 0.22, 0]}>
          <cylinderGeometry args={[0.055, 0.05, 0.44, 10]} />
          <meshStandardMaterial color={pants} roughness={0.74} />
        </mesh>
      ))}
      {[-0.1, 0.1].map((x) => (
        <mesh key={`foot-${x}`} castShadow position={[x, 0.03, 0.05]}>
          <boxGeometry args={[0.1, 0.06, 0.18]} />
          <meshStandardMaterial color="#1f2937" roughness={0.7} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.62, 0]}>
        <cylinderGeometry args={[0.13, 0.16, 0.4, 14]} />
        <meshStandardMaterial color={shirt} roughness={0.66} />
      </mesh>
      <mesh castShadow position={[0, 0.92, 0]}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color={skin} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.97, -0.01]}>
        <sphereGeometry args={[0.126, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
        <meshStandardMaterial color="#2f1d13" roughness={0.8} />
      </mesh>
      {/* brazo izquierdo al costado */}
      <mesh castShadow position={[-0.19, 0.6, 0]} rotation={[0, 0, 0.42]}>
        <cylinderGeometry args={[0.035, 0.03, 0.36, 8]} />
        <meshStandardMaterial color={shirt} roughness={0.66} />
      </mesh>
      {/* brazo derecho LEVANTADO */}
      <mesh castShadow position={[0.19, 0.9, 0]} rotation={[0, 0, -0.95]}>
        <cylinderGeometry args={[0.035, 0.03, 0.46, 8]} />
        <meshStandardMaterial color={shirt} roughness={0.66} />
      </mesh>
      <mesh position={[hand[0], hand[1], 0]}>
        <sphereGeometry args={[0.04, 10, 8]} />
        <meshStandardMaterial color={skin} roughness={0.55} />
      </mesh>
      {/* ── Boleadoras revoleando arriba ── */}
      {link(hand, center, "cord-hand")}
      {balls.map((b, i) => link(center, b, `cord-${i}`, 0.013))}
      <mesh position={[center[0], center[1], 0]}>
        <sphereGeometry args={[0.04, 10, 8]} />
        <meshStandardMaterial color="#c9b78e" roughness={0.7} />
      </mesh>
      {balls.map((b, i) => (
        <group key={`ball-${i}`} position={[b[0], b[1], 0]}>
          <mesh castShadow scale={[0.9, 1, 0.9]}>
            <sphereGeometry args={[0.12, 16, 12]} />
            <meshStandardMaterial color={latex} roughness={0.24} metalness={0.03} transparent opacity={0.72} />
          </mesh>
          <mesh scale={[0.6, 0.7, 0.6]}>
            <sphereGeometry args={[0.12, 12, 8]} />
            <meshStandardMaterial color={poop} roughness={0.9} />
          </mesh>
          {/* nudo del condón */}
          <mesh position={[0, 0.12, 0]}>
            <coneGeometry args={[0.03, 0.06, 8]} />
            <meshStandardMaterial color={latex} roughness={0.3} transparent opacity={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function makeBorderlandsCover(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#f7a41a");
  g.addColorStop(1, "#df5116");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 360, 512);
  ctx.textAlign = "center";
  // banda superior verde Xbox 360
  ctx.fillStyle = "#107C10";
  ctx.fillRect(0, 0, 360, 52);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 26px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("XBOX 360", 180, 36);
  // careta del psycho (placa gris con correas, un ojo y dientes)
  ctx.fillStyle = "#dfe3e8";
  ctx.fillRect(122, 150, 116, 148);
  ctx.beginPath();
  ctx.arc(180, 298, 58, 0, Math.PI);
  ctx.fill();
  ctx.strokeStyle = "#3a2a1a";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(122, 185);
  ctx.lineTo(56, 165);
  ctx.moveTo(238, 185);
  ctx.lineTo(304, 165);
  ctx.stroke();
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(180, 210, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f7a41a";
  ctx.beginPath();
  ctx.arc(180, 210, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.fillRect(150, 286, 60, 18);
  // título
  ctx.fillStyle = "#111827";
  ctx.font = "900 32px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("BORDERLANDS", 180, 398);
  ctx.font = "900 96px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("2", 180, 486);
  return finishTexture(canvas);
}

function BotherlandsDisc({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const texture = useMemo(makeBorderlandsCover, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const xboxGreen = "#107C10";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* caja del juego de Xbox 360 parada, con leve inclinación */}
      <group position={[0, 0.36, 0]} rotation={[0.04, 0, 0.03]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.5, 0.72, 0.06]} />
          <meshStandardMaterial color={xboxGreen} roughness={0.5} />
        </mesh>
        {/* portada al frente */}
        <mesh position={[0, 0, 0.031]}>
          <planeGeometry args={[0.485, 0.7]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
        {/* lomo verde */}
        <mesh position={[-0.251, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <MiniLabel text="BORDERLANDS 2" background={xboxGreen} color="#ffffff" width={0.66} height={0.05} />
        </mesh>
      </group>
    </group>
  );
}

function HoodieLog({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Un tronco del tamaño de una persona, apoyado en el piso y recostado sobre
  // una silla, con el buzo de egresados bordó y la capucha puesta: el tronco es
  // el protagonista (se ve mucho abajo y como "cabeza" en la capucha), bien
  // roto y de madera viva para que se lea de lejos. "Un compañero más".
  const bark = "#a9662a";
  const woodBright = "#e6a95a";
  const woodDeep = "#8a4a1c";
  const crack = "#2c1809";
  const chairWood = "#b07a43";
  const metal = "#4b5563";
  const burgundy = "#6d1a2e";
  const burgundyDark = "#551122";
  const cord = "#f3e3c0";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* ── Silla de la clase (el tronco se recuesta contra ella) ── */}
      {[[-0.23, 0.06], [0.23, 0.06], [-0.23, -0.3], [0.23, -0.3]].map(([x, z]) => (
        <mesh key={`leg-${x}-${z}`} castShadow position={[x, 0.22, z]}>
          <cylinderGeometry args={[0.022, 0.022, 0.44, 8]} />
          <meshStandardMaterial color={metal} metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      <mesh castShadow receiveShadow position={[0, 0.46, -0.12]}>
        <boxGeometry args={[0.56, 0.07, 0.48]} />
        <meshStandardMaterial color={chairWood} roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 0.68, -0.34]}>
        <boxGeometry args={[0.54, 0.36, 0.06]} />
        <meshStandardMaterial color={chairWood} roughness={0.72} />
      </mesh>

      {/* ── Tronco: base en el piso (adelante), recostado hacia la silla ── */}
      <group position={[0, 0, 0.34]} rotation={[-0.42, 0, 0]}>
        {/* cuerpo del tronco */}
        <mesh castShadow receiveShadow position={[0, 0.58, 0]}>
          <cylinderGeometry args={[0.19, 0.24, 1.16, 16]} />
          <meshStandardMaterial color={bark} roughness={0.92} flatShading />
        </mesh>
        {/* base rota apoyada en el piso (madera clara del corte) */}
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.235, 0.245, 0.07, 16]} />
          <meshStandardMaterial color={woodBright} roughness={0.85} flatShading />
        </mesh>
        <mesh position={[0, 0.055, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.02, 14]} />
          <meshStandardMaterial color={woodDeep} roughness={0.88} />
        </mesh>
        {/* muchas grietas/roturas oscuras repartidas por el tronco */}
        {[
          [0.0, 0.48, 0.4, 0.05],
          [0.26, 0.34, 0.3, 0.3],
          [-0.2, 0.66, 0.34, -0.25],
          [0.12, 0.2, 0.26, 0.15],
          [-0.08, 0.82, 0.24, 0.2],
          [0.34, 0.56, 0.24, -0.15],
          [-0.32, 0.28, 0.2, 0.1],
        ].map(([ang, y, len, tilt], i) => (
          <mesh
            key={`crack-${i}`}
            position={[Math.sin(ang * Math.PI) * 0.21, y, Math.cos(ang * Math.PI) * 0.21]}
            rotation={[tilt, ang * Math.PI, 0.08]}
          >
            <boxGeometry args={[0.024, len, 0.03]} />
            <meshStandardMaterial color={crack} roughness={0.95} />
          </mesh>
        ))}
        {/* nudos */}
        {[[0.16, 0.44], [-0.28, 0.72], [0.42, 0.3]].map(([ang, y], i) => (
          <mesh
            key={`knot-${i}`}
            position={[Math.sin(ang * Math.PI) * 0.2, y, Math.cos(ang * Math.PI) * 0.2]}
            rotation={[0, ang * Math.PI, 0]}
            scale={[1, 0.7, 0.45]}
          >
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color={woodDeep} roughness={0.9} />
          </mesh>
        ))}
        {/* astillas quebradas en la punta (tronco roto) */}
        {[[-0.06, 0.25], [0.06, -0.2], [0.0, 0.05]].map(([x, tilt], i) => (
          <mesh key={`splinter-${i}`} castShadow position={[x, 1.2 + i * 0.02, 0.03]} rotation={[tilt, 0, x * 2.2]}>
            <coneGeometry args={[0.04, 0.17, 6]} />
            <meshStandardMaterial color={woodBright} roughness={0.85} flatShading />
          </mesh>
        ))}

        {/* ── Buzo bordó: sólo el tramo del medio (se ve tronco arriba y abajo) ── */}
        <mesh castShadow position={[0, 0.63, 0]}>
          <cylinderGeometry args={[0.235, 0.25, 0.42, 18]} />
          <meshStandardMaterial color={burgundy} roughness={0.72} />
        </mesh>
        <mesh position={[0, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.248, 0.028, 8, 22]} />
          <meshStandardMaterial color={burgundyDark} roughness={0.78} />
        </mesh>
        <mesh position={[0, 0.54, 0.248]}>
          <boxGeometry args={[0.26, 0.12, 0.04]} />
          <meshStandardMaterial color={burgundyDark} roughness={0.76} />
        </mesh>
        <group position={[0, 0.7, 0.258]}>
          <MiniLabel text="EGRESADOS" background={burgundy} color="#f3d9a0" width={0.28} height={0.065} />
        </group>
        {[-1, 1].map((s) => (
          <group key={`sleeve-${s}`}>
            <mesh castShadow position={[s * 0.27, 0.58, 0.02]} rotation={[0, 0, s * 0.16]}>
              <cylinderGeometry args={[0.07, 0.062, 0.4, 10]} />
              <meshStandardMaterial color={burgundy} roughness={0.74} />
            </mesh>
            <mesh position={[s * 0.31, 0.39, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.06, 0.02, 8, 16]} />
              <meshStandardMaterial color={burgundyDark} roughness={0.78} />
            </mesh>
          </group>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={`cord-${s}`} position={[s * 0.05, 0.73, 0.24]}>
            <cylinderGeometry args={[0.008, 0.008, 0.16, 6]} />
            <meshStandardMaterial color={cord} roughness={0.6} />
          </mesh>
        ))}

        {/* ── Capucha abierta: la punta del tronco asoma grande como cabeza ── */}
        {/* cuello del tronco (bajo la capucha) */}
        <mesh castShadow position={[0, 0.98, 0]}>
          <cylinderGeometry args={[0.185, 0.195, 0.22, 16]} />
          <meshStandardMaterial color={bark} roughness={0.9} flatShading />
        </mesh>
        {/* cabeza = corte del tronco, madera clara y rota, bien visible */}
        <mesh castShadow position={[0, 1.12, 0.04]} scale={[1, 0.62, 1]}>
          <sphereGeometry args={[0.19, 16, 12]} />
          <meshStandardMaterial color={woodBright} roughness={0.82} flatShading />
        </mesh>
        {[-0.06, 0.05].map((x) => (
          <mesh key={`hcrack-${x}`} position={[x, 1.16, 0.16]} rotation={[0.35, 0, x * 3]}>
            <boxGeometry args={[0.016, 0.13, 0.02]} />
            <meshStandardMaterial color={crack} roughness={0.95} />
          </mesh>
        ))}
        {/* capucha por detrás/arriba, abierta al frente */}
        <mesh castShadow position={[0, 1.16, -0.14]} scale={[1.1, 1.1, 0.95]}>
          <sphereGeometry args={[0.24, 18, 14]} />
          <meshStandardMaterial color={burgundy} roughness={0.72} />
        </mesh>
        <mesh position={[0, 1.06, 0.07]} rotation={[-0.32, 0, 0]}>
          <torusGeometry args={[0.2, 0.05, 10, 24]} />
          <meshStandardMaterial color={burgundy} roughness={0.72} />
        </mesh>
      </group>
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
  // Medialuna dorada: media luna de segmentos redondeados, gorda en el centro
  // y afinada en las puntas, con brillo horneado.
  const golden = "#dc9a34";
  const R = 0.24;
  const arc = Math.PI * 1.2;
  const segs = 9;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {Array.from({ length: segs }).map((_, i) => {
        const t = i / (segs - 1);
        const a = -arc / 2 + t * arc;
        const fat = 0.05 + 0.1 * Math.sin(t * Math.PI);
        return (
          <mesh
            key={i}
            castShadow
            position={[Math.cos(a) * R, 0.11 + Math.sin(t * Math.PI) * 0.03, Math.sin(a) * R]}
            scale={[1.15, 0.82, 1.15]}
          >
            <sphereGeometry args={[fat, 12, 10]} />
            <meshStandardMaterial color={i % 2 ? golden : shade(golden, 1.1)} roughness={0.5} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

function WeddingRing({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Anillo de compromiso parado en su almohadón, con la piedra brillante arriba.
  const gold = "#f5c542";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* almohadón */}
      <mesh receiveShadow position={[0, 0.06, 0]} scale={[1, 0.55, 1]}>
        <sphereGeometry args={[0.22, 18, 12]} />
        <meshStandardMaterial color="#3b0764" roughness={0.86} />
      </mesh>
      {/* aro de oro parado */}
      <mesh castShadow position={[0, 0.32, 0]}>
        <torusGeometry args={[0.17, 0.03, 16, 34]} />
        <meshStandardMaterial color={gold} metalness={0.85} roughness={0.16} />
      </mesh>
      {/* engaste arriba del aro */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.045, 0.062, 0.05, 8]} />
        <meshStandardMaterial color={gold} metalness={0.85} roughness={0.18} />
      </mesh>
      {/* diamante */}
      <mesh castShadow position={[0, 0.57, 0]}>
        <octahedronGeometry args={[0.075, 0]} />
        <meshStandardMaterial color="#d8f3ff" metalness={0.2} roughness={0.05} transparent opacity={0.85} />
      </mesh>
      {/* garras del engaste */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.045, 0.53, Math.sin(a) * 0.045]} rotation={[Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]}>
            <cylinderGeometry args={[0.006, 0.006, 0.08, 6]} />
            <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} />
          </mesh>
        );
      })}
    </group>
  );
}

function Ukulele({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Ukelele apoyado de plano en el piso (sin inclinación que lo hunda).
  const body = "#b5761f";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* cuerpo (dos lóbulos, achatado) apoyado en el piso */}
      <mesh castShadow position={[-0.1, 0.055, 0]} scale={[1.08, 0.34, 0.8]}>
        <sphereGeometry args={[0.18, 16, 10]} />
        <meshStandardMaterial color={body} roughness={0.66} />
      </mesh>
      <mesh castShadow position={[0.1, 0.055, 0]} scale={[0.82, 0.3, 0.62]}>
        <sphereGeometry args={[0.15, 16, 10]} />
        <meshStandardMaterial color={shade(body, 1.06)} roughness={0.66} />
      </mesh>
      {/* boca */}
      <mesh position={[-0.04, 0.11, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.01, 16]} />
        <meshStandardMaterial color="#2f1d13" roughness={0.75} />
      </mesh>
      {/* puente */}
      <mesh position={[-0.19, 0.1, 0]}>
        <boxGeometry args={[0.05, 0.02, 0.1]} />
        <meshStandardMaterial color="#4a2b16" roughness={0.76} />
      </mesh>
      {/* mástil */}
      <mesh castShadow position={[0.44, 0.06, 0]}>
        <boxGeometry args={[0.5, 0.05, 0.07]} />
        <meshStandardMaterial color="#6b3f1d" roughness={0.74} />
      </mesh>
      {/* trastes */}
      {[0.28, 0.38, 0.48, 0.58].map((x) => (
        <mesh key={`fret-${x}`} position={[x, 0.088, 0]}>
          <boxGeometry args={[0.008, 0.006, 0.07]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.38} metalness={0.45} />
        </mesh>
      ))}
      {/* pala + clavijas */}
      <mesh castShadow position={[0.74, 0.06, 0]}>
        <boxGeometry args={[0.13, 0.05, 0.11]} />
        <meshStandardMaterial color="#4a2b16" roughness={0.74} />
      </mesh>
      {[[-0.04, -0.075], [0.04, -0.075], [-0.04, 0.075], [0.04, 0.075]].map(([x, z]) => (
        <mesh key={`peg-${x}-${z}`} position={[0.74 + x, 0.09, z]}>
          <cylinderGeometry args={[0.014, 0.014, 0.05, 8]} />
          <meshStandardMaterial color="#e5e7eb" metalness={0.42} roughness={0.36} />
        </mesh>
      ))}
      {/* cuerdas */}
      {[-0.03, -0.01, 0.01, 0.03].map((z) => (
        <mesh key={z} position={[0.3, 0.11, z]}>
          <boxGeometry args={[0.62, 0.004, 0.004]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.35} metalness={0.3} />
        </mesh>
      ))}
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
        <mesh castShadow position={[0, 0.2, 0]}>
          <sphereGeometry args={[0.2, 24, 16]} />
          <meshStandardMaterial color="#e8722a" roughness={0.62} />
        </mesh>
        {/* costura del ecuador, pegada a la pelota */}
        <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.006, 8, 40]} />
          <meshStandardMaterial color="#111827" roughness={0.7} />
        </mesh>
        {/* dos costuras verticales perpendiculares, sobre la superficie */}
        {[0, Math.PI / 2].map((r) => (
          <mesh key={r} position={[0, 0.2, 0]} rotation={[0, r, 0]}>
            <torusGeometry args={[0.2, 0.006, 8, 40]} />
            <meshStandardMaterial color="#111827" roughness={0.7} />
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.2, 24, 16]} />
        <meshStandardMaterial color="#f5f5f5" roughness={0.55} />
      </mesh>
      {/* pentágono negro arriba */}
      <mesh position={[0, 0.404, 0]} rotation={[-Math.PI / 2, Math.PI / 5, 0]}>
        <circleGeometry args={[0.058, 5]} />
        <meshStandardMaterial color="#111827" roughness={0.6} side={DoubleSide} />
      </mesh>
      {/* anillo de 5 pentágonos negros, pegados a la superficie */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.202, 0.22, Math.sin(a) * 0.202]} rotation={[0, Math.atan2(Math.cos(a), Math.sin(a)), 0]}>
            <circleGeometry args={[0.05, 5]} />
            <meshStandardMaterial color="#111827" roughness={0.6} side={DoubleSide} />
          </mesh>
        );
      })}
      {/* costuras tenues del ecuador */}
      <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.004, 6, 40]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.7} />
      </mesh>
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
function ClassroomGiantLog({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Tronco gigante caído, recostado en el piso, absurdamente fuera de lugar en
  // el aula. Corteza flat-shaded con anillos en las caras cortadas y un buzo
  // gris colgado de una punta (el chiste original del 'tronco con buzo').
  const bark = "#8a5a2c";
  const barkDark = "#6b4420";
  const woodRing1 = "#e6a95a";
  const woodRing2 = "#c98a44";
  const woodRing3 = "#a06a30";
  const hoodie = "#9ca3af";
  const hoodieDark = "#6b7280";
  const logLen = 1.7;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.26, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.26, 0.3, logLen, 16]} />
        <meshStandardMaterial color={bark} roughness={0.94} flatShading />
      </mesh>
      {[[-1, -logLen / 2 - 0.005], [1, logLen / 2 + 0.005]].map(([dir, x], i) => (
        <group key={`cut-${i}`} position={[x, 0.26, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh position={[0, 0.001 * dir, 0]}>
            <cylinderGeometry args={[0.262, 0.262, 0.02, 16]} />
            <meshStandardMaterial color={woodRing1} roughness={0.85} flatShading />
          </mesh>
          <mesh position={[0, 0.012 * dir, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.014, 16]} />
            <meshStandardMaterial color={woodRing2} roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.02 * dir, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.012, 14]} />
            <meshStandardMaterial color={woodRing3} roughness={0.86} />
          </mesh>
        </group>
      ))}
      {[[-0.45, 0.42, 0.14], [0.2, 0.36, 0.22], [0.5, 0.46, -0.08], [-0.1, 0.14, 0.25]].map(([x, y, z], i) => (
        <mesh key={`knot-${i}`} position={[x, y, z]} scale={[1, 0.5, 1]}>
          <sphereGeometry args={[0.05, 10, 6]} />
          <meshStandardMaterial color={barkDark} roughness={0.95} flatShading />
        </mesh>
      ))}
      <group position={[0.52, 0.5, 0.02]} rotation={[0.15, 0, -0.2]}>
        <mesh castShadow position={[0, 0, 0]}>
          <boxGeometry args={[0.34, 0.28, 0.42]} />
          <meshStandardMaterial color={hoodie} roughness={0.9} />
        </mesh>
        <mesh castShadow position={[-0.02, 0.14, 0]} scale={[1, 0.8, 1.05]}>
          <sphereGeometry args={[0.16, 12, 8]} />
          <meshStandardMaterial color={hoodieDark} roughness={0.9} />
        </mesh>
        <mesh position={[0.02, -0.2, 0]} rotation={[0.2, 0, 0]}>
          <boxGeometry args={[0.3, 0.16, 0.4]} />
          <meshStandardMaterial color={hoodieDark} roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

function SplitOakStump({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const bark = tint ?? "#5a3a1e";
  const pale = "#d8b483";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* standing base trunk stump */}
      <mesh castShadow receiveShadow position={[-0.18, 0.34, 0]}>
        <cylinderGeometry args={[0.19, 0.24, 0.68, 9]} />
        <meshStandardMaterial color={bark} roughness={0.92} flatShading />
      </mesh>
      {/* pale inner-wood cap on the break */}
      <mesh position={[-0.18, 0.69, 0]}>
        <cylinderGeometry args={[0.185, 0.185, 0.03, 9]} />
        <meshStandardMaterial color={pale} roughness={0.85} />
      </mesh>
      {/* jagged splinters standing up from the break */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        const r = 0.1;
        const hs = [0.16, 0.24, 0.19, 0.28, 0.14, 0.21][i];
        return (
          <mesh key={i} castShadow position={[-0.18 + Math.cos(a) * r, 0.7 + hs / 2, Math.sin(a) * r]} rotation={[Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4]}>
            <coneGeometry args={[0.05, hs, 5]} />
            <meshStandardMaterial color={pale} roughness={0.8} flatShading />
          </mesh>
        );
      })}
      {/* severed branch stub on base */}
      <mesh castShadow position={[-0.02, 0.42, 0.16]} rotation={[0.5, 0, -0.5]}>
        <cylinderGeometry args={[0.05, 0.08, 0.3, 7]} />
        <meshStandardMaterial color={bark} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.11, 0.53, 0.29]} rotation={[0.5, 0, -0.5]}>
        <cylinderGeometry args={[0.05, 0.05, 0.02, 7]} />
        <meshStandardMaterial color={pale} roughness={0.85} />
      </mesh>
      {/* fallen top portion lying tilted on ground */}
      <mesh castShadow receiveShadow position={[0.42, 0.16, 0.02]} rotation={[0, 0.2, Math.PI / 2 - 0.22]}>
        <cylinderGeometry args={[0.13, 0.17, 0.82, 9]} />
        <meshStandardMaterial color={bark} roughness={0.92} flatShading />
      </mesh>
      {/* pale broken end of the fallen log, facing the stump */}
      <mesh position={[0.14, 0.25, 0.03]} rotation={[0, 0.2, Math.PI / 2 - 0.22]}>
        <cylinderGeometry args={[0.165, 0.165, 0.03, 9]} />
        <meshStandardMaterial color={pale} roughness={0.85} />
      </mesh>
      {/* matching splinters on the fallen end */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2;
        const hs = [0.18, 0.12, 0.22, 0.15][i];
        return (
          <mesh key={"f" + i} castShadow position={[0.11, 0.25 + Math.sin(a) * 0.08, 0.03 + Math.cos(a) * 0.08]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[0.04, hs, 5]} />
            <meshStandardMaterial color={pale} roughness={0.8} flatShading />
          </mesh>
        );
      })}
      {/* a leafy sprig on the fallen top to show it was living */}
      <mesh castShadow position={[0.86, 0.24, 0.06]}>
        <dodecahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#5f9a3c" roughness={0.85} flatShading />
      </mesh>
    </group>
  );
}

function ChlorineFizzBottle({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  // Bomba de sonido: botella de plástico HINCHADA por la presión — panzona y
  // tensa como un globo — con burbujas verdes adentro y la tapa por saltar.
  const plastic = tint ?? "#dff1f8";
  const fizz = "#63d64a";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* cuerpo hinchado (elipsoide tenso) */}
      <mesh castShadow receiveShadow position={[0, 0.32, 0]} scale={[1, 1.18, 1]}>
        <sphereGeometry args={[0.26, 24, 20]} />
        <meshStandardMaterial color={plastic} roughness={0.26} metalness={0.05} transparent opacity={0.82} />
      </mesh>
      {/* culo petaloide abombado */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={`foot-${i}`} position={[Math.cos(a) * 0.1, 0.04, Math.sin(a) * 0.1]}>
            <sphereGeometry args={[0.065, 10, 8]} />
            <meshStandardMaterial color={plastic} roughness={0.3} transparent opacity={0.8} />
          </mesh>
        );
      })}
      {/* banda de etiqueta azul */}
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.263, 0.263, 0.17, 24]} />
        <meshStandardMaterial color="#7cc7e8" roughness={0.4} transparent opacity={0.68} />
      </mesh>
      {/* hombro y cuello estirados por la presión */}
      <mesh castShadow position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.08, 0.22, 0.14, 20]} />
        <meshStandardMaterial color={plastic} roughness={0.26} transparent opacity={0.82} />
      </mesh>
      <mesh position={[0, 0.69, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.08, 16]} />
        <meshStandardMaterial color={plastic} roughness={0.4} transparent opacity={0.88} />
      </mesh>
      {/* tapa amarilla hinchada, por saltar */}
      <mesh castShadow position={[0, 0.79, 0]} scale={[1.15, 1.3, 1.15]}>
        <sphereGeometry args={[0.08, 16, 14]} />
        <meshStandardMaterial color="#f4d21f" roughness={0.4} metalness={0.05} />
      </mesh>
      {/* burbujas verdes suspendidas adentro */}
      {[[0.06, 0.28, 0.05, 0.055], [-0.08, 0.36, -0.04, 0.05], [0.03, 0.44, 0.07, 0.045], [-0.05, 0.22, 0.08, 0.04], [0.1, 0.34, -0.05, 0.04], [-0.02, 0.3, -0.09, 0.05]].map((b, i) => (
        <mesh key={i} position={[b[0], b[1], b[2]]}>
          <sphereGeometry args={[b[3], 10, 10]} />
          <meshStandardMaterial color={fizz} roughness={0.3} transparent opacity={0.7} emissive={fizz} emissiveIntensity={0.2} />
        </mesh>
      ))}
      {/* etiqueta CLORO */}
      <mesh position={[0, 0.3, 0.27]}>
        <MiniLabel text="CLORO" background="#facc15" color="#7f1d1d" width={0.28} height={0.13} />
      </mesh>
    </group>
  );
}

function FirecrackerCrate({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const kraft = tint ?? "#b98a4e";
  const red = "#d92b2b";
  const wall = 0.42;
  const h = 0.26;
  const t = 0.03;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* box floor */}
      <mesh receiveShadow position={[0, 0.02, 0]}>
        <boxGeometry args={[wall, 0.04, wall]} />
        <meshStandardMaterial color={shade(kraft, 0.85)} roughness={0.9} />
      </mesh>
      {/* four side walls */}
      {[
        [0, h / 2 + 0.02, wall / 2 - t / 2, wall, h, t],
        [0, h / 2 + 0.02, -wall / 2 + t / 2, wall, h, t],
        [wall / 2 - t / 2, h / 2 + 0.02, 0, t, h, wall],
        [-wall / 2 + t / 2, h / 2 + 0.02, 0, t, h, wall]
      ].map((w, i) => (
        <mesh key={i} castShadow receiveShadow position={[w[0], w[1], w[2]]}>
          <boxGeometry args={[w[3], w[4], w[5]]} />
          <meshStandardMaterial color={kraft} roughness={0.9} />
        </mesh>
      ))}
      {/* folded-out flaps at the top of the front and back walls */}
      {[1, -1].map((s) => (
        <mesh key={"f" + s} castShadow position={[0, h + 0.02, s * (wall / 2 + 0.05)]} rotation={[s * 0.9, 0, 0]}>
          <boxGeometry args={[wall, t, 0.16]} />
          <meshStandardMaterial color={shade(kraft, 1.08)} roughness={0.9} />
        </mesh>
      ))}
      {/* bundle of upright firecrackers */}
      {[
        [0.0, 0.0, 0.34],
        [0.1, 0.08, 0.3],
        [-0.09, 0.07, 0.32],
        [0.08, -0.09, 0.28],
        [-0.08, -0.08, 0.33],
        [0.0, 0.12, 0.31],
        [0.12, -0.02, 0.29],
        [-0.11, -0.01, 0.3],
        [0.03, -0.11, 0.35]
      ].map((c, i) => {
        const fh = c[2];
        return (
          <group key={i} position={[c[0], 0, c[1]]}>
            {/* red cracker body */}
            <mesh castShadow position={[0, 0.04 + fh / 2, 0]}>
              <cylinderGeometry args={[0.028, 0.028, fh, 9]} />
              <meshStandardMaterial color={i % 2 ? shade(red, 1.12) : red} roughness={0.55} />
            </mesh>
            {/* gold band accent */}
            <mesh position={[0, 0.04 + fh * 0.35, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.02, 9]} />
              <meshStandardMaterial color="#f5c542" roughness={0.4} metalness={0.2} />
            </mesh>
            {/* thin fuse, some curled via tilt */}
            <mesh position={[0, 0.04 + fh + 0.05, 0]} rotation={[(i % 3) * 0.25, 0, (i % 2 ? 0.4 : -0.2) + (i % 3) * 0.2]}>
              <cylinderGeometry args={[0.006, 0.006, 0.12, 6]} />
              <meshStandardMaterial color="#3a2a1a" roughness={0.8} />
            </mesh>
          </group>
        );
      })}
      {/* baked PETARDOS warning label on the front wall */}
      <mesh position={[0, h / 2 + 0.02, wall / 2 + 0.005]}>
        <MiniLabel text="PETARDOS" background="#dc2626" color="#fef08a" width={0.34} height={0.13} />
      </mesh>
    </group>
  );
}

function UpdNooseChair({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const seatWood = tint ?? "#b5793f";
  const legMetal = "#4b5563";
  const rope = "#c9a44a";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {[-0.19, 0.19].map((x) =>
        [-0.17, 0.17].map((z) => (
          <mesh key={`${x},${z}`} castShadow position={[x, 0.21, z]}>
            <cylinderGeometry args={[0.028, 0.028, 0.42, 12]} />
            <meshStandardMaterial color={legMetal} roughness={0.45} metalness={0.55} />
          </mesh>
        ))
      )}
      <mesh castShadow receiveShadow position={[0, 0.44, 0]}>
        <boxGeometry args={[0.46, 0.05, 0.42]} />
        <meshStandardMaterial color={seatWood} roughness={0.68} />
      </mesh>
      {[-0.19, 0.19].map((x) => (
        <mesh key={x} castShadow position={[x, 0.6, -0.19]}>
          <cylinderGeometry args={[0.024, 0.024, 0.34, 12]} />
          <meshStandardMaterial color={legMetal} roughness={0.45} metalness={0.55} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.72, -0.2]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.44, 0.16, 0.04]} />
        <meshStandardMaterial color={shade(seatWood, 1.1)} roughness={0.68} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.24, 0.3, 20]} />
        <meshStandardMaterial color="#3a2c1c" roughness={0.9} transparent opacity={0.35} />
      </mesh>
      {/* ── Persona atada a la silla con la soga ── */}
      {[-0.12, 0.12].map((x) => (
        <mesh key={`pleg-${x}`} castShadow position={[x, 0.28, 0.16]} rotation={[0.5, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.045, 0.34, 10]} />
          <meshStandardMaterial color="#334155" roughness={0.72} />
        </mesh>
      ))}
      {[-0.12, 0.12].map((x) => (
        <mesh key={`pfoot-${x}`} castShadow position={[x, 0.11, 0.29]}>
          <boxGeometry args={[0.1, 0.06, 0.16]} />
          <meshStandardMaterial color="#1f2937" roughness={0.7} />
        </mesh>
      ))}
      {/* torso sentado */}
      <mesh castShadow position={[0, 0.66, -0.02]}>
        <cylinderGeometry args={[0.15, 0.16, 0.34, 14]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.66} />
      </mesh>
      {/* cabeza + pelo */}
      <mesh castShadow position={[0, 0.94, -0.03]}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color="#f2c197" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.99, -0.05]}>
        <sphereGeometry args={[0.126, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
        <meshStandardMaterial color="#2f1d13" roughness={0.8} />
      </mesh>
      {/* dos vueltas de soga atándolo al respaldo */}
      {[0.6, 0.73].map((y) => (
        <mesh key={`tie-${y}`} position={[0, y, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.185, 0.016, 8, 22]} />
          <meshStandardMaterial color={rope} roughness={0.85} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.74, -0.235]}>
        <boxGeometry args={[0.2, 0.14, 0.012]} />
        <meshStandardMaterial color="#d8b877" roughness={0.9} />
      </mesh>
      {[-0.05, 0.05].map((x) => (
        <mesh key={x} position={[x, 0.82, -0.225]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.012, 0.004, 6, 10]} />
          <meshStandardMaterial color="#1f2933" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 0.74, -0.242]}>
        <MiniLabel text="UPD" background="#d8b877" color="#7c2d12" width={0.17} height={0.1} />
      </mesh>
    </group>
  );
}

function VinchucaJar({ position, scale = 1, tint }: AssetProps) {
  const glass = tint ?? "#bfe3ea";
  const bug = "#2a1c14";
  const stripe = "#f97316";
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh receiveShadow position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.24, 0.25, 0.04, 24]} />
        <meshStandardMaterial color="#3f4a55" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh castShadow position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.23, 0.24, 0.44, 24]} />
        <meshStandardMaterial color={glass} roughness={0.12} metalness={0.05} transparent opacity={0.34} />
      </mesh>
      <mesh position={[0, 0.14, 0]} scale={[1.3, 0.45, 1]}>
        <sphereGeometry args={[0.15, 16, 10]} />
        <meshStandardMaterial color={bug} roughness={0.55} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.135, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.2, 16]} />
        <meshStandardMaterial color={stripe} roughness={0.5} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.185, 0.19]}>
        <sphereGeometry args={[0.055, 12, 10]} />
        <meshStandardMaterial color={shade(bug, 0.85)} roughness={0.5} />
      </mesh>
      {[0.24, 0.34, 0.44].map((a) =>
        [-1, 1].map((s) => (
          <mesh key={`${a},${s}`} position={[s * 0.16 * Math.cos(a), 0.115, 0.05 - a * 0.18]} rotation={[0, 0, s * 0.7]}>
            <cylinderGeometry args={[0.007, 0.007, 0.16, 6]} />
            <meshStandardMaterial color={bug} roughness={0.6} />
          </mesh>
        ))
      )}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.03, 0.21, 0.24]} rotation={[0.5, 0, s * 0.35]}>
          <cylinderGeometry args={[0.005, 0.004, 0.14, 5]} />
          <meshStandardMaterial color={shade(bug, 0.8)} roughness={0.6} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.51, 0]}>
        <cylinderGeometry args={[0.245, 0.245, 0.08, 24]} />
        <meshStandardMaterial color="#7f8b96" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0.47, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.245, 0.02, 8, 24]} />
        <meshStandardMaterial color="#9aa4ae" roughness={0.4} metalness={0.6} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const ang = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[0.11 * Math.cos(ang), 0.552, 0.11 * Math.sin(ang)]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.014, 0.014, 0.02, 8]} />
            <meshStandardMaterial color="#2b3138" roughness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

function BrokenWindowFrame({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  // Sólo el marco de madera alrededor y adentro el vidrio hecho pedazos:
  // esquirlas dentadas colgando de los bordes hacia el centro (hueco) y algunos
  // vidrios rotos en el piso.
  const wood = tint ?? "#8a4a1c";
  const glass = "#a8e0ef";
  const W = 0.62;
  const H = 0.9;
  const cy = 0.55;
  const th = 0.06;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* apoyos para que se pare */}
      {[-0.24, 0.24].map((x) => (
        <mesh key={`base-${x}`} castShadow position={[x, 0.05, 0]}>
          <boxGeometry args={[0.1, 0.1, 0.14]} />
          <meshStandardMaterial color={shade(wood, 0.8)} roughness={0.82} />
        </mesh>
      ))}
      {/* marco: 2 verticales + 2 horizontales */}
      {[-W / 2, W / 2].map((x) => (
        <mesh key={`v-${x}`} castShadow position={[x, cy, 0]}>
          <boxGeometry args={[th, H + th, 0.08]} />
          <meshStandardMaterial color={wood} roughness={0.8} />
        </mesh>
      ))}
      {[-H / 2, H / 2].map((y) => (
        <mesh key={`h-${y}`} castShadow position={[0, cy + y, 0]}>
          <boxGeometry args={[W + th, th, 0.08]} />
          <meshStandardMaterial color={shade(wood, 1.06)} roughness={0.8} />
        </mesh>
      ))}
      {/* esquirlas dentadas colgando de los bordes hacia el centro */}
      {[
        [-0.2, 0.85, -0.3], [0.05, 0.86, 0.4], [0.22, 0.83, 0.1],
        [-0.24, 0.35, 3.4], [0.1, 0.28, 2.8], [0.24, 0.5, 3.2],
        [-0.26, 0.62, 1.6], [0.26, 0.66, -1.6],
      ].map(([x, y, r], i) => (
        <mesh key={`shard-${i}`} position={[x, y, 0]} rotation={[0, 0, r]}>
          <coneGeometry args={[0.07, 0.22, 3]} />
          <meshStandardMaterial color={glass} roughness={0.1} metalness={0.05} transparent opacity={0.4} side={DoubleSide} flatShading />
        </mesh>
      ))}
      {/* vidrios rotos en el piso adelante */}
      {[[-0.12, 0.16], [0.14, 0.22], [0.0, 0.12]].map(([x, z], i) => (
        <mesh key={`floor-${i}`} position={[x, 0.02, z]} rotation={[Math.PI / 2.2, 0, i * 1.3]}>
          <coneGeometry args={[0.05, 0.13, 3]} />
          <meshStandardMaterial color={glass} roughness={0.1} transparent opacity={0.45} side={DoubleSide} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function HidingLockerWilly({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const metal = tint ?? "#2fb4b0";
  const w = 0.5;
  const h = 1.35;
  const d = 0.42;
  const doorW = w / 2;
  const openAngle = -0.7;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* back and side shell of the cabinet */}
      <mesh castShadow receiveShadow position={[0, h / 2, -d / 2 + 0.02]}>
        <boxGeometry args={[w, h, 0.04]} />
        <meshStandardMaterial color={shade(metal, 0.82)} roughness={0.7} metalness={0.3} />
      </mesh>
      {[-w / 2 + 0.02, w / 2 - 0.02].map((x) => (
        <mesh key={x} castShadow position={[x, h / 2, 0]}>
          <boxGeometry args={[0.04, h, d]} />
          <meshStandardMaterial color={shade(metal, 0.9)} roughness={0.7} metalness={0.3} />
        </mesh>
      ))}
      {/* top and bottom caps */}
      <mesh castShadow position={[0, h - 0.02, 0]}>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial color={shade(metal, 1.08)} roughness={0.6} metalness={0.35} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.02, 0]}>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial color={shade(metal, 0.75)} roughness={0.7} metalness={0.3} />
      </mesh>
      {/* dark interior floor/back so the hidden figure sits in shadow */}
      <mesh position={[0, h / 2, -d / 2 + 0.06]}>
        <boxGeometry args={[w - 0.1, h - 0.08, 0.02]} />
        <meshStandardMaterial color="#0f1f22" roughness={0.95} />
      </mesh>
      {/* crouched hidden figure: dark rounded box + hoodie */}
      <mesh castShadow position={[0.02, 0.42, -0.02]}>
        <boxGeometry args={[0.26, 0.5, 0.2]} />
        <meshStandardMaterial color="#1f2933" roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0.02, 0.72, 0]}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial color="#12181f" roughness={0.9} />
      </mesh>
      {/* two wide white eyes peeking */}
      {[-0.05, 0.09].map((x) => (
        <mesh key={x} position={[x, 0.75, 0.1]}>
          <sphereGeometry args={[0.032, 12, 12]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.3} emissive="#f8fafc" emissiveIntensity={0.2} />
        </mesh>
      ))}
      {[-0.05, 0.09].map((x) => (
        <mesh key={`p-${x}`} position={[x, 0.75, 0.128]}>
          <sphereGeometry args={[0.014, 10, 10]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} />
        </mesh>
      ))}
      {/* CLOSED left half of the front face with vents + number plate */}
      <mesh castShadow receiveShadow position={[-doorW / 2, h / 2, d / 2 - 0.01]}>
        <boxGeometry args={[doorW, h - 0.06, 0.03]} />
        <meshStandardMaterial color={metal} roughness={0.62} metalness={0.35} />
      </mesh>
      {/* chipped rust patches on the closed face */}
      <mesh position={[-doorW / 2 - 0.06, h * 0.32, d / 2 + 0.006]}>
        <boxGeometry args={[0.07, 0.11, 0.006]} />
        <meshStandardMaterial color="#8a4a1c" roughness={0.9} />
      </mesh>
      <mesh position={[-doorW / 2 + 0.05, h * 0.7, d / 2 + 0.006]}>
        <boxGeometry args={[0.05, 0.06, 0.006]} />
        <meshStandardMaterial color="#7c4524" roughness={0.9} />
      </mesh>
      {/* vent slats near top of closed face */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={`v-${i}`} position={[-doorW / 2, h - 0.16 - i * 0.05, d / 2 + 0.006]}>
          <boxGeometry args={[doorW - 0.08, 0.018, 0.008]} />
          <meshStandardMaterial color={shade(metal, 0.62)} roughness={0.75} />
        </mesh>
      ))}
      {/* number plate */}
      <mesh position={[-doorW / 2, h * 0.56, d / 2 + 0.01]}>
        <MiniLabel text="37" background="#e5e7eb" color="#1f2933" width={0.14} height={0.09} />
      </mesh>
      {/* handle nub on closed face */}
      <mesh castShadow position={[-0.04, h * 0.42, d / 2 + 0.02]}>
        <boxGeometry args={[0.03, 0.1, 0.03]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* AJAR right door: pivoted from its inner hinge edge */}
      <group position={[0, h / 2, d / 2 - 0.02]} rotation={[0, openAngle, 0]}>
        <mesh castShadow receiveShadow position={[doorW / 2, 0, 0]}>
          <boxGeometry args={[doorW, h - 0.06, 0.03]} />
          <meshStandardMaterial color={shade(metal, 1.06)} roughness={0.6} metalness={0.35} />
        </mesh>
        {/* inner face of open door slightly darker */}
        <mesh position={[doorW / 2, 0, -0.018]}>
          <boxGeometry args={[doorW - 0.04, h - 0.12, 0.006]} />
          <meshStandardMaterial color={shade(metal, 0.7)} roughness={0.7} />
        </mesh>
        {/* vents on the open door */}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={`dv-${i}`} position={[doorW / 2, (h - 0.06) / 2 - 0.1 - i * 0.05, 0.016]}>
            <boxGeometry args={[doorW - 0.1, 0.018, 0.008]} />
            <meshStandardMaterial color={shade(metal, 0.72)} roughness={0.75} />
          </mesh>
        ))}
        {/* handle on the open door */}
        <mesh castShadow position={[doorW - 0.06, -0.05, 0.03]}>
          <boxGeometry args={[0.03, 0.1, 0.03]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.4} metalness={0.6} />
        </mesh>
      </group>
      {/* four little feet */}
      {[[-w / 2 + 0.05, -d / 2 + 0.05], [w / 2 - 0.05, -d / 2 + 0.05], [-w / 2 + 0.05, d / 2 - 0.05], [w / 2 - 0.05, d / 2 - 0.05]].map(([fx, fz], i) => (
        <mesh key={`f-${i}`} castShadow position={[fx, 0.015, fz]}>
          <cylinderGeometry args={[0.03, 0.035, 0.03, 8]} />
          <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function HidingLockerBank({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const metal = tint ?? "#2fa7a3";
  const count = 5;
  const uw = 0.34;
  const h = 1.2;
  const d = 0.4;
  const gap = 0.01;
  const totalW = count * uw + (count - 1) * gap;
  const startX = -totalW / 2 + uw / 2;
  const nums = ["12", "13", "14", "15", "16"];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* plinth base under the whole bank */}
      <mesh castShadow receiveShadow position={[0, 0.04, 0]}>
        <boxGeometry args={[totalW + 0.06, 0.08, d + 0.04]} />
        <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.3} />
      </mesh>
      {/* flat top rail connecting all lockers */}
      <mesh castShadow position={[0, h + 0.04, 0]}>
        <boxGeometry args={[totalW + 0.06, 0.06, d + 0.03]} />
        <meshStandardMaterial color={shade(metal, 1.1)} roughness={0.6} metalness={0.35} />
      </mesh>
      {Array.from({ length: count }).map((_, i) => {
        const x = startX + i * (uw + gap);
        const body = i % 2 === 0 ? metal : shade(metal, 0.86);
        const open = i === 3;
        return (
          <group key={i} position={[x, 0, 0]}>
            {/* cabinet shell */}
            <mesh castShadow receiveShadow position={[0, h / 2 + 0.05, -d / 2 + 0.02]}>
              <boxGeometry args={[uw, h, 0.04]} />
              <meshStandardMaterial color={shade(body, 0.8)} roughness={0.7} metalness={0.3} />
            </mesh>
            {[-uw / 2 + 0.015, uw / 2 - 0.015].map((sx) => (
              <mesh key={sx} castShadow position={[sx, h / 2 + 0.05, 0]}>
                <boxGeometry args={[0.03, h, d]} />
                <meshStandardMaterial color={shade(body, 0.88)} roughness={0.7} metalness={0.3} />
              </mesh>
            ))}
            {/* dark interior for the open one */}
            {open && (
              <mesh position={[0, h / 2 + 0.05, -d / 2 + 0.07]}>
                <boxGeometry args={[uw - 0.08, h - 0.1, 0.02]} />
                <meshStandardMaterial color="#0f1f22" roughness={0.95} />
              </mesh>
            )}
            {/* door: closed flush, or swung open */}
            {open ? (
              <group position={[-uw / 2 + 0.02, h / 2 + 0.05, d / 2 - 0.02]} rotation={[0, 0.6, 0]}>
                <mesh castShadow receiveShadow position={[uw / 2 - 0.02, 0, 0]}>
                  <boxGeometry args={[uw - 0.04, h - 0.08, 0.03]} />
                  <meshStandardMaterial color={shade(body, 1.05)} roughness={0.6} metalness={0.35} />
                </mesh>
                {[0, 1, 2].map((v) => (
                  <mesh key={v} position={[uw / 2 - 0.02, (h - 0.08) / 2 - 0.09 - v * 0.05, 0.016]}>
                    <boxGeometry args={[uw - 0.14, 0.016, 0.008]} />
                    <meshStandardMaterial color={shade(body, 0.7)} roughness={0.75} />
                  </mesh>
                ))}
                <mesh castShadow position={[uw - 0.06, -0.04, 0.028]}>
                  <boxGeometry args={[0.025, 0.08, 0.025]} />
                  <meshStandardMaterial color="#cbd5e1" roughness={0.4} metalness={0.6} />
                </mesh>
              </group>
            ) : (
              <group>
                <mesh castShadow receiveShadow position={[0, h / 2 + 0.05, d / 2 - 0.01]}>
                  <boxGeometry args={[uw - 0.05, h - 0.08, 0.03]} />
                  <meshStandardMaterial color={body} roughness={0.62} metalness={0.35} />
                </mesh>
                {/* vent slats top */}
                {[0, 1, 2].map((v) => (
                  <mesh key={v} position={[0, h + 0.05 - 0.12 - v * 0.05, d / 2 + 0.006]}>
                    <boxGeometry args={[uw - 0.13, 0.016, 0.008]} />
                    <meshStandardMaterial color={shade(body, 0.6)} roughness={0.75} />
                  </mesh>
                ))}
                {/* number plate */}
                <mesh position={[0, h * 0.52 + 0.05, d / 2 + 0.01]}>
                  <MiniLabel text={nums[i]} background="#e5e7eb" color="#1f2933" width={0.11} height={0.075} />
                </mesh>
                {/* handle nub */}
                <mesh castShadow position={[-uw / 2 + 0.07, h * 0.42 + 0.05, d / 2 + 0.02]}>
                  <boxGeometry args={[0.025, 0.08, 0.025]} />
                  <meshStandardMaterial color="#cbd5e1" roughness={0.4} metalness={0.6} />
                </mesh>
                {/* occasional rust chip */}
                {i === 1 && (
                  <mesh position={[uw / 2 - 0.09, h * 0.3 + 0.05, d / 2 + 0.007]}>
                    <boxGeometry args={[0.05, 0.08, 0.006]} />
                    <meshStandardMaterial color="#8a4a1c" roughness={0.9} />
                  </mesh>
                )}
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}

function SteamyPortenoTaxi({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const bodyBlack = tint ?? "#15181d";
  const taxiYellow = "#f5b514";
  const bodyW = 0.62;
  const bodyL = 1.3;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* lower black body */}
      <mesh castShadow receiveShadow position={[0, 0.22, 0]}>
        <boxGeometry args={[bodyW, 0.24, bodyL]} />
        <meshStandardMaterial color={bodyBlack} roughness={0.4} metalness={0.35} />
      </mesh>
      {/* yellow door band along the sides */}
      {[-bodyW / 2 - 0.004, bodyW / 2 + 0.004].map((x) => (
        <mesh key={x} position={[x, 0.2, 0]}>
          <boxGeometry args={[0.012, 0.16, bodyL - 0.14]} />
          <meshStandardMaterial color={taxiYellow} roughness={0.5} metalness={0.2} />
        </mesh>
      ))}
      {/* yellow cabin / roof block */}
      <mesh castShadow position={[0, 0.44, -0.03]}>
        <boxGeometry args={[bodyW - 0.06, 0.24, 0.72]} />
        <meshStandardMaterial color={taxiYellow} roughness={0.45} metalness={0.2} />
      </mesh>
      {/* fogged windshield */}
      <mesh position={[0, 0.44, 0.35]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[bodyW - 0.12, 0.2, 0.03]} />
        <meshStandardMaterial color="#eef2f5" roughness={0.25} metalness={0.05} transparent opacity={0.72} />
      </mesh>
      {/* fogged rear window */}
      <mesh position={[0, 0.44, -0.41]} rotation={[-0.4, 0, 0]}>
        <boxGeometry args={[bodyW - 0.12, 0.2, 0.03]} />
        <meshStandardMaterial color="#eef2f5" roughness={0.25} metalness={0.05} transparent opacity={0.72} />
      </mesh>
      {/* fogged side windows */}
      {[-(bodyW - 0.06) / 2 - 0.006, (bodyW - 0.06) / 2 + 0.006].map((x) => (
        <mesh key={x} position={[x, 0.46, -0.03]}>
          <boxGeometry args={[0.02, 0.16, 0.6]} />
          <meshStandardMaterial color="#eef2f5" roughness={0.25} metalness={0.05} transparent opacity={0.68} />
        </mesh>
      ))}
      {/* lumpy clothes bag on the back seat, seen through rear glass */}
      <mesh castShadow position={[0.06, 0.4, -0.22]} rotation={[0.1, 0.3, 0.15]}>
        <boxGeometry args={[0.24, 0.18, 0.22]} />
        <meshStandardMaterial color="#c94f8a" roughness={0.85} />
      </mesh>
      <mesh position={[-0.08, 0.42, -0.16]} rotation={[0.2, -0.2, 0.1]}>
        <boxGeometry args={[0.16, 0.12, 0.14]} />
        <meshStandardMaterial color="#6aa9e0" roughness={0.85} />
      </mesh>
      {/* TAXI sign box on the roof */}
      <mesh castShadow position={[0, 0.6, -0.03]}>
        <boxGeometry args={[0.28, 0.1, 0.14]} />
        <meshStandardMaterial color="#111827" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.6, 0.041]}>
        <MiniLabel text="TAXI" background="#f5b514" color="#111827" width={0.24} height={0.09} />
      </mesh>
      <mesh position={[0, 0.6, -0.101]}>
        <MiniLabel text="TAXI" background="#f5b514" color="#111827" width={0.24} height={0.09} />
      </mesh>
      {/* soft steam puffs rising off the roof */}
      {[[0.12, 0.72, 0.15, 0.09], [-0.1, 0.78, 0.05, 0.08], [0.02, 0.86, -0.1, 0.11], [0.16, 0.92, 0.02, 0.07], [-0.14, 0.98, -0.05, 0.06]].map(([px, py, pz, r], i) => (
        <mesh key={i} position={[px, py, pz]}>
          <sphereGeometry args={[r, 12, 12]} />
          <meshStandardMaterial color="#ffffff" roughness={0.9} transparent opacity={0.5 - i * 0.05} />
        </mesh>
      ))}
      {/* headlights front */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={`h-${x}`} position={[x, 0.22, bodyL / 2 + 0.005]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.03, 12]} />
          <meshStandardMaterial color="#fff7d6" roughness={0.3} emissive="#fde68a" emissiveIntensity={0.5} />
        </mesh>
      ))}
      {/* tail lights */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={`t-${x}`} position={[x, 0.22, -bodyL / 2 - 0.005]}>
          <boxGeometry args={[0.07, 0.05, 0.02]} />
          <meshStandardMaterial color="#dc2626" roughness={0.4} emissive="#b91c1c" emissiveIntensity={0.4} />
        </mesh>
      ))}
      {/* wheels */}
      {[[-bodyW / 2, 0.4], [bodyW / 2, 0.4], [-bodyW / 2, -0.4], [bodyW / 2, -0.4]].map(([wx, wz], i) => (
        <mesh key={i} castShadow position={[wx, 0.11, wz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.13, 0.13, 0.08, 16]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.85} />
        </mesh>
      ))}
      {/* hubcaps */}
      {[[-bodyW / 2 - 0.042, 0.4], [bodyW / 2 + 0.042, 0.4], [-bodyW / 2 - 0.042, -0.4], [bodyW / 2 + 0.042, -0.4]].map(([wx, wz], i) => (
        <mesh key={`hub-${i}`} position={[wx, 0.11, wz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.055, 0.055, 0.02, 12]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
      {/* vómito verde chorreando por la puerta del costado hasta un charco */}
      <mesh position={[bodyW / 2 + 0.05, 0.15, 0.12]} rotation={[0, 0, -0.75]}>
        <cylinderGeometry args={[0.03, 0.07, 0.3, 9]} />
        <meshStandardMaterial color="#84cc16" roughness={0.45} transparent opacity={0.85} />
      </mesh>
      <mesh position={[bodyW / 2 + 0.18, 0.02, 0.12]} scale={[1.5, 0.2, 1.2]}>
        <sphereGeometry args={[0.13, 14, 10]} />
        <meshStandardMaterial color="#65a30d" roughness={0.8} transparent opacity={0.85} />
      </mesh>
      {[[0.02, 0.06], [-0.05, -0.04], [0.06, 0.02]].map(([dz, dx], i) => (
        <mesh key={`vchunk-${i}`} position={[bodyW / 2 + 0.16 + dx, 0.04, 0.12 + dz]} scale={[1, 0.4, 0.9]}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color={i % 2 ? "#a3e635" : "#bef264"} roughness={0.72} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function JustDanceKinectPad({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const sensor = tint ?? "#141821";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* dance mat / pad */}
      <mesh receiveShadow castShadow position={[0.42, 0.02, 0]}>
        <boxGeometry args={[0.8, 0.04, 0.8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.25} metalness={0.15} />
      </mesh>
      <mesh position={[0.42, 0.041, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.74, 0.74]} />
        <meshStandardMaterial color="#0f172a" roughness={0.2} metalness={0.2} />
      </mesh>
      {/* directional arrows: up green, down red, left cyan, right pink */}
      <mesh position={[0.42, 0.043, -0.22]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.09, 0.16, 3]} />
        <meshStandardMaterial color="#22c55e" roughness={0.4} emissive="#166534" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0.42, 0.043, 0.22]} rotation={[Math.PI / 2, 0, Math.PI]}>
        <coneGeometry args={[0.09, 0.16, 3]} />
        <meshStandardMaterial color="#ef4444" roughness={0.4} emissive="#7f1d1d" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0.2, 0.043, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <coneGeometry args={[0.09, 0.16, 3]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.4} emissive="#075985" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0.64, 0.043, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.09, 0.16, 3]} />
        <meshStandardMaterial color="#f472b6" roughness={0.4} emissive="#9d174d" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0.42, 0.044, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <MiniLabel text="JUST DANCE" background="#7c3aed" color="#fde047" width={0.34} height={0.1} />
      </mesh>
      {/* stand base disc */}
      <mesh receiveShadow castShadow position={[-0.42, 0.02, 0]}>
        <cylinderGeometry args={[0.16, 0.19, 0.04, 20]} />
        <meshStandardMaterial color="#1f2933" roughness={0.5} metalness={0.2} />
      </mesh>
      {/* stand pole */}
      <mesh castShadow position={[-0.42, 0.28, 0]}>
        <cylinderGeometry args={[0.028, 0.034, 0.5, 12]} />
        <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.4} />
      </mesh>
      {/* sensor bar body */}
      <mesh castShadow position={[-0.42, 0.56, 0]}>
        <boxGeometry args={[0.62, 0.12, 0.1]} />
        <meshStandardMaterial color={sensor} roughness={0.32} metalness={0.25} />
      </mesh>
      {/* two lens circles */}
      <mesh position={[-0.55, 0.56, 0.051]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.036, 0.036, 0.02, 16]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.15} metalness={0.3} emissive="#0369a1" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[-0.55, 0.56, 0.051]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.036, 0.036, 0.02, 16]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.15} metalness={0.3} emissive="#0369a1" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[-0.3, 0.56, 0.051]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.036, 0.036, 0.02, 16]} />
        <meshStandardMaterial color="#111827" roughness={0.2} metalness={0.4} emissive="#7c3aed" emissiveIntensity={0.35} />
      </mesh>
      {/* faint glow scan line */}
      <mesh position={[-0.42, 0.61, 0.051]}>
        <boxGeometry args={[0.5, 0.012, 0.005]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.3} emissive="#38bdf8" emissiveIntensity={0.9} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function SchoolDeskPupitre({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const wood = tint ?? "#c08457";
  const metal = "#94a3b8";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* slanted writing lid */}
      <mesh castShadow receiveShadow position={[0, 0.62, 0.14]} rotation={[-0.22, 0, 0]}>
        <boxGeometry args={[0.6, 0.04, 0.44]} />
        <meshStandardMaterial color={wood} roughness={0.7} />
      </mesh>
      {/* lip at bottom of slanted lid (pencil groove) */}
      <mesh castShadow position={[0, 0.585, 0.34]}>
        <boxGeometry args={[0.6, 0.03, 0.04]} />
        <meshStandardMaterial color={shade(wood, 0.85)} roughness={0.7} />
      </mesh>
      {/* carved initials label on lid */}
      <mesh position={[0.02, 0.645, 0.16]} rotation={[-0.22 - Math.PI / 2, 0, 0]}>
        <MiniLabel text="J + M" background="#a06a44" color="#5b3a22" width={0.22} height={0.11} />
      </mesh>
      {/* under-desk book ledge */}
      <mesh castShadow receiveShadow position={[0, 0.44, 0.12]}>
        <boxGeometry args={[0.56, 0.03, 0.36]} />
        <meshStandardMaterial color={shade(wood, 0.92)} roughness={0.72} />
      </mesh>
      {/* a book on the ledge */}
      <mesh castShadow position={[-0.1, 0.475, 0.1]} rotation={[0, 0.2, 0]}>
        <boxGeometry args={[0.22, 0.04, 0.28]} />
        <meshStandardMaterial color="#2563eb" roughness={0.5} />
      </mesh>
      {/* metal frame front legs */}
      {[-0.26, 0.26].map((x) => (
        <mesh key={`fl${x}`} castShadow position={[x, 0.22, 0.3]}>
          <cylinderGeometry args={[0.022, 0.022, 0.44, 10]} />
          <meshStandardMaterial color={metal} roughness={0.4} metalness={0.45} />
        </mesh>
      ))}
      {/* metal frame back legs (extend down toward seat side) */}
      {[-0.26, 0.26].map((x) => (
        <mesh key={`bl${x}`} castShadow position={[x, 0.16, -0.02]}>
          <cylinderGeometry args={[0.022, 0.022, 0.32, 10]} />
          <meshStandardMaterial color={metal} roughness={0.4} metalness={0.45} />
        </mesh>
      ))}
      {/* bent tube connecting desk to seat (side rails) */}
      {[-0.26, 0.26].map((x) => (
        <mesh key={`rail${x}`} castShadow position={[x, 0.32, 0.14]}>
          <boxGeometry args={[0.03, 0.03, 0.34]} />
          <meshStandardMaterial color={metal} roughness={0.4} metalness={0.45} />
        </mesh>
      ))}
      {/* seat */}
      <mesh castShadow receiveShadow position={[0, 0.3, -0.34]}>
        <boxGeometry args={[0.46, 0.04, 0.36]} />
        <meshStandardMaterial color={shade(wood, 1.05)} roughness={0.7} />
      </mesh>
      {/* small backrest */}
      <mesh castShadow position={[0, 0.44, -0.5]} rotation={[0.12, 0, 0]}>
        <boxGeometry args={[0.46, 0.14, 0.035]} />
        <meshStandardMaterial color={shade(wood, 1.05)} roughness={0.7} />
      </mesh>
      {/* backrest support tubes */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={`bs${x}`} castShadow position={[x, 0.38, -0.48]}>
          <cylinderGeometry args={[0.018, 0.018, 0.18, 10]} />
          <meshStandardMaterial color={metal} roughness={0.4} metalness={0.45} />
        </mesh>
      ))}
      {/* seat legs */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={`sl${x}`} castShadow position={[x, 0.14, -0.44]}>
          <cylinderGeometry args={[0.02, 0.02, 0.28, 10]} />
          <meshStandardMaterial color={metal} roughness={0.4} metalness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function PeedYellowBarricade({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const yellow = tint ?? "#f5c518";
  const stain = "#8a6a1c";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* main barrier body */}
      <mesh castShadow receiveShadow position={[0, 0.3, 0]}>
        <boxGeometry args={[1.3, 0.42, 0.12]} />
        <meshStandardMaterial color={yellow} roughness={0.6} metalness={0.05} />
      </mesh>
      {/* top rail cap */}
      <mesh castShadow position={[0, 0.53, 0]}>
        <boxGeometry args={[1.34, 0.06, 0.16]} />
        <meshStandardMaterial color={shade(yellow, 1.08)} roughness={0.55} />
      </mesh>
      {/* cutout window slot (dark gap) to sell jersey/plastic barrier look */}
      <mesh position={[0, 0.34, 0.062]}>
        <boxGeometry args={[0.8, 0.16, 0.02]} />
        <meshStandardMaterial color={shade(yellow, 0.7)} roughness={0.6} />
      </mesh>
      {/* hazard chevrons (black diagonal bars on front) */}
      {[-0.42, -0.14, 0.14, 0.42].map((x) => (
        <mesh key={`cf${x}`} position={[x, 0.18, 0.062]} rotation={[0, 0, -0.6]}>
          <boxGeometry args={[0.08, 0.22, 0.01]} />
          <meshStandardMaterial color="#111827" roughness={0.55} />
        </mesh>
      ))}
      {/* white reflective strip */}
      <mesh position={[0, 0.47, 0.062]}>
        <boxGeometry args={[1.24, 0.05, 0.01]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} metalness={0.2} emissive="#e2e8f0" emissiveIntensity={0.2} />
      </mesh>
      {/* stained / discolored drip patches (the 'meado' gag) */}
      <mesh position={[-0.35, 0.16, 0.063]}>
        <boxGeometry args={[0.14, 0.28, 0.006]} />
        <meshStandardMaterial color={stain} roughness={0.85} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0.28, 0.13, 0.063]}>
        <boxGeometry args={[0.1, 0.34, 0.006]} />
        <meshStandardMaterial color={shade(stain, 0.85)} roughness={0.88} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0.02, 0.11, 0.063]}>
        <boxGeometry args={[0.08, 0.2, 0.006]} />
        <meshStandardMaterial color={stain} roughness={0.85} transparent opacity={0.45} />
      </mesh>
      {/* pooled stain along bottom edge */}
      <mesh position={[-0.1, 0.11, 0.064]}>
        <boxGeometry args={[1.0, 0.06, 0.006]} />
        <meshStandardMaterial color={shade(stain, 0.8)} roughness={0.9} transparent opacity={0.4} />
      </mesh>
      {/* foot outriggers */}
      {[-0.55, 0.55].map((x) => (
        <mesh key={`ft${x}`} castShadow receiveShadow position={[x, 0.04, 0]}>
          <boxGeometry args={[0.14, 0.08, 0.5]} />
          <meshStandardMaterial color={shade(yellow, 0.9)} roughness={0.65} />
        </mesh>
      ))}
    </group>
  );
}

function CrumpledBioExamAusente({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  const paper = tint ?? "#f4f1e4";
  const shadowPaper = shade(paper, 0.9);
  const litPaper = shade(paper, 1.04);
  const line = "#9aa2ad";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* main crumpled sheet: overlapping tilted facets to fake creases */}
      <mesh castShadow receiveShadow position={[0, 0.02, 0]} rotation={[0.03, 0, -0.02]}>
        <boxGeometry args={[0.6, 0.02, 0.44]} />
        <meshStandardMaterial color={paper} roughness={0.92} flatShading />
      </mesh>
      <mesh castShadow position={[-0.14, 0.035, 0.06]} rotation={[-0.12, 0.05, 0.14]}>
        <boxGeometry args={[0.34, 0.018, 0.24]} />
        <meshStandardMaterial color={shadowPaper} roughness={0.92} flatShading />
      </mesh>
      <mesh castShadow position={[0.16, 0.036, -0.08]} rotation={[0.16, -0.06, -0.13]}>
        <boxGeometry args={[0.3, 0.018, 0.22]} />
        <meshStandardMaterial color={litPaper} roughness={0.92} flatShading />
      </mesh>
      <mesh castShadow position={[0.02, 0.045, 0.13]} rotation={[-0.2, 0.1, 0.05]}>
        <boxGeometry args={[0.22, 0.016, 0.16]} />
        <meshStandardMaterial color={shade(paper, 0.96)} roughness={0.92} flatShading />
      </mesh>
      {/* corners bent UP */}
      <mesh castShadow position={[-0.27, 0.06, -0.18]} rotation={[0.5, 0.3, -0.35]}>
        <boxGeometry args={[0.18, 0.016, 0.14]} />
        <meshStandardMaterial color={litPaper} roughness={0.9} flatShading />
      </mesh>
      <mesh castShadow position={[0.28, 0.07, 0.18]} rotation={[-0.55, -0.2, 0.4]}>
        <boxGeometry args={[0.16, 0.016, 0.13]} />
        <meshStandardMaterial color={shade(paper, 1.06)} roughness={0.9} flatShading />
      </mesh>
      {/* torn edge notch (dark gap) */}
      <mesh position={[-0.3, 0.03, 0.1]} rotation={[0, 0.6, 0]}>
        <boxGeometry args={[0.08, 0.03, 0.09]} />
        <meshStandardMaterial color="#d8d2bf" roughness={0.95} flatShading />
      </mesh>
      {/* baked faint text lines (thin strips) lying on the surface */}
      {[-0.12, -0.05, 0.02, 0.09, 0.16].map((z, i) => (
        <mesh key={z} position={[-0.02 + i * 0.005, 0.033, z]} rotation={[0, 0.01 * i, 0]}>
          <boxGeometry args={[0.34 - i * 0.02, 0.002, 0.012]} />
          <meshStandardMaterial color={line} roughness={0.85} transparent opacity={0.55} />
        </mesh>
      ))}
      {/* bio diagram: a little cell — outer membrane ring + nucleus + organelle dots */}
      <mesh position={[0.19, 0.034, -0.12]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.05, 0.062, 20]} />
        <meshStandardMaterial color="#3b82f6" roughness={0.8} side={DoubleSide} transparent opacity={0.7} />
      </mesh>
      <mesh position={[0.19, 0.035, -0.12]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.02, 16]} />
        <meshStandardMaterial color="#2563eb" roughness={0.8} side={DoubleSide} transparent opacity={0.7} />
      </mesh>
      {[[0.14, -0.09], [0.23, -0.15], [0.16, -0.15]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.035, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.008, 10]} />
          <meshStandardMaterial color="#1d4ed8" roughness={0.8} side={DoubleSide} transparent opacity={0.7} />
        </mesh>
      ))}
      {/* big red AUSENTE stamp, angled across the sheet, just above surface */}
      <mesh position={[-0.02, 0.05, 0.0]} rotation={[-Math.PI / 2, 0, 0.42]}>
        <MiniLabel text="AUSENTE" background="#dc2626" color="#fef2f2" width={0.44} height={0.16} />
      </mesh>
      {/* faint stamp outline box to read as an ink border */}
      <mesh position={[-0.02, 0.049, 0.0]} rotation={[-Math.PI / 2, 0, 0.42]}>
        <ringGeometry args={[0.2, 0.215, 4]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.7} side={DoubleSide} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

function PelotazoImpactBall({ position, rotationY = 0, scale = 1, tint }: AssetProps) {
  // La pelota justo pegándole a una chica que venía corriendo y se cae de
  // espaldas por el impacto. POW cómico.
  const shell = tint ?? "#f8fafc";
  const skin = "#f2c197";
  const shirt = "#ec4899";
  const pants = "#334155";
  const hair = "#6b3a1a";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* ── Chica cayéndose de espaldas (inclinada hacia atrás) ── */}
      <group position={[0, 0, -0.15]} rotation={[-0.7, 0, 0]}>
        <mesh castShadow position={[-0.08, 0.2, 0]} rotation={[0.3, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.045, 0.4, 10]} />
          <meshStandardMaterial color={pants} roughness={0.72} />
        </mesh>
        <mesh castShadow position={[0.1, 0.22, 0.12]} rotation={[-0.9, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.045, 0.36, 10]} />
          <meshStandardMaterial color={pants} roughness={0.72} />
        </mesh>
        <mesh castShadow position={[-0.08, 0.02, 0.06]}>
          <boxGeometry args={[0.09, 0.06, 0.16]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.6} />
        </mesh>
        <mesh castShadow position={[0.13, 0.06, 0.28]}>
          <boxGeometry args={[0.09, 0.06, 0.16]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.6} />
        </mesh>
        {/* torso */}
        <mesh castShadow position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.13, 0.15, 0.36, 14]} />
          <meshStandardMaterial color={shirt} roughness={0.66} />
        </mesh>
        {/* brazos abiertos manoteando */}
        {[-1, 1].map((s) => (
          <mesh key={s} castShadow position={[s * 0.2, 0.58, -0.02]} rotation={[0, 0, s * 1.1]}>
            <cylinderGeometry args={[0.032, 0.028, 0.34, 8]} />
            <meshStandardMaterial color={skin} roughness={0.55} />
          </mesh>
        ))}
        {/* cabeza tirada hacia atrás */}
        <mesh castShadow position={[0, 0.78, -0.06]}>
          <sphereGeometry args={[0.12, 16, 12]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.83, -0.09]}>
          <sphereGeometry args={[0.126, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.6]} />
          <meshStandardMaterial color={hair} roughness={0.8} />
        </mesh>
        {/* colita volando */}
        <mesh castShadow position={[0, 0.86, -0.2]} rotation={[0.6, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.02, 0.24, 8]} />
          <meshStandardMaterial color={hair} roughness={0.8} />
        </mesh>
      </group>
      {/* ── Pelota impactando en el pecho/cara ── */}
      <mesh castShadow position={[0, 0.62, 0.14]} scale={[1, 1, 0.9]}>
        <sphereGeometry args={[0.16, 20, 16]} />
        <meshStandardMaterial color={shell} roughness={0.55} />
      </mesh>
      {[[0, 0.16], [0.13, -0.05], [-0.13, -0.05]].map(([dx, dy], i) => (
        <mesh key={`panel-${i}`} position={[dx, 0.62 + dy, 0.28]} rotation={[0, 0, i]}>
          <circleGeometry args={[0.05, 5]} />
          <meshStandardMaterial color="#111827" roughness={0.6} side={DoubleSide} />
        </mesh>
      ))}
      {/* POW cómico en el impacto */}
      <mesh position={[0, 0.66, 0.26]}>
        <octahedronGeometry args={[0.17, 0]} />
        <meshStandardMaterial color="#facc15" roughness={0.55} emissive="#fde047" emissiveIntensity={0.35} flatShading />
      </mesh>
      <mesh position={[0, 0.66, 0.34]}>
        <MiniLabel text="POW!" background="#ef4444" color="#fde047" width={0.24} height={0.13} />
      </mesh>
    </group>
  );
}

function TeacherFiguresTrio({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const skin = "#f0c19a";
  // Cristina (rodete/bun, cardigan mostaza), Mirta (rulos, blusa turquesa),
  // 'La de la vinchuca' (pelo lacio, cardigan violeta) sostiene un frasquito.
  const teachers = [
    { x: -0.42, hair: "#5b3a22", top: "#d9a441", skirt: "#3a2f52", style: "bun", jar: false },
    { x: 0.0, hair: "#7a4a2c", top: "#2bb8a8", skirt: "#4a3a2a", style: "curly", jar: false },
    { x: 0.42, hair: "#20160f", top: "#8b5cf6", skirt: "#2d3550", style: "straight", jar: true },
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {teachers.map((t) => (
        <group key={t.x} position={[t.x, 0, 0]}>
          {/* falda modesta como base troncocónica apoyada en el piso */}
          <mesh castShadow receiveShadow position={[0, 0.19, 0]}>
            <cylinderGeometry args={[0.11, 0.17, 0.38, 14]} />
            <meshStandardMaterial color={t.skirt} roughness={0.8} />
          </mesh>
          {/* zapatos bajos asomando bajo la falda */}
          {[-0.06, 0.06].map((sx) => (
            <mesh key={sx} castShadow position={[sx, 0.025, 0.05]}>
              <boxGeometry args={[0.07, 0.05, 0.13]} />
              <meshStandardMaterial color="#3a2a20" roughness={0.7} />
            </mesh>
          ))}
          {/* torso: caja del cardigan/blusa */}
          <mesh castShadow position={[0, 0.5, 0]}>
            <boxGeometry args={[0.26, 0.28, 0.16]} />
            <meshStandardMaterial color={t.top} roughness={0.66} />
          </mesh>
          {/* solapa/cuello en V mas claro */}
          <mesh position={[0, 0.53, 0.082]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.09, 0.09, 0.01]} />
            <meshStandardMaterial color="#f5efe2" roughness={0.6} />
          </mesh>
          {/* brazos capsula pegados al cuerpo */}
          {[-0.17, 0.17].map((ax) => (
            <mesh key={ax} castShadow position={[ax, 0.47, 0]}>
              <capsuleGeometry args={[0.045, 0.22, 4, 8]} />
              <meshStandardMaterial color={t.top} roughness={0.66} />
            </mesh>
          ))}
          {/* manos */}
          {[-0.17, 0.17].map((hx) => (
            <mesh key={hx} position={[hx, 0.34, 0.01]}>
              <sphereGeometry args={[0.045, 10, 8]} />
              <meshStandardMaterial color={skin} roughness={0.55} />
            </mesh>
          ))}
          {/* cuello */}
          <mesh position={[0, 0.66, 0]}>
            <cylinderGeometry args={[0.045, 0.05, 0.06, 10]} />
            <meshStandardMaterial color={skin} roughness={0.55} />
          </mesh>
          {/* cabeza esfera con cara horneada */}
          <mesh castShadow position={[0, 0.76, 0]}>
            <sphereGeometry args={[0.11, 18, 14]} />
            <meshStandardMaterial color={skin} roughness={0.55} />
          </mesh>
          {/* ojos */}
          {[-0.042, 0.042].map((ex) => (
            <mesh key={ex} position={[ex, 0.78, 0.098]}>
              <sphereGeometry args={[0.017, 8, 8]} />
              <meshStandardMaterial color="#241a14" roughness={0.4} />
            </mesh>
          ))}
          {/* cachetes rosados */}
          {[-0.07, 0.07].map((cx) => (
            <mesh key={cx} position={[cx, 0.745, 0.093]}>
              <sphereGeometry args={[0.02, 8, 8]} />
              <meshStandardMaterial color="#e88f7a" roughness={0.6} transparent opacity={0.7} />
            </mesh>
          ))}
          {/* sonrisa: barrita curva */}
          <mesh position={[0, 0.735, 0.098]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.028, 0.008, 6, 12, Math.PI]} />
            <meshStandardMaterial color="#8a3324" roughness={0.5} />
          </mesh>
          {/* PELO por estilo */}
          {/* base de pelo comun: casquete cubriendo la parte de atras/arriba */}
          <mesh position={[0, 0.79, -0.01]}>
            <sphereGeometry args={[0.118, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
            <meshStandardMaterial color={t.hair} roughness={0.82} />
          </mesh>
          {t.style === "bun" && (
            <mesh castShadow position={[0, 0.88, -0.06]}>
              <sphereGeometry args={[0.055, 12, 10]} />
              <meshStandardMaterial color={t.hair} roughness={0.82} />
            </mesh>
          )}
          {t.style === "curly" &&
            [
              [-0.1, 0.83, 0.02],
              [0.1, 0.83, 0.02],
              [-0.11, 0.78, -0.05],
              [0.11, 0.78, -0.05],
              [0, 0.88, -0.02],
            ].map(([rx, ry, rz], i) => (
              <mesh key={i} castShadow position={[rx, ry, rz]}>
                <sphereGeometry args={[0.05, 10, 8]} />
                <meshStandardMaterial color={t.hair} roughness={0.85} />
              </mesh>
            ))}
          {t.style === "straight" &&
            [-0.09, 0.09].map((lx) => (
              <mesh key={lx} position={[lx, 0.72, -0.02]}>
                <boxGeometry args={[0.05, 0.16, 0.09]} />
                <meshStandardMaterial color={t.hair} roughness={0.82} />
              </mesh>
            ))}
          {/* La de la vinchuca: frasquito con bicho, en la mano derecha */}
          {t.jar && (
            <group position={[0.2, 0.35, 0.06]}>
              <mesh castShadow position={[0, 0.02, 0]}>
                <cylinderGeometry args={[0.05, 0.05, 0.11, 14]} />
                <meshStandardMaterial color="#bfe3ea" roughness={0.12} metalness={0.05} transparent opacity={0.4} />
              </mesh>
              <mesh position={[0, 0.085, 0]}>
                <cylinderGeometry args={[0.05, 0.05, 0.02, 14]} />
                <meshStandardMaterial color="#7f8b96" roughness={0.4} metalness={0.6} />
              </mesh>
              {/* vinchuca dentro: cuerpo ovalado oscuro con franja naranja */}
              <mesh position={[0, 0.0, 0]} scale={[1.25, 0.5, 1]}>
                <sphereGeometry args={[0.03, 12, 8]} />
                <meshStandardMaterial color="#2a1c14" roughness={0.55} />
              </mesh>
              <mesh position={[0, 0.0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.028, 0.04, 12]} />
                <meshStandardMaterial color="#f97316" side={DoubleSide} />
              </mesh>
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

function GiantGroinCup({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const shell = "#eef1f4";
  const shellShade = "#c7ccd2";
  const foam = "#9aa0a8";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* CASCARON: media elipsoide de plastico duro brillante (mitad superior de una esfera aplastada) */}
      <mesh castShadow receiveShadow position={[0, 0.34, 0]} scale={[1, 1.15, 0.72]}>
        <sphereGeometry args={[0.62, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={shell} roughness={0.18} metalness={0.08} />
      </mesh>
      {/* punta redondeada abultada al frente (forma de protector) */}
      <mesh castShadow position={[0, 0.28, 0.34]} scale={[0.8, 0.9, 0.7]}>
        <sphereGeometry args={[0.42, 22, 16]} />
        <meshStandardMaterial color={shell} roughness={0.18} metalness={0.08} />
      </mesh>
      {/* linea de costura central baked (barrita hundida por el medio) */}
      <mesh position={[0, 0.7, 0.02]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[0.02, 0.02, 0.9]} />
        <meshStandardMaterial color={shellShade} roughness={0.4} />
      </mesh>
      {/* costuras laterales curvas */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.4, 0.42, 0.06]} rotation={[0, 0, s * 0.5]}>
          <boxGeometry args={[0.018, 0.62, 0.018]} />
          <meshStandardMaterial color={shellShade} roughness={0.4} />
        </mesh>
      ))}
      {/* agujeros de ventilacion baked: hileras de puntitos oscuros hundidos */}
      {[0, 1, 2].map((row) =>
        [-2, -1, 0, 1, 2].map((col) => (
          <mesh key={`v${row}-${col}`} position={[col * 0.14, 0.5 + row * 0.13, 0.36 - row * 0.06]}>
            <sphereGeometry args={[0.022, 8, 8]} />
            <meshStandardMaterial color="#5a616a" roughness={0.6} />
          </mesh>
        ))
      )}
      {/* RIM ACOLCHADO: toro grueso gris-espuma en la base */}
      <mesh castShadow receiveShadow position={[0, 0.14, 0.02]} scale={[1, 1, 0.78]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.6, 0.12, 14, 32]} />
        <meshStandardMaterial color={foam} roughness={0.9} />
      </mesh>
      {/* LAZOS DE CORREA: dos arcos finos de toro a los costados */}
      {[-1, 1].map((s) => (
        <mesh key={`strap${s}`} castShadow position={[s * 0.6, 0.24, -0.16]} rotation={[Math.PI / 2, 0, s * 0.4]}>
          <torusGeometry args={[0.14, 0.022, 8, 20, Math.PI * 1.3]} />
          <meshStandardMaterial color="#3f4650" roughness={0.7} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
}

function SleepingBag({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Bolsa de dormir enrollada y atada con dos correas (rollo de camping), con
  // el espiral del enrollado visible en las puntas.
  const bag = "#c0392b";
  const bagDark = "#8e2a1f";
  const strap = "#2b2f36";
  const R = 0.24;
  const L = 0.9;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* rollo principal acostado */}
      <mesh castShadow receiveShadow position={[0, R, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[R, R, L, 24]} />
        <meshStandardMaterial color={bag} roughness={0.85} />
      </mesh>
      {/* espiral del enrollado en las dos puntas */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (L / 2 + 0.006), R, 0]}>
          {[R, R * 0.66, R * 0.34].map((rr, i) => (
            <mesh key={i} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[rr, 0.02, 8, 24]} />
              <meshStandardMaterial color={i % 2 ? bagDark : bag} roughness={0.85} />
            </mesh>
          ))}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.03, 0.03, 0.02, 10]} />
            <meshStandardMaterial color={bagDark} roughness={0.85} />
          </mesh>
        </group>
      ))}
      {/* pliegues longitudinales del acolchado */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh key={`fold-${i}`} position={[0, R + Math.cos(a) * (R - 0.004), Math.sin(a) * (R - 0.004)]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.012, 0.012, L - 0.02, 6]} />
            <meshStandardMaterial color={bagDark} roughness={0.9} />
          </mesh>
        );
      })}
      {/* dos correas negras con hebilla */}
      {[-0.26, 0.26].map((x) => (
        <group key={`strap-${x}`}>
          <mesh position={[x, R, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[R + 0.012, 0.018, 8, 24]} />
            <meshStandardMaterial color={strap} roughness={0.7} />
          </mesh>
          <mesh position={[x, R * 2 + 0.02, 0]}>
            <boxGeometry args={[0.05, 0.04, 0.03]} />
            <meshStandardMaterial color="#9aa0a8" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CrazyTongueToy({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Lengua larga y súper flexible (party-blower): cadena de segmentos fleshy
  // que se enrolla y desenrolla ondulando, viva.
  const pink = "#f4517b";
  const litePink = shade(pink, 1.16);
  const deepPink = shade(pink, 0.72);
  const N = 12;
  const SEG = 0.1;
  const segRefs = useRef<{ position: { set: (x: number, y: number, z: number) => void }; rotation: { x: number } }[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const uncurl = 0.5 + 0.5 * Math.sin(t * 1.5); // 0 enrollada … 1 estirada
    let y = 0.24;
    let z = 0.02;
    let ang = 0.55;
    for (let i = 0; i < N; i++) {
      const wave = 0.14 * Math.sin(t * 4 - i * 0.6);
      const curl = 0.16 + (1 - uncurl) * 0.32 + wave * 0.4;
      const seg = segRefs.current[i];
      if (seg) {
        seg.position.set(0, y + Math.sin(ang) * SEG * 0.5, z + Math.cos(ang) * SEG * 0.5);
        seg.rotation.x = ang - Math.PI / 2;
      }
      y += Math.sin(ang) * SEG;
      z += Math.cos(ang) * SEG;
      ang += curl;
    }
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* boquilla de donde nace la lengua */}
      <mesh castShadow receiveShadow position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.17, 0.2, 0.1, 20]} />
        <meshStandardMaterial color="#fbbf24" roughness={0.5} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.15, 0.028, 8, 22]} />
        <meshStandardMaterial color="#f97316" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.11, 0.14, 0.12, 18]} />
        <meshStandardMaterial color={deepPink} roughness={0.4} />
      </mesh>
      {/* segmentos fleshy de la lengua (posicionados cada frame) */}
      {Array.from({ length: N }).map((_, i) => {
        const tt = i / (N - 1);
        const w = 0.17 - tt * 0.1;
        return (
          <mesh key={i} ref={(el) => { if (el) segRefs.current[i] = el; }} castShadow scale={[w / 0.08, 0.5, 1]}>
            <sphereGeometry args={[0.08, 12, 10]} />
            <meshStandardMaterial color={i % 2 ? litePink : pink} roughness={0.3} metalness={0.05} />
          </mesh>
        );
      })}
    </group>
  );
}

function JonyDuckWindow({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const plaster = "#e6d4b0";
  const wood = "#9a6b3a";
  const glass = "#cfeaf3";
  const wallW = 1.5;
  const wallH = 0.66; // baja: un personaje se agacha por debajo del alfeizar
  const wallD = 0.16;
  const openW = 0.66;
  const openH = 0.34;
  const openCX = 0;
  const openBottom = 0.24; // alfeizar bajo
  const sideW = (wallW - openW) / 2;
  const topH = wallH - (openBottom + openH);
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* Muro de revoque, con el vano recortado en tres piezas (dos lados + dintel) */}
      {[-1, 1].map((s) => (
        <mesh key={`side-${s}`} castShadow receiveShadow position={[s * (openW / 2 + sideW / 2), wallH / 2, 0]}>
          <boxGeometry args={[sideW, wallH, wallD]} />
          <meshStandardMaterial color={plaster} roughness={0.85} />
        </mesh>
      ))}
      {/* Franja bajo la ventana (alfeizar interior de revoque) */}
      <mesh castShadow receiveShadow position={[openCX, openBottom / 2, 0]}>
        <boxGeometry args={[openW, openBottom, wallD]} />
        <meshStandardMaterial color={plaster} roughness={0.85} />
      </mesh>
      {/* Dintel sobre la ventana */}
      <mesh castShadow receiveShadow position={[openCX, openBottom + openH + topH / 2, 0]}>
        <boxGeometry args={[openW, topH, wallD]} />
        <meshStandardMaterial color={plaster} roughness={0.85} />
      </mesh>
      {/* Zocalo de contraste al pie del muro */}
      <mesh position={[0, 0.05, wallD / 2 + 0.005]}>
        <boxGeometry args={[wallW, 0.1, 0.02]} />
        <meshStandardMaterial color={shade(plaster, 0.78)} roughness={0.85} />
      </mesh>
      {/* Marco de madera del vano (dos listones verticales + dos horizontales) */}
      {[-1, 1].map((s) => (
        <mesh key={`jamb-${s}`} castShadow position={[openCX + s * (openW / 2 + 0.02), openBottom + openH / 2, wallD / 2 - 0.02]}>
          <boxGeometry args={[0.06, openH + 0.1, 0.1]} />
          <meshStandardMaterial color={wood} roughness={0.72} />
        </mesh>
      ))}
      {[openBottom - 0.01, openBottom + openH + 0.01].map((y, i) => (
        <mesh key={`rail-${i}`} castShadow position={[openCX, y, wallD / 2 - 0.02]}>
          <boxGeometry args={[openW + 0.14, 0.07, 0.1]} />
          <meshStandardMaterial color={i === 0 ? shade(wood, 1.12) : wood} roughness={0.72} />
        </mesh>
      ))}
      {/* Alfeizar/repisa saliente de madera clara */}
      <mesh castShadow position={[openCX, openBottom - 0.03, wallD / 2 + 0.04]}>
        <boxGeometry args={[openW + 0.22, 0.05, 0.16]} />
        <meshStandardMaterial color={shade(wood, 1.2)} roughness={0.6} />
      </mesh>
      {/* Vidrio: panel translucido con un parteluz vertical */}
      <mesh position={[openCX, openBottom + openH / 2, 0]}>
        <boxGeometry args={[openW - 0.02, openH - 0.02, 0.02]} />
        <meshStandardMaterial color={glass} roughness={0.12} metalness={0.05} transparent opacity={0.42} side={DoubleSide} />
      </mesh>
      <mesh position={[openCX, openBottom + openH / 2, wallD / 2 - 0.02]}>
        <boxGeometry args={[0.03, openH, 0.05]} />
        <meshStandardMaterial color={shade(wood, 1.1)} roughness={0.7} />
      </mesh>
      {/* Borde de cortina baked asomando por arriba a un costado */}
      <mesh position={[openCX - openW / 2 + 0.1, openBottom + openH - 0.03, wallD / 2 - 0.03]}>
        <boxGeometry args={[0.12, openH * 0.55, 0.02]} />
        <meshStandardMaterial color="#d94f6a" roughness={0.7} side={DoubleSide} />
      </mesh>
    </group>
  );
}

function FlyingChair({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const plastic = "#3b82f6";
  const litePlastic = shade(plastic, 1.15);
  const chrome = "#c2c8d0";
  // La silla entera flota inclinada, como en pleno lanzamiento.
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* Disco de sombra tenue en el piso (hover) */}
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.34, 28]} />
        <meshStandardMaterial color="#1e293b" roughness={0.9} transparent opacity={0.22} />
      </mesh>
      {/* Grupo de la silla suspendida e inclinada (mid-throw) */}
      <group position={[0, 0.66, 0]} rotation={[0.5, 0.3, -0.35]}>
        {/* Asiento */}
        <mesh castShadow receiveShadow position={[0, 0, 0]}>
          <boxGeometry args={[0.44, 0.06, 0.42]} />
          <meshStandardMaterial color={plastic} roughness={0.4} metalness={0.06} />
        </mesh>
        {/* Bisel superior del asiento */}
        <mesh position={[0, 0.04, 0]}>
          <boxGeometry args={[0.38, 0.02, 0.36]} />
          <meshStandardMaterial color={litePlastic} roughness={0.35} />
        </mesh>
        {/* Respaldo */}
        <mesh castShadow position={[0, 0.26, -0.19]} rotation={[-0.12, 0, 0]}>
          <boxGeometry args={[0.4, 0.34, 0.05]} />
          <meshStandardMaterial color={plastic} roughness={0.4} metalness={0.06} />
        </mesh>
        {/* Ranura baked del respaldo */}
        <mesh position={[0, 0.28, -0.166]} rotation={[-0.12, 0, 0]}>
          <boxGeometry args={[0.28, 0.05, 0.02]} />
          <meshStandardMaterial color={shade(plastic, 0.7)} roughness={0.5} />
        </mesh>
        {/* Postes que unen respaldo y asiento */}
        {[-0.17, 0.17].map((x) => (
          <mesh key={`post-${x}`} castShadow position={[x, 0.11, -0.185]}>
            <cylinderGeometry args={[0.02, 0.02, 0.22, 10]} />
            <meshStandardMaterial color={chrome} roughness={0.4} metalness={0.6} />
          </mesh>
        ))}
        {/* Tres patas (la cuarta salio despedida) */}
        {([[-0.17, 0.17], [0.17, 0.17], [0.17, -0.17]] as [number, number][]).map(([x, z], i) => (
          <mesh key={`leg-${i}`} castShadow position={[x, -0.19, z]}>
            <cylinderGeometry args={[0.022, 0.026, 0.32, 10]} />
            <meshStandardMaterial color={chrome} roughness={0.4} metalness={0.6} />
          </mesh>
        ))}
      </group>
      {/* Pata suelta girando por el aire, aparte */}
      <mesh castShadow position={[0.42, 0.44, 0.24]} rotation={[0.9, 0, 1.2]}>
        <cylinderGeometry args={[0.022, 0.026, 0.3, 10]} />
        <meshStandardMaterial color={chrome} roughness={0.4} metalness={0.6} />
      </mesh>
      {/* Swooshes de movimiento: arcos blancos finos (mitades de toro) */}
      {[
        [0.34, 0.5, -0.28, 0.4],
        [0.42, 0.72, -0.18, 0.32],
        [0.28, 0.34, -0.34, 0.3],
      ].map(([x, y, z, r], i) => (
        <mesh key={`swoosh-${i}`} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0.6]}>
          <torusGeometry args={[r, 0.012, 6, 14, Math.PI * 0.8]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.5} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Kiosco24({ position, rotationY = 0, scale = 1, label }: AssetProps & { label?: string }) {
  const signTexture = useMemo(() => makeLabelTexture(label ?? "24HS", "#123c7c", "#fef3c7"), [label]);
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.32, 0]}>
        <boxGeometry args={[0.92, 0.58, 0.68]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      {[-0.28, 0, 0.28].map((x) => (
        <mesh key={x} position={[x, 0.33, 0.346]}>
          <boxGeometry args={[0.12, 0.5, 0.018]} />
          <meshStandardMaterial color="#38bdf8" roughness={0.42} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.66, 0]}>
        <boxGeometry args={[1.06, 0.16, 0.78]} />
        <meshStandardMaterial color="#ef4444" roughness={0.45} />
      </mesh>
      <mesh castShadow position={[0, 0.78, 0.01]}>
        <boxGeometry args={[1.16, 0.09, 0.86]} />
        <meshStandardMaterial color="#facc15" roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.77, 0.445]}>
        <planeGeometry args={[0.56, 0.22]} />
        <meshBasicMaterial map={signTexture} toneMapped={false} />
      </mesh>
      <mesh position={[-0.22, 0.24, 0.358]}>
        <boxGeometry args={[0.22, 0.34, 0.02]} />
        <meshStandardMaterial color="#1f2937" roughness={0.35} />
      </mesh>
      <mesh position={[0.2, 0.36, 0.358]}>
        <boxGeometry args={[0.32, 0.22, 0.02]} />
        <meshStandardMaterial color="#bae6fd" emissive="#38bdf8" emissiveIntensity={0.2} roughness={0.2} />
      </mesh>
      {[-0.35, 0.35].map((x) => (
        <mesh key={x} position={[x, 0.12, 0.37]}>
          <boxGeometry args={[0.16, 0.12, 0.08]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function KioskBagNoFuiYo({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Bolsa de kiosco translúcida, arrugada y panzona por algo oscuro adentro,
  // apoyada medio desplomada. Rótulo garabateado 'NO FUI YO' al frente.
  const plastic = "#eef3f6";
  const shadowFold = "#c7d2da";
  return (
    <group position={position} rotation={[0, rotationY, 0.09]} scale={[scale, scale, scale]}>
      {/* objeto oscuro y lumpudo adentro (silueta de caja) */}
      <mesh castShadow position={[0.02, 0.19, 0]} rotation={[0, 0.3, 0.12]}>
        <boxGeometry args={[0.3, 0.26, 0.22]} />
        <meshStandardMaterial color="#2a2622" roughness={0.85} />
      </mesh>
      {/* cuerpo panzón de la bolsa, translúcido y arrugado */}
      <mesh castShadow receiveShadow position={[0, 0.24, 0]}>
        <boxGeometry args={[0.46, 0.44, 0.34]} />
        <meshStandardMaterial color={plastic} roughness={0.42} metalness={0.02} transparent opacity={0.72} />
      </mesh>
      {/* panza inflada extra (esfera achatada) que empuja la caja hacia afuera */}
      <mesh position={[0.04, 0.2, 0.03]} scale={[1.15, 0.9, 1.05]}>
        <sphereGeometry args={[0.24, 14, 10]} />
        <meshStandardMaterial color={plastic} roughness={0.4} metalness={0.02} transparent opacity={0.6} />
      </mesh>
      {/* arrugas verticales baked como finas cintas más oscuras */}
      {[-0.16, -0.04, 0.09, 0.18].map((x, i) => (
        <mesh key={x} position={[x, 0.24, 0.176]} rotation={[0, 0, i % 2 ? 0.14 : -0.1]}>
          <boxGeometry args={[0.02, 0.4, 0.006]} />
          <meshStandardMaterial color={shadowFold} roughness={0.5} transparent opacity={0.55} />
        </mesh>
      ))}
      {/* arruga cruzada en la panza */}
      <mesh position={[-0.02, 0.31, 0.18]} rotation={[0, 0, 0.5]}>
        <boxGeometry args={[0.02, 0.22, 0.006]} />
        <meshStandardMaterial color={shadowFold} roughness={0.5} transparent opacity={0.5} />
      </mesh>
      {/* boca fruncida de la bolsa, arriba, donde se juntan las asas */}
      <mesh position={[0, 0.47, 0]}>
        <boxGeometry args={[0.3, 0.05, 0.2]} />
        <meshStandardMaterial color={shade(plastic, 0.9)} roughness={0.5} transparent opacity={0.78} />
      </mesh>
      {/* dos asas atadas en lazo (arcos de torus) */}
      {[-0.12, 0.12].map((x) => (
        <mesh key={x} castShadow position={[x, 0.53, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.075, 0.014, 8, 20, Math.PI * 1.35]} />
          <meshStandardMaterial color={plastic} roughness={0.44} transparent opacity={0.82} />
        </mesh>
      ))}
      {/* nudito central donde se anudan las asas */}
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color={shade(plastic, 0.86)} roughness={0.5} transparent opacity={0.85} />
      </mesh>
      {/* rótulo garabateado 'NO FUI YO' al frente */}
      <mesh position={[0, 0.26, 0.181]} rotation={[0, 0, -0.05]}>
        <MiniLabel text="NO FUI YO" background="#fef9c3" color="#b91c1c" width={0.4} height={0.15} />
      </mesh>
    </group>
  );
}

function TinyTrophyChiquito({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Trofeo cómicamente diminuto: copa dorada (cuenco de cono invertido + tallo +
  // disco), dos asas de lazo y placa grabada, todo sobre un plinto oscuro.
  const gold = "#f5b70a";
  const goldHi = "#ffe07a";
  const plinth = "#3f2d1a";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* plinto: base ancha + escalón */}
      <mesh castShadow receiveShadow position={[0, 0.045, 0]}>
        <boxGeometry args={[0.34, 0.09, 0.28]} />
        <meshStandardMaterial color={plinth} roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, 0.11, 0]}>
        <boxGeometry args={[0.24, 0.05, 0.2]} />
        <meshStandardMaterial color={shade(plinth, 1.25)} roughness={0.58} />
      </mesh>
      {/* placa grabada al frente del plinto */}
      <mesh position={[0, 0.05, 0.141]}>
        <MiniLabel text="1o" background="#fde68a" color="#7c2d12" width={0.12} height={0.06} />
      </mesh>
      {/* disco base dorado de la copa */}
      <mesh castShadow position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.09, 0.11, 0.03, 20]} />
        <meshStandardMaterial color={gold} metalness={0.82} roughness={0.24} />
      </mesh>
      {/* tallo */}
      <mesh castShadow position={[0, 0.215, 0]}>
        <cylinderGeometry args={[0.022, 0.03, 0.08, 14]} />
        <meshStandardMaterial color={gold} metalness={0.82} roughness={0.22} />
      </mesh>
      {/* nudo del tallo */}
      <mesh position={[0, 0.255, 0]}>
        <sphereGeometry args={[0.032, 12, 10]} />
        <meshStandardMaterial color={goldHi} metalness={0.8} roughness={0.2} />
      </mesh>
      {/* cuenco: cono invertido (radio grande arriba) */}
      <mesh castShadow position={[0, 0.315, 0]}>
        <cylinderGeometry args={[0.11, 0.05, 0.13, 20]} />
        <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} />
      </mesh>
      {/* labio brillante del cuenco */}
      <mesh position={[0, 0.382, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.105, 0.014, 10, 24]} />
        <meshStandardMaterial color={goldHi} metalness={0.8} roughness={0.18} />
      </mesh>
      {/* dos asas de lazo (arcos de torus) a los costados */}
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * 0.12, 0.33, 0]} rotation={[Math.PI / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2]}>
          <torusGeometry args={[0.045, 0.011, 8, 18, Math.PI * 1.1]} />
          <meshStandardMaterial color={gold} metalness={0.82} roughness={0.22} />
        </mesh>
      ))}
    </group>
  );
}

function SillyFlamingoFloat({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Flotador inflable ridículo con forma de flamenco: anillo gordo (torus),
  // cuello curvo, cabeza con ojo y pico, aspecto inflado y brilloso con costuras.
  const pink = "#fb5c9a";
  const pinkDeep = "#e03a7d";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* anillo gordo inflado, apoyado en el suelo/agua */}
      <mesh castShadow receiveShadow position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.4, 0.16, 16, 32]} />
        <meshStandardMaterial color={pink} roughness={0.28} metalness={0.05} />
      </mesh>
      {/* costuras baked: dos anillos finos alrededor del tubo */}
      <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.4, 0.162, 6, 32]} />
        <meshStandardMaterial color={pinkDeep} roughness={0.4} wireframe />
      </mesh>
      {/* segmentos inflados (bultos) marcando gajos del flotador */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.4, 0.16, Math.sin(a) * 0.4]} scale={[1.05, 1.05, 1.05]}>
            <sphereGeometry args={[0.15, 10, 8]} />
            <meshStandardMaterial color={pink} roughness={0.26} metalness={0.05} />
          </mesh>
        );
      })}
      {/* cuello curvo del flamenco, sube desde el borde del anillo */}
      <mesh castShadow position={[0, 0.36, 0.36]} rotation={[0.55, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.09, 0.42, 14]} />
        <meshStandardMaterial color={pink} roughness={0.28} metalness={0.05} />
      </mesh>
      {/* tramo superior del cuello, curvándose hacia adelante */}
      <mesh castShadow position={[0, 0.56, 0.5]} rotation={[1.1, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.24, 14]} />
        <meshStandardMaterial color={pink} roughness={0.28} metalness={0.05} />
      </mesh>
      {/* cabeza */}
      <mesh castShadow position={[0, 0.6, 0.62]}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshStandardMaterial color={pink} roughness={0.26} metalness={0.05} />
      </mesh>
      {/* pico cónico blanco con punta oscura */}
      <mesh castShadow position={[0, 0.57, 0.73]} rotation={[Math.PI / 2 + 0.35, 0, 0]}>
        <coneGeometry args={[0.035, 0.13, 12]} />
        <meshStandardMaterial color="#fef3c7" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.535, 0.79]} rotation={[Math.PI / 2 + 0.35, 0, 0]}>
        <coneGeometry args={[0.02, 0.05, 10]} />
        <meshStandardMaterial color="#1f2937" roughness={0.5} />
      </mesh>
      {/* ojos baked a los dos lados de la cabeza */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.06, 0.63, 0.66]}>
          <sphereGeometry args={[0.022, 10, 8]} />
          <meshStandardMaterial color="#111827" roughness={0.35} />
        </mesh>
      ))}
      {/* mancha de luz/reflejo inflado sobre el anillo (brillo) */}
      <mesh position={[-0.28, 0.26, 0.2]} scale={[1, 0.5, 1]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color="#ffd0e4" roughness={0.2} metalness={0.1} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function BrokenUmbrellaProp({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const fabric = "#2563eb";
  const fabricDark = "#1d4ed8";
  const rib = "#374151";
  const shaft = "#4b5563";
  // 8 gajos alrededor del eje: la mayoría caídos, un par volteados hacia arriba, uno colgando
  const panels = [
    { a: 0, state: "ok" as const },
    { a: Math.PI / 4, state: "ok" as const },
    { a: Math.PI / 2, state: "flip" as const },
    { a: (3 * Math.PI) / 4, state: "ok" as const },
    { a: Math.PI, state: "loose" as const },
    { a: (5 * Math.PI) / 4, state: "flip" as const },
    { a: (3 * Math.PI) / 2, state: "ok" as const },
    { a: (7 * Math.PI) / 4, state: "torn" as const },
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* eje central inclinado, como abandonado */}
      <group rotation={[0, 0, 0.16]}>
        {/* asta */}
        <mesh castShadow position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.028, 0.032, 0.84, 10]} />
          <meshStandardMaterial color={shaft} roughness={0.5} metalness={0.25} />
        </mesh>
        {/* virola en la punta */}
        <mesh position={[0, 0.9, 0]}>
          <coneGeometry args={[0.03, 0.1, 8]} />
          <meshStandardMaterial color="#9ca3af" roughness={0.4} metalness={0.4} />
        </mesh>
        {/* cubo/collar donde nacen los gajos */}
        <mesh position={[0, 0.82, 0]}>
          <cylinderGeometry args={[0.05, 0.06, 0.07, 10]} />
          <meshStandardMaterial color={rib} roughness={0.5} metalness={0.2} />
        </mesh>
        {/* gajos de tela (cono-segmento por gajo) con costillas */}
        {panels.map((p, i) => {
          const isFlip = p.state === "flip";
          const isLoose = p.state === "loose";
          const isTorn = p.state === "torn";
          // gajo caído normal apunta hacia afuera y abajo; volteado apunta arriba
          const tilt = isFlip ? -0.5 : isLoose ? 1.35 : 0.85;
          const col = i % 2 === 0 ? fabric : fabricDark;
          return (
            <group key={i} position={[0, 0.8, 0]} rotation={[0, p.a, 0]}>
              <group rotation={[tilt, 0, 0]}>
                {/* panel triangular de tela (gajo) */}
                {!isTorn && (
                  <mesh castShadow position={[0, 0, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
                    <coneGeometry args={[0.2, 0.56, 4, 1, true, 0, Math.PI / 3.4]} />
                    <meshStandardMaterial color={col} roughness={0.66} side={DoubleSide} flatShading />
                  </mesh>
                )}
                {/* costilla metálica del gajo */}
                <mesh position={[0, 0, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.008, 0.008, 0.56, 6]} />
                  <meshStandardMaterial color={rib} roughness={0.45} metalness={0.35} />
                </mesh>
                {/* costilla doblada hacia afuera en el gajo roto (torn): puntal quebrado */}
                {isTorn && (
                  <mesh position={[0.02, 0.06, 0.34]} rotation={[Math.PI / 2 - 0.5, 0.3, 0]}>
                    <cylinderGeometry args={[0.008, 0.008, 0.4, 6]} />
                    <meshStandardMaterial color={rib} roughness={0.45} metalness={0.35} />
                  </mesh>
                )}
              </group>
            </group>
          );
        })}
        {/* jirón de tela suelto que cuelga flameando (loose flap) */}
        <mesh position={[0, 0.62, -0.34]} rotation={[0.9, 0, 0.2]}>
          <planeGeometry args={[0.22, 0.3]} />
          <meshStandardMaterial color={fabricDark} roughness={0.7} side={DoubleSide} flatShading />
        </mesh>
      </group>
      {/* mango curvo tipo bastón (dos tramos: recto + gancho) */}
      <mesh castShadow position={[0.07, 0.05, 0]} rotation={[0, 0, 0.16]}>
        <cylinderGeometry args={[0.03, 0.03, 0.12, 8]} />
        <meshStandardMaterial color={"#7c3f1d"} roughness={0.55} />
      </mesh>
      <mesh castShadow position={[0.16, 0.06, 0]} rotation={[0, 0, Math.PI / 2 + 0.35]}>
        <cylinderGeometry args={[0.028, 0.028, 0.16, 8]} />
        <meshStandardMaterial color={"#7c3f1d"} roughness={0.55} />
      </mesh>
      <mesh position={[0.25, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.07, 0.028, 8, 14, Math.PI]} />
        <meshStandardMaterial color={"#7c3f1d"} roughness={0.55} />
      </mesh>
      {/* charquito/sombra de post-tormenta bajo el objeto */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.34, 20]} />
        <meshStandardMaterial color={"#3b82f6"} roughness={0.3} transparent opacity={0.28} />
      </mesh>
    </group>
  );
}

function MegaphoneProp({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const red = "#ef4444";
  const white = "#f8fafc";
  const grip = "#1f2937";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* mango tipo pistola apoyado en el piso */}
      <mesh castShadow position={[0, 0.16, -0.14]} rotation={[0.35, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.055, 0.32, 12]} />
        <meshStandardMaterial color={grip} roughness={0.6} />
      </mesh>
      {/* gatillo */}
      <mesh position={[0, 0.2, -0.02]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.04, 0.07, 0.03]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.5} />
      </mesh>
      {/* cuerpo del parlante con botón HABLA */}
      <mesh castShadow position={[0, 0.34, -0.02]}>
        <boxGeometry args={[0.22, 0.2, 0.24]} />
        <meshStandardMaterial color={white} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.34, 0.101]}>
        <MiniLabel text="HABLA" background="#facc15" color="#7f1d1d" width={0.16} height={0.08} />
      </mesh>
      {/* garganta hacia la bocina */}
      <mesh castShadow position={[0, 0.4, 0.18]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.13, 0.14, 20]} />
        <meshStandardMaterial color={red} roughness={0.42} />
      </mesh>
      {/* bocina que se abre hacia adelante */}
      <mesh castShadow position={[0, 0.42, 0.42]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.13, 0.42, 24, 1, true]} />
        <meshStandardMaterial color={red} roughness={0.42} side={DoubleSide} />
      </mesh>
      {/* labio blanco del borde */}
      <mesh position={[0, 0.42, 0.63]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.31, 0.03, 10, 28]} />
        <meshStandardMaterial color={white} roughness={0.45} />
      </mesh>
      {/* interior oscuro de la bocina */}
      <mesh position={[0, 0.42, 0.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.29, 24]} />
        <meshStandardMaterial color="#7f1d1d" roughness={0.7} side={DoubleSide} />
      </mesh>
    </group>
  );
}

function StopwatchProp({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const chrome = "#cbd5e1";
  const chromeDark = "#94a3b8";
  const dial = "#f8fafc";
  const hand = "#1f2937";
  const sweep = "#ef4444";
  // 12 marcas de tick alrededor del dial
  const ticks = Array.from({ length: 12 }, (_, i) => (i * Math.PI * 2) / 12);
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* parado sobre el canto, cara mirando al frente (+Z) */}
      <group position={[0, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]}>
        {/* caja/carcasa cromada (disco corto) */}
        <mesh castShadow>
          <cylinderGeometry args={[0.36, 0.36, 0.11, 32]} />
          <meshStandardMaterial color={chrome} roughness={0.28} metalness={0.55} />
        </mesh>
        {/* bisel más oscuro del borde */}
        <mesh position={[0, 0.056, 0]}>
          <torusGeometry args={[0.35, 0.03, 10, 32]} />
          <meshStandardMaterial color={chromeDark} roughness={0.3} metalness={0.6} />
        </mesh>
        {/* esfera blanca */}
        <mesh position={[0, 0.058, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.32, 40]} />
          <meshStandardMaterial color={dial} roughness={0.35} />
        </mesh>
        {/* marcas de tick */}
        {ticks.map((a, i) => (
          <mesh key={i} position={[Math.sin(a) * 0.27, 0.062, Math.cos(a) * 0.27]} rotation={[0, a, 0]}>
            <boxGeometry args={[0.016, 0.006, i % 3 === 0 ? 0.06 : 0.035]} />
            <meshStandardMaterial color={i % 3 === 0 ? "#111827" : "#6b7280"} roughness={0.6} />
          </mesh>
        ))}
        {/* manecilla de minutos (corta) */}
        <mesh position={[0.05, 0.066, 0.08]} rotation={[0, -0.6, 0]}>
          <boxGeometry args={[0.02, 0.006, 0.16]} />
          <meshStandardMaterial color={hand} roughness={0.5} />
        </mesh>
        {/* manecilla de horas (larga) */}
        <mesh position={[-0.03, 0.066, -0.02]} rotation={[0, 1.2, 0]}>
          <boxGeometry args={[0.024, 0.006, 0.22]} />
          <meshStandardMaterial color={hand} roughness={0.5} />
        </mesh>
        {/* segundero rojo de barrido (fino y largo) */}
        <mesh position={[0.02, 0.07, 0.02]} rotation={[0, -1.9, 0]}>
          <boxGeometry args={[0.012, 0.006, 0.29]} />
          <meshStandardMaterial color={sweep} roughness={0.4} />
        </mesh>
        {/* eje central */}
        <mesh position={[0, 0.074, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.02, 14]} />
          <meshStandardMaterial color={"#111827"} roughness={0.4} metalness={0.3} />
        </mesh>
      </group>
      {/* corona/botón superior */}
      <mesh castShadow position={[0, 0.74, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 0.07, 16]} />
        <meshStandardMaterial color={chromeDark} roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0.79, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.04, 16]} />
        <meshStandardMaterial color={chrome} roughness={0.28} metalness={0.6} />
      </mesh>
      {/* orejetas laterales del cuello */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.09, 0.68, 0]}>
          <boxGeometry args={[0.05, 0.05, 0.12]} />
          <meshStandardMaterial color={chromeDark} roughness={0.3} metalness={0.55} />
        </mesh>
      ))}
      {/* anilla para el cordón */}
      <mesh position={[0, 0.83, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.04, 0.012, 8, 18]} />
        <meshStandardMaterial color={chrome} roughness={0.3} metalness={0.6} />
      </mesh>
      {/* sombra de contacto */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.3, 20]} />
        <meshStandardMaterial color={"#0f172a"} roughness={0.9} transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

function LuckySock({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const wool = "#e7ecf3";
  const grime = "#c3ccd8";
  const stripe = "#d24545";
  const stripe2 = "#3b74c9";
  const hole = "#2b3444";
  // media peluda peleada: caña acostada (X) + pie levantado 90° hacia +Z
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* caña (tobillo) acostada, apenas desinflada */}
      <mesh castShadow receiveShadow position={[-0.18, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.15, 0.62, 16]} />
        <meshStandardMaterial color={wool} roughness={0.95} />
      </mesh>
      {/* elástico del borde superior (abertura, extremo -X) */}
      <mesh position={[-0.5, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.17, 0.17, 0.09, 16]} />
        <meshStandardMaterial color={grime} roughness={0.98} />
      </mesh>
      {/* agujero oscuro de la abertura */}
      <mesh position={[-0.545, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.135, 0.135, 0.02, 16]} />
        <meshStandardMaterial color={hole} roughness={1} />
      </mesh>
      {/* bandas de color en la caña */}
      {[-0.02, 0.14, 0.3].map((offX, i) => (
        <mesh key={offX} position={[offX, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.163, 0.153, 0.07, 16]} />
          <meshStandardMaterial color={i % 2 === 0 ? stripe : stripe2} roughness={0.9} />
        </mesh>
      ))}
      {/* talón: codo redondeado donde la caña dobla hacia el pie */}
      <mesh castShadow receiveShadow position={[0.12, 0.12, 0]}>
        <sphereGeometry args={[0.16, 16, 14]} />
        <meshStandardMaterial color={wool} roughness={0.95} />
      </mesh>
      {/* pie: caja tumbada apuntando a +Z (doblez de 90°), talón abajo */}
      <mesh castShadow receiveShadow position={[0.14, 0.1, 0.24]}>
        <boxGeometry args={[0.26, 0.19, 0.42]} />
        <meshStandardMaterial color={wool} roughness={0.95} />
      </mesh>
      {/* puntera redondeada del pie */}
      <mesh castShadow position={[0.14, 0.1, 0.45]}>
        <sphereGeometry args={[0.13, 14, 12]} />
        <meshStandardMaterial color={wool} roughness={0.95} />
      </mesh>
      {/* raya de color cruzando el pie */}
      <mesh position={[0.14, 0.1, 0.34]}>
        <boxGeometry args={[0.265, 0.195, 0.06]} />
        <meshStandardMaterial color={stripe} roughness={0.9} />
      </mesh>
      {/* zurcido / parche (darn) en el talón, hilo más claro */}
      <mesh position={[0.14, 0.16, 0.06]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[0.1, 0.09, 0.012]} />
        <meshStandardMaterial color="#f4d47b" roughness={0.85} />
      </mesh>
      {/* agujerito en la puntera (dedo asomando) */}
      <mesh position={[0.14, 0.13, 0.54]}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color={hole} roughness={1} />
      </mesh>
      {/* trébol de cuatro hojas de la suerte, bordado en el costado del pie */}
      <group position={[0.01, 0.12, 0.26]} rotation={[0, -Math.PI / 2, 0]}>
        {[[-0.045, 0], [0.045, 0], [0, -0.045], [0, 0.045]].map(([lx, ly]) => (
          <mesh key={`${lx}:${ly}`} position={[lx, ly, 0]}>
            <sphereGeometry args={[0.038, 10, 8]} />
            <meshStandardMaterial color="#3fa34d" roughness={0.7} />
          </mesh>
        ))}
        <mesh position={[0, -0.075, 0]}>
          <boxGeometry args={[0.014, 0.06, 0.01]} />
          <meshStandardMaterial color="#2f7d3a" roughness={0.7} />
        </mesh>
      </group>
      {/* pelusas de mugre (pequeñas motas grises) */}
      {[[-0.28, 0.24, 0.05], [0.05, 0.25, -0.06], [0.2, 0.19, 0.4]].map(([px, py, pz]) => (
        <mesh key={`${px}:${pz}`} position={[px, py, pz]}>
          <sphereGeometry args={[0.022, 8, 6]} />
          <meshStandardMaterial color={grime} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function CursedCalculator({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const shell = "#1c1726";
  const shellEdge = "#2b2338";
  const key = "#413a52";
  const keyDark = "#2f2940";
  const cursedGlow = "#8b3ff5";
  const btnXs = [-0.21, -0.07, 0.07, 0.21];
  const btnZs = [0.12, 0.26, 0.4];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* carcasa gruesa oscura, ligeramente en cuña */}
      <mesh castShadow receiveShadow position={[0, 0.08, 0]}>
        <boxGeometry args={[0.64, 0.14, 1.02]} />
        <meshStandardMaterial color={shell} roughness={0.55} metalness={0.1} />
      </mesh>
      {/* bisel superior algo más claro */}
      <mesh position={[0, 0.155, 0]}>
        <boxGeometry args={[0.6, 0.02, 0.98]} />
        <meshStandardMaterial color={shellEdge} roughness={0.6} />
      </mesh>
      {/* marco hundido del LCD (parte trasera -Z) */}
      <mesh position={[0, 0.17, -0.32]}>
        <boxGeometry args={[0.52, 0.02, 0.3]} />
        <meshStandardMaterial color="#0d0b14" roughness={0.7} />
      </mesh>
      {/* pantalla LCD con brillo púrpura enfermizo */}
      <mesh position={[0, 0.182, -0.32]}>
        <boxGeometry args={[0.46, 0.012, 0.24]} />
        <meshStandardMaterial color="#3a1f5c" emissive={cursedGlow} emissiveIntensity={0.9} roughness={0.3} />
      </mesh>
      {/* símbolos glitcheados / eldritch en el LCD */}
      <mesh position={[0, 0.19, -0.32]} rotation={[-Math.PI / 2, 0, 0]}>
        <MiniLabel text="3RR:666" background="#2a1244" color="#c79bff" width={0.42} height={0.2} />
      </mesh>
      {/* grieta atravesando la pantalla */}
      <mesh position={[0.02, 0.189, -0.32]} rotation={[-Math.PI / 2, 0, 0.6]}>
        <boxGeometry args={[0.3, 0.008, 0.01]} />
        <meshStandardMaterial color="#0a0710" roughness={0.9} />
      </mesh>
      <mesh position={[-0.08, 0.189, -0.29]} rotation={[-Math.PI / 2, 0, -0.9]}>
        <boxGeometry args={[0.12, 0.008, 0.008]} />
        <meshStandardMaterial color="#0a0710" roughness={0.9} />
      </mesh>
      {/* grilla de botones (4x3) */}
      {btnZs.map((z, zi) =>
        btnXs.map((x, xi) => (
          <mesh key={`${x}:${z}`} castShadow position={[x, 0.172, z]}>
            <boxGeometry args={[0.11, 0.03, 0.11]} />
            <meshStandardMaterial color={(xi + zi) % 2 === 0 ? key : keyDark} roughness={0.6} />
          </mesh>
        ))
      )}
      {/* botón '=' rojo cursado, resaltado */}
      <mesh castShadow position={[0.21, 0.175, 0.4]}>
        <boxGeometry args={[0.11, 0.036, 0.11]} />
        <meshStandardMaterial color="#7f1d1d" emissive="#dc2626" emissiveIntensity={0.4} roughness={0.5} />
      </mesh>
      {/* pentagrama baked grabado en la carcasa, bajo los botones */}
      <mesh position={[0, 0.181, 0.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.05, 0.062, 20]} />
        <meshBasicMaterial color={cursedGlow} toneMapped={false} side={DoubleSide} />
      </mesh>
      {/* estrella de cinco puntas dentro del pentagrama (5 barritas) */}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh
          key={i}
          position={[Math.sin((i * 2 * Math.PI) / 5) * 0.028, 0.181, 0.55 + Math.cos((i * 2 * Math.PI) / 5) * 0.028]}
          rotation={[-Math.PI / 2, 0, (i * 2 * Math.PI) / 5]}
        >
          <boxGeometry args={[0.006, 0.002, 0.09]} />
          <meshBasicMaterial color="#b98bff" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function GiantPencil({ position, rotationY = 0, scale = 1 }: AssetProps) {
  const yellow = "#f5c518";
  const wood = "#e6b877";
  const graphite = "#33333a";
  const ferrule = "#b6bcc4";
  const eraser = "#ef7ba0";
  // acostado a lo largo del eje X, apoyado en el piso (radio 0.16 => centro en y=0.16)
  const shaftLen = 1.7;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* cuerpo hexagonal amarillo (prisma de 6 lados = cilindro de 6 segmentos) */}
      <mesh castShadow receiveShadow position={[0, 0.16, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, shaftLen, 6]} />
        <meshStandardMaterial color={yellow} roughness={0.5} flatShading />
      </mesh>
      {/* etiqueta 'HB' baked sobre una faceta superior del cuerpo */}
      <mesh position={[0.15, 0.31, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <MiniLabel text="HB" background={yellow} color="#4b3a08" width={0.34} height={0.13} />
      </mesh>
      {/* cono de madera tallado (punta afilada, extremo +X) */}
      <mesh castShadow position={[shaftLen / 2 + 0.13, 0.16, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.16, 0.28, 6]} />
        <meshStandardMaterial color={wood} roughness={0.7} flatShading />
      </mesh>
      {/* mina de grafito (punta fina) */}
      <mesh castShadow position={[shaftLen / 2 + 0.29, 0.16, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.05, 0.1, 8]} />
        <meshStandardMaterial color={graphite} roughness={0.4} metalness={0.15} />
      </mesh>
      {/* virola metálica (banda de anillos) en el extremo trasero -X */}
      <mesh castShadow position={[-shaftLen / 2 - 0.06, 0.16, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.17, 0.17, 0.16, 16]} />
        <meshStandardMaterial color={ferrule} roughness={0.35} metalness={0.55} />
      </mesh>
      {/* anillos acanalados de la virola */}
      {[-0.11, -0.01].map((x) => (
        <mesh key={x} position={[-shaftLen / 2 + x, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.171, 0.012, 8, 16]} />
          <meshStandardMaterial color="#8b929c" roughness={0.4} metalness={0.5} />
        </mesh>
      ))}
      {/* goma de borrar rosa cilíndrica al final */}
      <mesh castShadow position={[-shaftLen / 2 - 0.2, 0.16, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.155, 0.145, 0.16, 16]} />
        <meshStandardMaterial color={eraser} roughness={0.85} />
      </mesh>
    </group>
  );
}

function StickerSuitcase({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Valija dura de viaje volcada de canto, empapelada de stickers. Carcasa con
  // costillas horizontales tipo policarbonato, mango telescópico retraído, dos
  // ruedas y un enjambre de calcomanías coloridas superpuestas.
  const shellTeal = "#1f9e8f";
  const shellDark = "#137368";
  const trim = "#0e5952";
  // Parches de sticker: [x, y, ancho, alto, color, rotZ] sobre la cara +Z.
  const decals: Array<[number, number, number, number, string, number]> = [
    [-0.34, 0.62, 0.24, 0.24, "#ef4444", 0.2],
    [-0.06, 0.5, 0.22, 0.16, "#facc15", -0.35],
    [0.28, 0.66, 0.2, 0.2, "#3b82f6", 0.5],
    [0.42, 0.36, 0.16, 0.16, "#f97316", 0.1],
    [-0.42, 0.34, 0.18, 0.13, "#a855f7", -0.2],
    [0.02, 0.28, 0.26, 0.12, "#ec4899", 0.28],
    [-0.18, 0.82, 0.16, 0.12, "#22c55e", -0.5],
    [0.34, 0.86, 0.14, 0.14, "#f8fafc", 0.15]
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* cuerpo redondeado de la valija, parada de canto */}
      <mesh castShadow receiveShadow position={[0, 0.58, 0]}>
        <boxGeometry args={[1.16, 0.98, 0.44]} />
        <meshStandardMaterial color={shellTeal} roughness={0.42} metalness={0.12} />
      </mesh>
      {/* biseles laterales redondeados (esferas achatadas en las esquinas verticales) */}
      {[-0.56, 0.56].map((x) => (
        <mesh key={x} castShadow position={[x, 0.58, 0]} scale={[0.5, 1, 1]}>
          <cylinderGeometry args={[0.24, 0.24, 0.98, 16]} />
          <meshStandardMaterial color={shellDark} roughness={0.44} metalness={0.12} />
        </mesh>
      ))}
      {/* costillas horizontales del policarbonato en la cara frontal */}
      {[0.18, 0.42, 0.66, 0.9].map((y) => (
        <mesh key={`rib-${y}`} position={[0, y, 0.225]}>
          <boxGeometry args={[1.02, 0.035, 0.02]} />
          <meshStandardMaterial color={shellDark} roughness={0.5} />
        </mesh>
      ))}
      {/* costillas en la cara trasera para que se lea de ambos lados */}
      {[0.3, 0.58, 0.86].map((y) => (
        <mesh key={`ribb-${y}`} position={[0, y, -0.225]}>
          <boxGeometry args={[1.02, 0.035, 0.02]} />
          <meshStandardMaterial color={shellDark} roughness={0.5} />
        </mesh>
      ))}
      {/* cierre metálico perimetral que parte las dos valvas */}
      <mesh position={[0, 0.58, 0.001]}>
        <boxGeometry args={[1.2, 0.05, 0.47]} />
        <meshStandardMaterial color={trim} roughness={0.4} metalness={0.28} />
      </mesh>
      {/* nub del mango telescópico retraído, arriba */}
      <mesh castShadow position={[0, 1.11, 0]}>
        <boxGeometry args={[0.42, 0.08, 0.12]} />
        <meshStandardMaterial color={"#334155"} roughness={0.4} metalness={0.3} />
      </mesh>
      {[-0.15, 0.15].map((x) => (
        <mesh key={`post-${x}`} position={[x, 1.05, 0]}>
          <cylinderGeometry args={[0.028, 0.028, 0.1, 10]} />
          <meshStandardMaterial color={"#94a3b8"} roughness={0.35} metalness={0.5} />
        </mesh>
      ))}
      {/* manija lateral de goma */}
      <mesh position={[0.6, 0.58, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.14, 0.028, 8, 20, Math.PI]} />
        <meshStandardMaterial color={"#1e293b"} roughness={0.6} />
      </mesh>
      {/* dos ruedas abajo */}
      {[-0.4, 0.4].map((x) => (
        <mesh key={`wheel-${x}`} castShadow position={[x, 0.06, 0.16]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.07, 14]} />
          <meshStandardMaterial color={"#111827"} roughness={0.7} />
        </mesh>
      ))}
      {[-0.4, 0.4].map((x) => (
        <mesh key={`wheelb-${x}`} castShadow position={[x, 0.06, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.07, 14]} />
          <meshStandardMaterial color={"#111827"} roughness={0.7} />
        </mesh>
      ))}
      {/* enjambre de stickers de viaje sobre la cara frontal */}
      {decals.map(([x, y, w, h, c, rot], i) => (
        <mesh key={`decal-${i}`} position={[x, y, 0.226]} rotation={[0, 0, rot]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial color={c} roughness={0.5} side={DoubleSide} />
        </mesh>
      ))}
      {/* sticker circular "smiley" amarillo */}
      <mesh position={[0.12, 0.72, 0.227]}>
        <circleGeometry args={[0.11, 20]} />
        <meshStandardMaterial color={"#fde047"} roughness={0.5} side={DoubleSide} />
      </mesh>
      {[-0.04, 0.04].map((ex) => (
        <mesh key={`eye-${ex}`} position={[0.12 + ex, 0.75, 0.229]}>
          <circleGeometry args={[0.014, 8]} />
          <meshStandardMaterial color={"#111827"} side={DoubleSide} />
        </mesh>
      ))}
      <mesh position={[0.12, 0.69, 0.229]} rotation={[Math.PI, 0, 0]}>
        <ringGeometry args={[0.04, 0.052, 12, 1, 0, Math.PI]} />
        <meshStandardMaterial color={"#111827"} side={DoubleSide} />
      </mesh>
      {/* sticker de bandera a rayas */}
      {[-0.02, 0.02].map((fy, i) => (
        <mesh key={`flag-${fy}`} position={[-0.28, 0.58 + fy, 0.228]}>
          <planeGeometry args={[0.2, 0.04]} />
          <meshStandardMaterial color={i === 0 ? "#0ea5e9" : "#f8fafc"} side={DoubleSide} />
        </mesh>
      ))}
      {/* sticker de ciudad con texto baked */}
      <mesh position={[0.02, 0.5, 0.229]} rotation={[0, 0, 0.12]}>
        <MiniLabel text="PARIS" background="#f8fafc" color="#be123c" width={0.28} height={0.11} />
      </mesh>
      <mesh position={[-0.16, 0.4, 0.229]} rotation={[0, 0, -0.18]}>
        <MiniLabel text="TOKYO" background="#111827" color="#f472b6" width={0.24} height={0.1} />
      </mesh>
    </group>
  );
}

function BananaPeelTrap({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Cáscara de banana abierta en el piso, clásico peligro de resbalón. Nub central
  // oscuro del que salen cuatro gajos amarillos afinados y caídos, con manchas
  // marrones de magullón baked. Casi plana, pegada al suelo.
  const peel = "#f7d43a";
  const peelShade = "#e0b820";
  const innerCream = "#fdf6c4";
  const bruise = "#8a5a2b";
  const stem = "#5b3d1d";
  // Cuatro gajos radiales: [ánguloY, largo, caída] desplegados como estrella.
  const flaps: Array<[number, number, number]> = [
    [0, 0.62, -0.5],
    [Math.PI * 0.5, 0.56, -0.42],
    [Math.PI, 0.6, -0.48],
    [Math.PI * 1.5, 0.5, -0.4]
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* nub central: base carnosa de la que nacen los gajos */}
      <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.14, 0.18, 0.1, 12]} />
        <meshStandardMaterial color={peel} roughness={0.6} />
      </mesh>
      {/* cabito del tallo apuntando hacia arriba */}
      <mesh castShadow position={[0, 0.16, 0]} rotation={[0.25, 0, 0.15]}>
        <cylinderGeometry args={[0.03, 0.045, 0.16, 8]} />
        <meshStandardMaterial color={stem} roughness={0.75} />
      </mesh>
      {/* cuatro gajos afinados y caídos */}
      {flaps.map(([ang, len, droop], i) => (
        <group key={`flap-${i}`} rotation={[0, ang, 0]}>
          {/* gajo exterior amarillo, inclinado hacia abajo desde el nub */}
          <mesh castShadow receiveShadow position={[len / 2, 0.05, 0]} rotation={[0, 0, droop]}>
            <boxGeometry args={[len, 0.05, 0.16]} />
            <meshStandardMaterial color={i % 2 === 0 ? peel : peelShade} roughness={0.58} />
          </mesh>
          {/* punta redondeada del gajo */}
          <mesh position={[len * 0.98, 0.02, 0]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color={peelShade} roughness={0.62} />
          </mesh>
          {/* interior cremoso visible en la cara de arriba del gajo */}
          <mesh position={[len / 2, 0.078, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[len * 0.82, 0.09]} />
            <meshStandardMaterial color={innerCream} roughness={0.5} side={DoubleSide} />
          </mesh>
          {/* mancha de magullón marrón sobre el gajo */}
          <mesh position={[len * 0.62, 0.081, 0.02]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.04, 10]} />
            <meshStandardMaterial color={bruise} roughness={0.7} side={DoubleSide} />
          </mesh>
        </group>
      ))}
      {/* mancha de magullón en el nub central */}
      <mesh position={[0.05, 0.112, 0.04]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.045, 10]} />
        <meshStandardMaterial color={bruise} roughness={0.7} side={DoubleSide} />
      </mesh>
      {/* decal de resbalón: dos arcos de movimiento en el piso al costado */}
      {[0.0, 0.09].map((off, i) => (
        <mesh key={`slip-${i}`} position={[0.55 + i * 0.14, 0.012, -0.4 - off]} rotation={[-Math.PI / 2, 0, 0.5]}>
          <ringGeometry args={[0.08, 0.105, 16, 1, 0, Math.PI * 0.7]} />
          <meshStandardMaterial color={"#f8fafc"} roughness={0.6} transparent opacity={0.85} side={DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function WorldCupTrophy({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // La Copa del Mundo: base verde malaquita con anillos dorados, cuerpo dorado
  // torcido que sube y se abre en un globo. Cuando ganamos y festejamos juntos.
  const gold = "#e9c04a";
  const goldHi = "#f6dd8a";
  const green = "#1f7a4d";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* base malaquita */}
      <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.2, 0.22, 0.12, 28]} />
        <meshStandardMaterial color={green} roughness={0.4} metalness={0.2} />
      </mesh>
      {[0.03, 0.1].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.205, 0.012, 8, 30]} />
          <meshStandardMaterial color={gold} metalness={0.8} roughness={0.25} />
        </mesh>
      ))}
      {/* pie dorado */}
      <mesh castShadow position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.06, 0.14, 0.14, 24]} />
        <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} />
      </mesh>
      {/* cuerpo torcido con cintura fina */}
      <mesh castShadow position={[0, 0.36, 0]} scale={[1, 1, 0.78]}>
        <cylinderGeometry args={[0.11, 0.05, 0.36, 20]} />
        <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} />
      </mesh>
      {/* dos figuras insinuadas sosteniendo el globo */}
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * 0.06, 0.42, 0.03]} rotation={[0, 0, s * 0.2]} scale={[0.5, 1.5, 0.45]}>
          <sphereGeometry args={[0.06, 12, 10]} />
          <meshStandardMaterial color={goldHi} metalness={0.85} roughness={0.22} />
        </mesh>
      ))}
      {/* globo dorado arriba con meridianos */}
      <mesh castShadow position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.13, 20, 16]} />
        <meshStandardMaterial color={gold} metalness={0.85} roughness={0.22} />
      </mesh>
      {[0, Math.PI / 2].map((r) => (
        <mesh key={r} position={[0, 0.6, 0]} rotation={[0, r, 0]}>
          <torusGeometry args={[0.13, 0.004, 6, 30]} />
          <meshStandardMaterial color={goldHi} metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.13, 0.004, 6, 30]} />
        <meshStandardMaterial color={goldHi} metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

function RainTent({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Carpa azul tipo A... pero llueve ADENTRO: nubecita, gotas y un charco en el
  // piso interno.
  const blue = "#2563eb";
  const blueDark = "#1e40af";
  const rain = "#7dd3fc";
  const W = 0.82;
  const L = 1.0;
  const H = 0.6;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* piso */}
      <mesh receiveShadow position={[0, 0.01, 0]}>
        <boxGeometry args={[W, 0.02, L]} />
        <meshStandardMaterial color={blueDark} roughness={0.85} />
      </mesh>
      {/* dos faldones del techo */}
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[(s * W) / 4, H / 2, 0]} rotation={[0, 0, s * 0.62]}>
          <boxGeometry args={[0.02, Math.hypot(W / 2, H) + 0.04, L]} />
          <meshStandardMaterial color={s > 0 ? blue : shade(blue, 0.9)} roughness={0.7} side={DoubleSide} />
        </mesh>
      ))}
      {/* caballete */}
      <mesh position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.015, 0.015, L, 8]} />
        <meshStandardMaterial color={blueDark} roughness={0.6} />
      </mesh>
      {/* pared triangular de atrás */}
      <mesh position={[0, H / 2, -L / 2 + 0.01]}>
        <coneGeometry args={[W / 2 + 0.03, H, 3, 1]} />
        <meshStandardMaterial color={shade(blue, 0.85)} roughness={0.72} side={DoubleSide} />
      </mesh>
      {/* nube gris cargada bajo el techo */}
      {[[-0.14, 0.5, 0], [0.14, 0.5, 0], [0, 0.54, 0.04], [-0.06, 0.47, -0.06], [0.08, 0.48, 0.05], [0, 0.45, -0.02]].map(([x, y, z], i) => (
        <mesh key={`cloud-${i}`} position={[x, y, z]} scale={[1.35, 0.8, 1.1]}>
          <sphereGeometry args={[0.1, 12, 10]} />
          <meshStandardMaterial color={i < 2 ? "#5b6473" : "#8b94a3"} roughness={0.95} />
        </mesh>
      ))}
      {/* cortina densa de lluvia cayendo de la nube */}
      {Array.from({ length: 18 }).map((_, i) => {
        const gx = ((i % 5) - 2) * 0.08;
        const gz = (Math.floor(i / 5) - 1.5) * 0.1;
        const gy = 0.42 - ((i * 7) % 10) * 0.032;
        return (
          <mesh key={`drop-${i}`} position={[gx, gy, gz]}>
            <cylinderGeometry args={[0.008, 0.008, 0.13, 5]} />
            <meshStandardMaterial color={rain} emissive={rain} emissiveIntensity={0.25} roughness={0.2} transparent opacity={0.9} />
          </mesh>
        );
      })}
      {/* charco grande con ondas */}
      <mesh position={[0, 0.035, 0]} scale={[1.7, 0.2, 1.4]}>
        <sphereGeometry args={[0.16, 16, 10]} />
        <meshStandardMaterial color={rain} roughness={0.3} transparent opacity={0.7} />
      </mesh>
      {[0.1, 0.17].map((r) => (
        <mesh key={`ripple-${r}`} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r, 0.006, 6, 24]} />
          <meshStandardMaterial color={rain} transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

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
