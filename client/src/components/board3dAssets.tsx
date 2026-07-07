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
  // Palo de hockey de madera convertido en arma: esquirlas de vidrio celeste
  // semitransparentes clavadas en la pala y subiendo por el mango; grip de
  // cinta negra arriba. Improvisado y amenazante.
  const wood = "#a3672f";
  const glass = "#a5e8f7";
  const grip = "#0f172a";
  const shaftShards: [number, number, number][] = [
    [-0.32, 0.5, 0.9],
    [-0.2, -0.6, 1.1],
    [-0.08, 0.4, 0.85],
    [0.06, -0.5, 1.0],
    [0.18, 0.7, 0.8],
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0.18]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.95, 10]} />
        <meshStandardMaterial color={wood} roughness={0.7} metalness={0.04} />
      </mesh>
      <mesh castShadow position={[0.46, 0.045, 0.02]} scale={[0.9, 0.5, 1.9]}>
        <sphereGeometry args={[0.09, 12, 8]} />
        <meshStandardMaterial color={shade(wood, 0.88)} roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0.55, 0.09, 0.16]} rotation={[0.5, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.035, 0.16, 10]} />
        <meshStandardMaterial color={shade(wood, 0.88)} roughness={0.72} />
      </mesh>
      {[-0.5, -0.44, -0.38].map((x) => (
        <mesh key={x} position={[x, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.024, 0.008, 6, 12]} />
          <meshStandardMaterial color={grip} roughness={0.62} />
        </mesh>
      ))}
      <mesh position={[-0.46, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.024, 0.024, 0.14, 10]} />
        <meshStandardMaterial color={grip} roughness={0.62} />
      </mesh>
      {[[0.4, 0.09], [0.48, -0.06], [0.53, 0.12], [0.44, 0.0], [0.58, -0.02]].map(([x, z], i) => (
        <mesh
          key={`hs-${i}`}
          position={[x, 0.11, z]}
          rotation={[0.35 * (i % 2 ? 1 : -1), i * 0.6, 0.2]}
        >
          <coneGeometry args={[0.026, 0.11, 4]} />
          <meshStandardMaterial color={glass} roughness={0.08} metalness={0.1} transparent opacity={0.72} />
        </mesh>
      ))}
      {shaftShards.map(([x, tilt, s], i) => (
        <mesh key={`ss-${i}`} position={[x, 0.1, 0]} rotation={[tilt, i * 0.9, 0.1]} scale={[s, s, s]}>
          <coneGeometry args={[0.022, 0.1, 4]} />
          <meshStandardMaterial color={glass} roughness={0.08} metalness={0.1} transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function CondomBolas({ position, rotationY = 0, scale = 1 }: AssetProps) {
  // Arma mítica de Beltrán: dos globos de látex translúcidos, panzones y llenos
  // de caca (esfera marrón interior bien visible), unidos por un cordón con un
  // nudo grueso. Una bola cuelga más baja, como en pleno swing.
  const latex = "#ded0b4";
  const poop = "#5a3418";
  const poopDark = "#3d2410";
  const cord = "#e7d8b4";
  const knot = "#c9b78e";
  const balls: [number, number, number][] = [
    [-0.34, 0.62, 0.3],
    [0.36, 0.34, -0.4],
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.02, 0.028, 1.0, 8]} />
        <meshStandardMaterial color="#7c4524" roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color={knot} roughness={0.7} />
      </mesh>
      {balls.map(([x, y], i) => {
        const len = 1.0 - y;
        return (
          <mesh key={`cord-${i}`} position={[x / 2, (1.0 + y) / 2 + 0.04, 0]} rotation={[0, 0, Math.atan2(x, len)]}>
            <cylinderGeometry args={[0.014, 0.014, Math.hypot(len, x), 6]} />
            <meshStandardMaterial color={cord} roughness={0.72} />
          </mesh>
        );
      })}
      <mesh position={[0.02, 0.6, 0]} rotation={[Math.PI / 2, 0, 0.2]}>
        <torusGeometry args={[0.05, 0.026, 8, 14]} />
        <meshStandardMaterial color={knot} roughness={0.66} />
      </mesh>
      {balls.map(([x, y, r], i) => (
        <group key={`ball-${i}`} position={[x, y, 0]} rotation={[0, 0, r]}>
          <mesh castShadow position={[0, 0.24, 0]}>
            <coneGeometry args={[0.05, 0.11, 8]} />
            <meshStandardMaterial color={latex} roughness={0.28} transparent opacity={0.7} />
          </mesh>
          <mesh castShadow scale={[0.62, 1, 0.62]}>
            <sphereGeometry args={[0.2, 16, 12]} />
            <meshStandardMaterial color={poop} roughness={0.9} />
          </mesh>
          <mesh position={[0.03, -0.05, 0.06]} scale={[0.4, 0.5, 0.34]}>
            <sphereGeometry args={[0.2, 12, 8]} />
            <meshStandardMaterial color={poopDark} roughness={0.95} />
          </mesh>
          <mesh castShadow scale={[0.78, 1.28, 0.78]}>
            <sphereGeometry args={[0.2, 20, 14]} />
            <meshStandardMaterial color={latex} roughness={0.2} metalness={0.04} transparent opacity={0.62} />
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
  const plastic = tint ?? "#eaf6fb";
  const fizz = "#63d64a";
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* main body */}
      <mesh castShadow receiveShadow position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.2, 0.22, 0.6, 18]} />
        <meshStandardMaterial color={plastic} roughness={0.45} transparent opacity={0.82} />
      </mesh>
      {/* blue tint band low on the body */}
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.222, 0.24, 0.14, 18]} />
        <meshStandardMaterial color="#7cc7e8" roughness={0.5} transparent opacity={0.85} />
      </mesh>
      {/* shoulder taper up to neck */}
      <mesh castShadow position={[0, 0.66, 0]}>
        <cylinderGeometry args={[0.1, 0.2, 0.14, 18]} />
        <meshStandardMaterial color={plastic} roughness={0.45} transparent opacity={0.82} />
      </mesh>
      {/* short neck */}
      <mesh position={[0, 0.76, 0]}>
        <cylinderGeometry args={[0.085, 0.1, 0.08, 16]} />
        <meshStandardMaterial color={plastic} roughness={0.5} transparent opacity={0.88} />
      </mesh>
      {/* swollen bulging cap about to pop */}
      <mesh castShadow position={[0, 0.87, 0]} scale={[1, 1.25, 1]}>
        <sphereGeometry args={[0.11, 16, 14]} />
        <meshStandardMaterial color="#f4d21f" roughness={0.4} metalness={0.05} />
      </mesh>
      {/* green fizz bubbles suspended inside the body */}
      {[
        [0.05, 0.28, 0.04, 0.06],
        [-0.07, 0.4, -0.03, 0.05],
        [0.02, 0.5, 0.06, 0.045],
        [-0.04, 0.22, 0.07, 0.04],
        [0.09, 0.44, -0.05, 0.035],
        [-0.02, 0.34, -0.06, 0.05],
        [0.06, 0.58, 0.0, 0.03]
      ].map((b, i) => (
        <mesh key={i} position={[b[0], b[1], b[2]]}>
          <sphereGeometry args={[b[3], 10, 10]} />
          <meshStandardMaterial color={fizz} roughness={0.3} transparent opacity={0.7} emissive={fizz} emissiveIntensity={0.2} />
        </mesh>
      ))}
      {/* bubbles escaping past the strained cap */}
      {[
        [0.06, 1.02, 0.02, 0.03],
        [-0.05, 1.08, -0.03, 0.025],
        [0.01, 1.15, 0.04, 0.02]
      ].map((b, i) => (
        <mesh key={"e" + i} position={[b[0], b[1], b[2]]}>
          <sphereGeometry args={[b[3], 8, 8]} />
          <meshStandardMaterial color={fizz} roughness={0.3} transparent opacity={0.6} emissive={fizz} emissiveIntensity={0.25} />
        </mesh>
      ))}
      {/* baked CLORO hazard label */}
      <mesh position={[0, 0.36, 0.212]}>
        <MiniLabel text="CLORO" background="#facc15" color="#7f1d1d" width={0.3} height={0.16} />
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
      <mesh position={[0.02, 1.28, 0.02]}>
        <cylinderGeometry args={[0.012, 0.012, 0.7, 8]} />
        <meshStandardMaterial color={rope} roughness={0.85} />
      </mesh>
      <mesh position={[0.02, 0.92, 0.02]}>
        <cylinderGeometry args={[0.014, 0.014, 0.06, 8]} />
        <meshStandardMaterial color={shade(rope, 0.8)} roughness={0.85} />
      </mesh>
      <mesh position={[0.02, 0.83, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.075, 0.014, 8, 18]} />
        <meshStandardMaterial color={rope} roughness={0.85} />
      </mesh>
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
  const wood = tint ?? "#8a4a1c";
  const glass = "#a8e0ef";
  const crack = "#1f3a42";
  const paneOffsets: [number, number][] = [
    [-0.2, 0.62],
    [0.2, 0.62],
    [-0.2, 0.24],
  ];
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh castShadow receiveShadow position={[0, 0.02, 0]}>
        <boxGeometry args={[0.62, 0.04, 0.14]} />
        <meshStandardMaterial color={shade(wood, 0.8)} roughness={0.8} />
      </mesh>
      {[-0.24, 0.24].map((x) => (
        <mesh key={x} castShadow position={[x, 0.52, 0]}>
          <boxGeometry args={[0.06, 0.92, 0.06]} />
          <meshStandardMaterial color={wood} roughness={0.8} />
        </mesh>
      ))}
      {[0.08, 0.96].map((y) => (
        <mesh key={y} castShadow position={[0, y, 0]}>
          <boxGeometry args={[0.54, 0.06, 0.06]} />
          <meshStandardMaterial color={wood} roughness={0.8} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.52, 0]}>
        <boxGeometry args={[0.06, 0.9, 0.05]} />
        <meshStandardMaterial color={shade(wood, 1.08)} roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.52, 0]}>
        <boxGeometry args={[0.5, 0.05, 0.05]} />
        <meshStandardMaterial color={shade(wood, 1.08)} roughness={0.8} />
      </mesh>
      {paneOffsets.map(([px, py]) => (
        <mesh key={`${px},${py}`} position={[px, py, 0]}>
          <boxGeometry args={[0.32, 0.34, 0.01]} />
          <meshStandardMaterial color={glass} roughness={0.1} metalness={0.05} transparent opacity={0.4} side={DoubleSide} />
        </mesh>
      ))}
      {paneOffsets.map(([px, py]) =>
        [0.6, 2.1, 4.0].map((ang, i) => (
          <mesh key={`${px},${py},${i}`} position={[px, py, 0.008]} rotation={[0, 0, ang]}>
            <boxGeometry args={[0.005, 0.16, 0.006]} />
            <meshStandardMaterial color={crack} roughness={0.6} />
          </mesh>
        ))
      )}
      {[0.9, 3.9, 5.4].map((ang, i) => (
        <mesh key={`shard-${i}`} position={[0.2, 0.24, 0.02]} rotation={[Math.PI / 2, 0, ang]}>
          <coneGeometry args={[0.05, 0.2, 3]} />
          <meshStandardMaterial color={shade(glass, 1.1)} roughness={0.1} transparent opacity={0.55} side={DoubleSide} flatShading />
        </mesh>
      ))}
      <mesh position={[0.2, 0.24, 0.01]}>
        <sphereGeometry args={[0.04, 10, 8]} />
        <meshStandardMaterial color={crack} roughness={0.7} />
      </mesh>
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
  const shell = tint ?? "#f8fafc";
  const r = 0.26;
  const cy = r; // seat the ball so its bottom touches y=0 (nothing dips below ground)
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      {/* speed-line puffs trailing behind (-Z) */}
      <mesh position={[0.02, cy - 0.02, -0.34]}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial color="#ffffff" roughness={0.9} transparent opacity={0.5} />
      </mesh>
      <mesh position={[-0.1, cy + 0.06, -0.28]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color="#ffffff" roughness={0.9} transparent opacity={0.45} />
      </mesh>
      <mesh position={[0.14, cy - 0.1, -0.3]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial color="#ffffff" roughness={0.9} transparent opacity={0.4} />
      </mesh>
      {/* main ball, slightly squashed on the impact (front +Z) axis */}
      <mesh castShadow receiveShadow position={[0, cy, 0]} scale={[1, 1, 0.86]}>
        <sphereGeometry args={[r, 22, 22]} />
        <meshStandardMaterial color={shell} roughness={0.55} metalness={0.02} />
      </mesh>
      {/* pressed-in flat cap on the impact face to sell the squash */}
      <mesh position={[0, cy, r * 0.7]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.14, 0.03, 20]} />
        <meshStandardMaterial color={shade(shell, 0.94)} roughness={0.6} />
      </mesh>
      {/* baked colored panels: inset circle decals around the shell */}
      {[
        { p: [0.0, cy + 0.16, -0.12] as [number, number, number], rot: [Math.PI * 0.15, 0, 0] as [number, number, number], c: "#111827" },
        { p: [0.19, cy, -0.08] as [number, number, number], rot: [0, -0.9, 0] as [number, number, number], c: "#111827" },
        { p: [-0.2, cy - 0.02, -0.04] as [number, number, number], rot: [0, 0.9, 0] as [number, number, number], c: "#111827" },
        { p: [-0.08, cy - 0.16, 0.1] as [number, number, number], rot: [-Math.PI * 0.2, 0.3, 0] as [number, number, number], c: "#111827" }
      ].map((panel, i) => (
        <mesh key={i} position={panel.p} rotation={panel.rot}>
          <circleGeometry args={[0.075, 5]} />
          <meshStandardMaterial color={panel.c} roughness={0.6} side={DoubleSide} />
        </mesh>
      ))}
      {/* radial comic motion lines fanning off the impact face */}
      {[-0.9, -0.45, 0, 0.45, 0.9].map((a, i) => (
        <mesh key={i} position={[Math.sin(a) * 0.34, cy + Math.cos(a) * 0.2 - 0.02, 0.34]} rotation={[0, 0, a]}>
          <boxGeometry args={[0.02, 0.13, 0.01]} />
          <meshStandardMaterial color="#111827" roughness={0.7} />
        </mesh>
      ))}
      {/* yellow starburst backing the POW */}
      <mesh position={[0.04, cy + 0.06, 0.42]}>
        <octahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#facc15" roughness={0.55} emissive="#fde047" emissiveIntensity={0.35} flatShading />
      </mesh>
      <mesh position={[0.04, cy + 0.06, 0.44]} rotation={[0, 0, 0.6]}>
        <octahedronGeometry args={[0.11, 0]} />
        <meshStandardMaterial color="#f97316" roughness={0.55} emissive="#f97316" emissiveIntensity={0.3} flatShading />
      </mesh>
      {/* POW! comic decal */}
      <mesh position={[0.04, cy + 0.06, 0.5]}>
        <MiniLabel text="POW!" background="#ef4444" color="#fde047" width={0.26} height={0.14} />
      </mesh>
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
