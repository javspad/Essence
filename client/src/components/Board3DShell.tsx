import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Spherical,
  TorusGeometry,
  Vector3,
  type Group,
  type Mesh,
  type PointLight,
  type Texture,
} from "three";
import type { CosmeticDef, EffectInstance, FaceAnchor, FacePhotoAlignment, MapArtifact, MapAssetDef, MapBoardShape, MapGridPoint, MapRoute, MapTerrace, Player, Tile } from "@essence/shared";
import { cosmeticAnchorRefs, cosmeticAssetKind, normalizeCosmeticDef } from "@essence/shared/cosmetics";
import type { BoardActiveMotion, BoardDiceCue, BoardMotionKind } from "../gamePresentationMachine";
import { defaultTokenAnchor, tokenAnchorSurface } from "../characterTokenRig";
import {
  board3DMapBounds,
  boardCameraOverviewShot,
  board3DSlots,
  BOARD_GRID_SPACING,
  boardMotionSettings,
  boardRenderSettings,
  cameraFollowPosition,
  frameLerp,
  layoutToWorldPosition,
  routeWorldPoints,
  orbitLightPosition,
  slotMaterialStyle,
  supportsWebGL,
  terrainMaterialStyle,
  tokenPathPositions,
  tokenWorldPosition,
  type Board3DMapBounds,
  type Board3DSlot,
  type BoardCameraShot,
  type BoardMotionSettings,
  type CameraMode,
  type FocusedPlayerId,
  type SlotDecal,
  type Vec3,
} from "../board3d";
import { movementPath } from "../boardView";
import {
  loadPlayerPhoto,
  loadImage,
  makeLabelTexture,
  makeFaceTexture,
  makePhotoFaceTexture,
  makeMetaDiscTexture,
  MapArtifacts,
  STONE_TILE_GEOMETRY,
  STONE_TILE_HEIGHT,
  STONE_TILE_MATERIALS,
  TerracedTerrain,
} from "./board3dAssets";

interface Board3DShellProps {
  tiles: Tile[];
  players?: Player[];
  activeEffects?: EffectInstance[];
  routes?: MapRoute[];
  artifacts?: MapArtifact[];
  assetCatalog?: MapAssetDef[];
  cosmetics?: Record<string, CosmeticDef>;
  boardShape?: MapBoardShape;
  /** mesetas de relieve; sin terrazas el tablero queda plano como siempre */
  terraces?: MapTerrace[];
  activeId?: string;
  lastRoll?: number | null;
  boardLength?: number;
  activeMotion?: BoardActiveMotion | null;
  diceCue?: BoardDiceCue | null;
  children?: ReactNode;
  className?: string;
  interactive?: boolean;
  cameraMode?: CameraMode;
  /** Cámara de órbita libre (arrastrar/zoom/pan): sólo para inspeccionar en el builder. */
  freeCamera?: boolean;
  /** Con cámara libre, reencuadra al cambiar el encuadre general (p. ej. galería al cambiar de prop/tamaño). */
  freeCameraRefit?: boolean;
  focusedPlayerId?: FocusedPlayerId;
  onPlayerFocus?: (playerId: string) => void;
  onPlayerClick?: (playerId: string) => void;
  artifactTrajectory?: { fromPlayerId: string; toPlayerId: string } | null;
}

export default function Board3DShell({
  tiles,
  players = [],
  activeEffects = [],
  routes = [],
  artifacts = [],
  assetCatalog = [],
  cosmetics = {},
  boardShape,
  terraces,
  activeId,
  lastRoll = null,
  boardLength = tiles.length,
  activeMotion = null,
  diceCue = null,
  children,
  className,
  interactive = false,
  cameraMode = "followActivePlayer",
  freeCamera = false,
  freeCameraRefit = false,
  focusedPlayerId = null,
  onPlayerFocus,
  onPlayerClick,
  artifactTrajectory = null,
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
  const bounds = useMemo(
    () => board3DMapBounds(tiles, routes, artifacts, boardShape, BOARD_GRID_SPACING, terraces),
    [artifacts, boardShape, routes, terraces, tiles]
  );
  const slots = useMemo(() => board3DSlots(tiles, BOARD_GRID_SPACING, bounds, terraces), [bounds, terraces, tiles]);
  const slotPositions = useMemo(() => new Map(slots.map((slot) => [slot.id, slot.position] as const)), [slots]);
  const activePlayer = activeId ? players.find((player) => player.id === activeId) : undefined;
  const activeSlot = slotPositions.get(activePlayer?.position ?? 0) ?? [0, 0, 0];
  const focusedPlayer = focusedPlayerId ? players.find((player) => player.id === focusedPlayerId) : undefined;
  const trajectorySlot = useMemo(
    () => trajectoryMidpoint(artifactTrajectory, players, slotPositions),
    [artifactTrajectory, players, slotPositions]
  );
  // La cámara sigue al foco elegido; sin foco, sigue al que se está moviendo (evento incluido), no solo al del turno.
  const trackedId = cameraMode === "followActivePlayer" ? focusedPlayer?.id ?? activeMotion?.playerId ?? activeId : activeMotion?.playerId ?? activeId;
  const trackedPlayer = trackedId ? players.find((player) => player.id === trackedId) : undefined;
  const trackedSlot = trajectorySlot ?? slotPositions.get(trackedPlayer?.position ?? activePlayer?.position ?? 0) ?? activeSlot;
  // Posición viva del muñeco animado: el token la escribe cada frame, la cámara la lee.
  const trackedTokenRef = useRef<Vector3 | null>(null);
  const trajectoryCameraRef = useRef<Vector3 | null>(null);
  const overviewShot = useMemo(() => boardCameraOverviewShot(bounds, terraces), [bounds, terraces]);
  const activePath = new Set(
    activeMotion && activeMotion.playerId === activeId
      ? activeMotion.path
      : movementPath(activePlayer?.position ?? -1, lastRoll, boardLength)
  );
  const occupancy = useMemo(() => playersByPosition(players), [players]);
  const effectVisualsByPlayer = useMemo(() => {
    const grouped = new Map<string, EffectInstance[]>();
    activeEffects.forEach((effect) => {
      if (!effect.visualAssetId) return;
      const visuals = grouped.get(effect.targetPlayerId) ?? [];
      visuals.push(effect);
      grouped.set(effect.targetPlayerId, visuals);
    });
    return grouped;
  }, [activeEffects]);
  const tokens = useMemo(
    () =>
      players.map((player) => {
        const stack = occupancy.get(player.position) ?? [];
        const stackIndex = Math.max(0, stack.findIndex((p) => p.id === player.id));
        const explicitMotion = activeMotion?.playerId === player.id ? activeMotion : null;
        // Only use movementPath as a fallback when there IS an activeMotion context (walk
        // highlight during animation). Once activeMotion is cleared (event/idle phase),
        // we must NOT re-compute a path from lastRoll because lastRoll persists in the
        // game state and would cause the token to replay the walk animation from scratch.
        const tilePath = explicitMotion?.path ?? (activeMotion !== null && player.id === activeId ? movementPath(player.position, lastRoll, boardLength) : []);
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
          motionKind: explicitMotion?.kind ?? "walk",
          motionNonce: explicitMotion?.nonce ?? "",
        };
      }),
    [activeId, activeMotion, boardLength, lastRoll, occupancy, players, slotPositions]
  );
  const dicePosition = useMemo(() => {
    if (!diceCue) return null;
    const player = players.find((candidate) => candidate.id === diceCue.playerId);
    if (!player) return null;
    const stack = occupancy.get(player.position) ?? [];
    const stackIndex = Math.max(0, stack.findIndex((candidate) => candidate.id === player.id));
    const stackTotal = stack.length || 1;
    return tokenWorldPosition(slotPositions.get(player.position) ?? [0, 0, 0], stackIndex, stackTotal);
  }, [diceCue, occupancy, players, slotPositions]);
  const artifactTrajectoryPoints = useMemo(
    () => trajectoryPoints(artifactTrajectory, players, occupancy, slotPositions),
    [artifactTrajectory, occupancy, players, slotPositions]
  );

  // Fondo ámbar cálido tipo bokeh (la referencia del diorama), no más verdoso/oscuro
  const shellClassName =
    className ??
    `${interactive ? "" : "pointer-events-none"} absolute inset-0 z-0 overflow-hidden rounded-[1.5rem] bg-[radial-gradient(ellipse_at_50%_-10%,#f2d8a7_0%,#dfa96b_34%,#96602c_66%,#38200c_100%)]`;

  if (!webGLAvailable) return <Board3DFallback className={shellClassName} />;

  return (
    <div aria-hidden={interactive ? undefined : true} className={shellClassName}>
      <Canvas
        camera={{ position: [0, 5, 10.2], fov: 42, near: 0.1, far: 100 }}
        dpr={renderSettings.dpr}
        fallback={<Board3DFallback />}
        frameloop={renderSettings.frameloop}
        gl={{ antialias: renderSettings.antialias, alpha: true, powerPreference: renderSettings.powerPreference }}
        shadows={renderSettings.shadows}
      >
        <WebGLContextGuard onLost={disableWebGL} />
        {freeCamera ? (
          <FreeOrbitCamera overview={overviewShot} refit={freeCameraRefit} />
        ) : (
          <CinematicCamera
            mode={cameraMode}
            target={trackedSlot}
            tokenRef={trajectorySlot ? trajectoryCameraRef : trackedTokenRef}
            motion={motion}
            walking={activeMotion !== null}
            dice={Boolean(diceCue)}
            turnKey={activeId ?? ""}
            overview={overviewShot}
          />
        )}
        <ambientLight intensity={0.62} color="#fff8e1" />
        <directionalLight
          position={[5, 10, 7]}
          intensity={2.2}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-near={0.5}
          shadow-camera-far={50}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={14}
          shadow-camera-bottom={-14}
          shadow-bias={-0.0005}
        />
        {/* Subtle fill light from opposite side */}
        <directionalLight position={[-3, 4, -5]} intensity={0.38} color="#b3d4ff" />
        <AnimatedPartyLights motion={motion} />

        <BoardTable
          artifacts={artifacts}
          assetCatalog={assetCatalog}
          boardShape={boardShape}
          bounds={bounds}
          terraces={terraces}
          animated={motion.tokenStepSeconds !== 0}
        />
        <PathRibbons slots={slots} routes={routes} slotPositions={slotPositions} bounds={bounds} terraces={terraces} />

        {slots.map((slot) => (
          <SlotPlatform
            key={slot.id}
            slot={slot}
            active={slot.id === activePlayer?.position}
            stepped={activePath.has(slot.id)}
            occupiedCount={occupancy.get(slot.id)?.length ?? 0}
            animated={motion.tokenStepSeconds !== 0}
          />
        ))}

        {tokens.map(({ player, active, path, motionKind, motionNonce }) => (
          <PlayerToken
            key={player.id}
            player={player}
            active={active}
            path={path}
            motion={motion}
            motionKind={motionKind}
            motionNonce={motionNonce}
            focused={player.id === focusedPlayerId}
            cosmeticCatalog={cosmetics}
            effectVisuals={effectVisualsByPlayer.get(player.id) ?? []}
            onSelect={onPlayerFocus}
            onClickSound={onPlayerClick}
            trackRef={player.id === trackedId ? trackedTokenRef : undefined}
          />
        ))}

        {artifactTrajectoryPoints && <ArtifactTrajectoryBeam from={artifactTrajectoryPoints.from} to={artifactTrajectoryPoints.to} />}

        {diceCue && dicePosition && <FloatingDice cue={diceCue} position={dicePosition} motion={motion} />}

        {children}
      </Canvas>
    </div>
  );
}

function BoardTable({
  artifacts,
  assetCatalog,
  boardShape,
  bounds,
  terraces,
  animated,
}: {
  artifacts: MapArtifact[];
  assetCatalog: MapAssetDef[];
  boardShape?: MapBoardShape;
  bounds: Board3DMapBounds;
  terraces?: MapTerrace[];
  animated: boolean;
}) {
  const fieldWidth = Math.max(4, bounds.width * bounds.spacing + 0.95);
  const fieldDepth = Math.max(3, bounds.height * bounds.spacing + 0.95);
  const tableWidth = fieldWidth + 2.1;
  const tableDepth = fieldDepth + 2.1;

  return (
    <group>
      {/* Outermost table base - darkest wood */}
      <mesh position={[0, -0.9, 0]} receiveShadow>
        <boxGeometry args={[tableWidth + 1.8, 0.38, tableDepth + 1.8]} />
        <meshStandardMaterial color="#4a2810" roughness={0.88} metalness={0.02} />
      </mesh>
      {/* Main table surface - richer wood */}
      <mesh position={[0, -0.62, 0]} receiveShadow>
        <boxGeometry args={[tableWidth + 1.1, 0.52, tableDepth + 1.1]} />
        <meshStandardMaterial color="#7c3e18" roughness={0.75} metalness={0.04} />
      </mesh>
      {/* Inner table lip - lighter wood edge */}
      <mesh position={[0, -0.34, 0]} receiveShadow castShadow>
        <boxGeometry args={[tableWidth, 0.38, tableDepth]} />
        <meshStandardMaterial color="#9b5528" roughness={0.7} metalness={0.03} />
      </mesh>
      {/* Board border ring - dark green felt */}
      <mesh position={[0, -0.14, 0]} receiveShadow>
        <boxGeometry args={[fieldWidth + 0.72, 0.2, fieldDepth + 0.72]} />
        <meshStandardMaterial color="#1a5c2e" roughness={0.88} />
      </mesh>
      {/* Bright green inner border strip */}
      <mesh position={[0, -0.065, 0]} receiveShadow>
        <boxGeometry args={[fieldWidth + 0.38, 0.14, fieldDepth + 0.38]} />
        <meshStandardMaterial color="#2d8a48" roughness={0.82} />
      </mesh>
      {/* Main playing field */}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <boxGeometry args={[fieldWidth, 0.1, fieldDepth]} />
        <meshStandardMaterial color="#6fbe54" roughness={0.82} />
      </mesh>
      {/* Subtle grid pattern layer */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <boxGeometry args={[fieldWidth - 0.08, 0.015, fieldDepth - 0.08]} />
        <meshStandardMaterial color="#7ccf63" roughness={0.76} transparent opacity={0.55} />
      </mesh>
      {/* Con relieve, el borde del diorama lo marca el propio terreno: nada de riel oscuro */}
      {!terraces?.length && <BoardShapeRim boardShape={boardShape} bounds={bounds} />}
      {/* mesetas del relieve, de menor a mayor elevación */}
      <TerracedTerrain terraces={terraces} bounds={bounds} animated={animated} />
      <MapArtifacts artifacts={artifacts} assetCatalog={assetCatalog} bounds={bounds} terraces={terraces} />
    </group>
  );
}

function BoardShapeRim({ boardShape, bounds }: { boardShape?: MapBoardShape; bounds: Board3DMapBounds }) {
  const edges = boardShape?.borderEdges?.length ? boardShape.borderEdges : boardShape ? defaultBoardShapeEdges(boardShape) : [];

  return (
    <group>
      {edges.map((edge) => {
        const from = gridPointToWorld(edge.from, bounds);
        const to = gridPointToWorld(edge.to, bounds);
        const dx = to[0] - from[0];
        const dz = to[2] - from[2];
        const length = Math.hypot(dx, dz);
        if (length < 0.01) return null;
        return (
          <mesh
            key={edge.id}
            position={[(from[0] + to[0]) / 2, 0.02, (from[2] + to[2]) / 2]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[length, 0.16, 0.16]} />
            <meshStandardMaterial color="#1f2933" roughness={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

function gridPointToWorld(point: MapGridPoint, bounds: Board3DMapBounds): Vec3 {
  return layoutToWorldPosition({ x: point.x, y: point.y }, bounds.maxX, bounds.maxY, bounds.spacing, bounds.minX, bounds.minY);
}

function defaultBoardShapeEdges(boardShape: MapBoardShape): NonNullable<MapBoardShape["borderEdges"]> {
  return [
    { id: "edge-top", from: { x: boardShape.minX, y: boardShape.minY }, to: { x: boardShape.maxX, y: boardShape.minY } },
    { id: "edge-right", from: { x: boardShape.maxX, y: boardShape.minY }, to: { x: boardShape.maxX, y: boardShape.maxY } },
    { id: "edge-bottom", from: { x: boardShape.maxX, y: boardShape.maxY }, to: { x: boardShape.minX, y: boardShape.maxY } },
    { id: "edge-left", from: { x: boardShape.minX, y: boardShape.maxY }, to: { x: boardShape.minX, y: boardShape.minY } },
  ];
}

function PathRibbons({
  slots,
  routes,
  slotPositions,
  bounds,
  terraces,
}: {
  slots: Board3DSlot[];
  routes: MapRoute[];
  slotPositions: Map<number, Vec3>;
  bounds: Board3DMapBounds;
  terraces?: MapTerrace[];
}) {
  const renderedRoutes: MapRoute[] =
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
        const points = routeWorldPoints(route, slotPositions, bounds, terraces);
        return points.slice(0, -1).map((point, index) => (
          <RouteSegment
            key={`${route.id}-${index}`}
            from={point}
            to={points[index + 1]}
            style={style}
            showChoice={Boolean(route.choiceLabel) && index === 0}
          />
        ));
      })}
    </group>
  );
}

/** Umbral de desnivel a partir del cual el tramo se dibuja como escalera. */
const STAIR_HEIGHT_THRESHOLD = 0.2;

function RouteSegment({
  from,
  to,
  style,
  showChoice,
}: {
  from: Vec3;
  to: Vec3;
  style: ReturnType<typeof terrainMaterialStyle>;
  showChoice: boolean;
}) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const dy = to[1] - from[1];
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 0.01) return null;
  const yaw = -Math.atan2(dz, dx);
  const midX = (from[0] + to[0]) / 2;
  const midZ = (from[2] + to[2]) / 2;

  if (Math.abs(dy) > STAIR_HEIGHT_THRESHOLD) {
    return (
      <group>
        <RouteStairs from={from} to={to} width={style.width} />
        {showChoice && <ChoiceRing x={midX} y={Math.max(from[1], to[1]) + 0.13} z={midZ} style={style} />}
      </group>
    );
  }

  // tramo (casi) plano: la tira se inclina para apoyar en el terreno de ambas puntas
  const pitch = Math.atan2(dy, horizontal);
  const length = Math.hypot(horizontal, dy);

  return (
    <group position={[midX, (from[1] + to[1]) / 2 + 0.08, midZ]} rotation={[0, yaw, 0]}>
      <group rotation={[0, 0, pitch]}>
        <mesh receiveShadow>
          <boxGeometry args={[Math.max(0.2, length - 0.6), 0.05, style.width]} />
          <meshStandardMaterial color={style.top} roughness={0.48} metalness={0.04} />
        </mesh>
        <mesh position={[0, -0.035, 0]}>
          <boxGeometry args={[Math.max(0.2, length - 0.55), 0.04, style.width + 0.14]} />
          <meshStandardMaterial color={style.side} roughness={0.65} transparent opacity={0.52} />
        </mesh>
      </group>
      {showChoice && <ChoiceRing x={0} y={0.05} z={0} style={style} />}
    </group>
  );
}

function ChoiceRing({ x, y, z, style }: { x: number; y: number; z: number; style: ReturnType<typeof terrainMaterialStyle> }) {
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.16, 0.21, 24]} />
      <meshStandardMaterial color={style.glow} emissive={style.glow} emissiveIntensity={0.12} transparent opacity={0.82} side={DoubleSide} />
    </mesh>
  );
}

/** Escalerita de piedra que sube el desnivel de un tramo de ruta. */
function RouteStairs({ from, to, width }: { from: Vec3; to: Vec3; width: number }) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const dy = to[1] - from[1];
  const horizontal = Math.hypot(dx, dz);
  const yaw = -Math.atan2(dz, dx);
  const rise = Math.abs(dy);
  const count = Math.max(4, Math.min(8, Math.round(rise / 0.13)));
  const lowY = Math.min(from[1], to[1]);
  const stepLength = horizontal / count + 0.03;
  const stepWidth = width + 0.2;

  const steps = Array.from({ length: count }, (_, index) => {
    const t = (index + 0.5) / count;
    const upIndex = dy > 0 ? index : count - 1 - index;
    const topY = lowY + (rise * (upIndex + 1)) / count + 0.02;
    const baseY = lowY - 0.05;
    return {
      x: from[0] + dx * t,
      z: from[2] + dz * t,
      y: (baseY + topY) / 2,
      height: topY - baseY,
    };
  });

  return (
    <group>
      {steps.map((step, index) => (
        <group key={index} position={[step.x, step.y, step.z]} rotation={[0, yaw, 0]}>
          <mesh castShadow receiveShadow material={STONE_TILE_MATERIALS[1]} dispose={null}>
            <boxGeometry args={[stepLength, step.height, stepWidth]} />
          </mesh>
          <mesh position={[0, step.height / 2 + 0.012, 0]} receiveShadow material={STONE_TILE_MATERIALS[0]} dispose={null}>
            <boxGeometry args={[stepLength, 0.024, stepWidth]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function ArtifactTrajectoryBeam({ from, to }: { from: Vec3; to: Vec3 }) {
  const start = new Vector3(from[0], from[1] + 0.72, from[2]);
  const end = new Vector3(to[0], to[1] + 0.72, to[2]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length < 0.05) return null;
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.clone().normalize());

  return (
    <group>
      <mesh position={midpoint} quaternion={quaternion}>
        <cylinderGeometry args={[0.035, 0.035, length, 12]} />
        <meshStandardMaterial color="#67e8f9" emissive="#22d3ee" emissiveIntensity={0.5} transparent opacity={0.76} />
      </mesh>
      <mesh position={end} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.22, 0.025, 10, 28]} />
        <meshStandardMaterial color="#fde68a" emissive="#f59e0b" emissiveIntensity={0.38} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

/**
 * Cámara cinematográfica: sigue al muñeco que se mueve (posición viva vía ref),
 * se acerca con ángulo lateral durante la tirada del dado y respira suavemente
 * en reposo. Con reduced motion se comporta como la cámara fija de siempre.
 */
function CinematicCamera({
  mode,
  target,
  tokenRef,
  motion,
  walking,
  dice,
  turnKey,
  overview,
}: {
  mode: CameraMode;
  target: Vec3;
  tokenRef: { current: Vector3 | null };
  motion: BoardMotionSettings;
  walking: boolean;
  dice: boolean;
  turnKey: string;
  overview: BoardCameraShot;
}) {
  const { camera } = useThree();
  const initialized = useRef(false);
  const sideSign = useRef(1);
  const prevTurnKey = useRef<string | null>(null);
  const desired = useRef(new Vector3());
  const desiredLook = useRef(new Vector3());
  const look = useRef(new Vector3(target[0], target[1] * 0.55, target[2]));

  // Cambio de turno: alterna el costado de la cámara sin abrir una toma general automática.
  useEffect(() => {
    if (mode !== "followActivePlayer") {
      prevTurnKey.current = turnKey;
      return;
    }
    if (prevTurnKey.current !== null && turnKey && turnKey !== prevTurnKey.current) {
      sideSign.current *= -1;
    }
    prevTurnKey.current = turnKey;
  }, [mode, turnKey]);

  useLayoutEffect(() => {
    if (initialized.current && motion.cameraLerpSpeed !== 0) return;
    camera.position.set(...cameraFollowPosition(target));
    look.current.set(target[0], target[1] * 0.55, target[2]);
    camera.lookAt(look.current);
    camera.updateProjectionMatrix();
    initialized.current = true;
  }, [camera, motion.cameraLerpSpeed, target]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const animated = motion.cameraLerpSpeed > 0;
    const live = tokenRef.current;
    const anchor: Vec3 = animated && live ? [live.x, live.y, live.z] : target;

    if (mode === "overview") {
      desired.current.set(...overview.position);
      desiredLook.current.set(...overview.look);
    } else if (dice && animated) {
      // Tirada: más cerca, más abajo y con ángulo lateral (alterna por turno).
      const base = cameraFollowPosition(anchor);
      desired.current.set(anchor[0] + 1.35 * sideSign.current, base[1] - 0.85, anchor[2] + 4.7);
      desiredLook.current.set(anchor[0], anchor[1] + 0.75, anchor[2]);
    } else {
      const base = cameraFollowPosition(anchor);
      desired.current.set(base[0], base[1], base[2]);
      desiredLook.current.set(anchor[0], anchor[1] + 0.45, anchor[2]);
      if (animated && !walking) {
        // Respiración sutil en reposo + costado alternado: nada de cámara clavada.
        desired.current.x += Math.sin(t * 0.32) * 0.3 + 0.55 * sideSign.current;
        desired.current.y += Math.sin(t * 0.21) * 0.12;
        desired.current.z += Math.cos(t * 0.26) * 0.2;
      }
    }

    if (!animated) {
      camera.position.copy(desired.current);
      look.current.copy(desiredLook.current);
      camera.lookAt(look.current);
      return;
    }

    // Lerp adaptativo: acelera cuando quedó lejos (cambio de jugador al otro lado del mapa).
    const distance = camera.position.distanceTo(desired.current);
    const speed = motion.cameraLerpSpeed * (1 + Math.min(2, distance * 0.45));
    camera.position.lerp(desired.current, frameLerp(delta, speed));
    look.current.lerp(desiredLook.current, frameLerp(delta, speed * 1.2));
    camera.lookAt(look.current);
  });

  return null;
}

/**
 * Cámara de órbita libre para el Map Builder: arrastrar orbita alrededor del punto
 * de mira, la rueda hace zoom y click derecho (o Shift+arrastrar) desplaza el punto
 * de mira sobre el piso. Pensada para inspeccionar props de cerca y desde cualquier
 * ángulo mientras se editan; no se usa en la partida real.
 */
export function FreeOrbitCamera({ overview, refit = false }: { overview: BoardCameraShot; refit?: boolean }) {
  const { camera, gl, invalidate } = useThree();
  // Con refit, reencuadra cada vez que cambia la toma general (galería: nuevo prop o
  // nuevo tamaño). Sin refit, sólo encuadra una vez al montar (no pisa la vista al editar).
  const frameSignal = refit ? `${overview.position.join(",")}|${overview.look.join(",")}` : "once";
  const target = useRef(new Vector3(...overview.look));
  const desiredTarget = useRef(new Vector3(...overview.look));
  const spherical = useRef(new Spherical());
  const desired = useRef(new Spherical());
  const dragging = useRef<"orbit" | "pan" | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const scratch = useRef(new Vector3());

  // Encuadre inicial desde la toma general; se fija una sola vez porque el overview
  // del builder es estable mientras el preview está abierto (no queremos que la
  // cámara vuelva al centro cada vez que se mueve un prop).
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- Vector3.sub() is math here; no subscription or timer is created.
  useLayoutEffect(() => {
    const look = scratch.current.set(...overview.look);
    const offset = new Vector3(...overview.position).sub(look);
    spherical.current.setFromVector3(offset);
    spherical.current.makeSafe();
    desired.current.copy(spherical.current);
    target.current.set(...overview.look);
    desiredTarget.current.set(...overview.look);
    camera.position.set(...overview.position);
    camera.lookAt(target.current);
    camera.updateProjectionMatrix();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSignal]);

  useEffect(() => {
    const el = gl.domElement;
    const MIN_PHI = 0.1;
    const MAX_PHI = 1.5;
    const MIN_RADIUS = 1.4;
    const MAX_RADIUS = 80;

    const onPointerDown = (event: PointerEvent) => {
      dragging.current = event.button === 2 || event.shiftKey ? "pan" : "orbit";
      last.current = { x: event.clientX, y: event.clientY };
      el.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      const dx = event.clientX - last.current.x;
      const dy = event.clientY - last.current.y;
      last.current = { x: event.clientX, y: event.clientY };
      if (dragging.current === "orbit") {
        desired.current.theta -= dx * 0.005;
        desired.current.phi = clampNumber(desired.current.phi - dy * 0.005, MIN_PHI, MAX_PHI);
      } else {
        // Pan sobre el plano del piso, relativo al azimut actual (estilo "agarrar el mapa").
        const theta = desired.current.theta;
        const forwardX = -Math.sin(theta);
        const forwardZ = -Math.cos(theta);
        const rightX = -forwardZ;
        const rightZ = forwardX;
        const panScale = desired.current.radius * 0.0018;
        desiredTarget.current.x += (-rightX * dx - forwardX * dy) * panScale;
        desiredTarget.current.z += (-rightZ * dx - forwardZ * dy) * panScale;
      }
      invalidate();
    };
    const stop = (event: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = null;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // el puntero ya se soltó
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      desired.current.radius = clampNumber(desired.current.radius * Math.exp(event.deltaY * 0.0015), MIN_RADIUS, MAX_RADIUS);
      invalidate();
    };
    const onContextMenu = (event: Event) => event.preventDefault();

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [gl, invalidate]);

  useFrame((_, delta) => {
    const s = spherical.current;
    const d = desired.current;
    const k = frameLerp(delta, 14);
    s.phi += (d.phi - s.phi) * k;
    s.theta += (d.theta - s.theta) * k;
    s.radius += (d.radius - s.radius) * k;
    s.makeSafe();
    target.current.lerp(desiredTarget.current, k);
    const offset = scratch.current.setFromSpherical(s);
    camera.position.copy(target.current).add(offset);
    camera.lookAt(target.current);
    // En modo "demand" hay que pedir el próximo frame mientras la cámara aún se
    // acerca a su objetivo; si no, el amortiguado se congela a mitad de camino.
    const settled =
      Math.abs(d.phi - s.phi) < 1e-4 &&
      Math.abs(d.theta - s.theta) < 1e-4 &&
      Math.abs(d.radius - s.radius) < 1e-3 &&
      target.current.distanceToSquared(desiredTarget.current) < 1e-6;
    if (!settled) invalidate();
  });

  return null;
}

function AnimatedPartyLights({ motion }: { motion: BoardMotionSettings }) {
  const warm = useRef<PointLight | null>(null);
  const cool = useRef<PointLight | null>(null);
  const accent = useRef<PointLight | null>(null);
  const initial = orbitLightPosition(0, !motion.orbitLights);

  useFrame((state) => {
    if (!warm.current || !cool.current || !accent.current) return;
    const pos = orbitLightPosition(state.clock.elapsedTime, !motion.orbitLights);
    warm.current.position.set(...pos);
    cool.current.position.set(-pos[0], Math.max(3.8, pos[1] - 0.35), -pos[2]);
    // Third accent light moving at different phase
    const angle2 = state.clock.elapsedTime * 0.4 + Math.PI;
    accent.current.position.set(
      Math.cos(angle2) * 4.5,
      3.5 + Math.sin(state.clock.elapsedTime * 0.9) * 0.5,
      Math.sin(angle2) * 4.5
    );
    // Pulse intensity for festive feel
    warm.current.intensity = 1.05 + Math.sin(state.clock.elapsedTime * 2.2) * 0.18;
    accent.current.intensity = 0.55 + Math.sin(state.clock.elapsedTime * 1.7 + 1) * 0.12;
  });

  return (
    <>
      <pointLight ref={warm} position={initial} intensity={1.05} color="#fef08a" distance={14} decay={2} />
      <pointLight ref={cool} position={[-initial[0], 4.1, -initial[2]]} intensity={0.52} color="#67e8f9" distance={12} decay={2} />
      <pointLight ref={accent} position={[-4, 3.8, -4]} intensity={0.55} color="#f0abfc" distance={10} decay={2} />
    </>
  );
}

function SlotPlatform({
  slot,
  active,
  stepped,
  occupiedCount,
  animated,
}: {
  slot: Board3DSlot;
  active: boolean;
  stepped: boolean;
  occupiedCount: number;
  animated: boolean;
}) {
  const highlight = useRef<Group | null>(null);
  const style = slotMaterialStyle(slot.type);
  const isFinish = slot.type === "finish";
  const isStart = slot.type === "start";
  const top = isFinish ? FINISH_PLATFORM_HEIGHT : STONE_TILE_HEIGHT;

  useFrame((state) => {
    if (highlight.current && animated) highlight.current.rotation.y = state.clock.elapsedTime * 0.9;
  });

  return (
    <group position={slot.position} rotation={[0, slot.rotationY, 0]}>
      {/* Soft contact shadow */}
      <mesh position={[0.05, 0.006, 0.06]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[isFinish ? 1.0 : 0.66, 28]} />
        <meshStandardMaterial color="#1a1008" roughness={0.95} transparent opacity={0.32} />
      </mesh>

      {isFinish ? (
        <FinishPlatform active={active} />
      ) : (
        <>
          {/* Baldosa de piedra redondeada (geometría/material compartidos) */}
          <mesh
            castShadow
            receiveShadow
            geometry={STONE_TILE_GEOMETRY}
            material={STONE_TILE_MATERIALS}
            rotation={[-Math.PI / 2, 0, 0]}
            dispose={null}
          />

          {isStart ? (
            /* la salida es piedra con anillo verde; el cartel START la marca */
            <mesh position={[0, top + 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.28, 0.4, 32]} />
              <meshStandardMaterial
                color="#4ade80"
                emissive="#22c55e"
                emissiveIntensity={active ? 0.4 : 0.15}
                side={DoubleSide}
              />
            </mesh>
          ) : (
            <>
              {/* Medallón chico con el color del tipo de casillero */}
              <mesh receiveShadow position={[0, top + 0.011, 0]}>
                <cylinderGeometry args={[0.32, 0.32, 0.022, 26]} />
                <meshStandardMaterial color="#fdf6e3" roughness={0.4} metalness={0.05} />
              </mesh>
              <mesh receiveShadow position={[0, top + 0.03, 0]}>
                <cylinderGeometry args={[0.265, 0.265, 0.024, 26]} />
                <meshStandardMaterial
                  color={style.top}
                  roughness={0.34}
                  metalness={0.1}
                  emissive={active || stepped ? style.emissive : "#000000"}
                  emissiveIntensity={active ? 0.4 : stepped ? 0.16 : 0}
                />
              </mesh>
              {/* Decal del tipo, achicado para entrar en el medallón */}
              <group scale={[0.58, 1, 0.58]}>
                <SlotDecalMesh decal={style.decal} y={top + 0.05} color={style.accent} active={active} stepped={stepped} />
              </group>
            </>
          )}
        </>
      )}

      {/* Turn highlight: slow-rotating dashes, tile itself stays still */}
      {active && (
        <group ref={highlight} position={[0, top + 0.075, 0]} scale={isFinish ? [1.5, 1, 1.5] : [1, 1, 1]}>
          {[0, 1, 2, 3].map((index) => (
            <mesh key={index} rotation={[-Math.PI / 2, 0, (index * Math.PI) / 2]}>
              <ringGeometry args={[0.62, 0.7, 12, 1, 0, Math.PI / 3]} />
              <meshStandardMaterial
                color="#fde047"
                emissive="#fbbf24"
                emissiveIntensity={0.6}
                transparent
                opacity={0.9}
                side={DoubleSide}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* Static halo when tile is part of the walk path */}
      {stepped && !active && (
        <mesh position={[0, top + 0.072, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.56, 0.62, 36]} />
          <meshStandardMaterial color="#fef3c7" transparent opacity={0.4} side={DoubleSide} />
        </mesh>
      )}

      {occupiedCount > 1 && (
        <mesh position={[0, top + 0.071, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.46, 0.5, 36]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.22} side={DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

const FINISH_PLATFORM_HEIGHT = 0.32;

/** Plataforma de la META: disco navy grande con aro dorado y cara "META ↑". */
function FinishPlatform({ active }: { active: boolean }) {
  const texture = useMemo(() => makeMetaDiscTexture("META"), []);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group>
      <mesh castShadow receiveShadow position={[0, FINISH_PLATFORM_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[0.9, 1.0, FINISH_PLATFORM_HEIGHT, 40]} />
        <meshStandardMaterial color="#2c4272" roughness={0.5} metalness={0.08} />
      </mesh>
      <mesh receiveShadow position={[0, FINISH_PLATFORM_HEIGHT + 0.013, 0]}>
        <cylinderGeometry args={[0.94, 0.94, 0.026, 40]} />
        <meshStandardMaterial
          color="#f5c84c"
          roughness={0.35}
          metalness={0.35}
          emissive={active ? "#fbbf24" : "#000000"}
          emissiveIntensity={active ? 0.3 : 0}
        />
      </mesh>
      <mesh position={[0, FINISH_PLATFORM_HEIGHT + 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.86, 40]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
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

  if (decal === "spark") {
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

// ── Geometrías compartidas del token (una sola instancia para todos los pawns) ──
const TOKEN_BASE_GEOMETRY = new CylinderGeometry(0.2, 0.23, 0.07, 24);
const TOKEN_BODY_GEOMETRY = new SphereGeometry(0.19, 24, 18);
const TOKEN_HEAD_GEOMETRY = new SphereGeometry(0.135, 24, 18);
/** Calcomania facial enorme, casi impresa sobre la cabeza. */
const TOKEN_FACE_DECAL_GEOMETRY = makeCurvedTokenFaceGeometry();
const TOKEN_CROWN_GEOMETRY = new CylinderGeometry(0.05, 0.07, 0.05, 6);
const TOKEN_SHADOW_GEOMETRY = new CircleGeometry(0.2, 20);
const TOKEN_MARKER_GEOMETRY = new OctahedronGeometry(0.085);
const TOKEN_ARTIFACT_PACK_GEOMETRY = new SphereGeometry(0.095, 18, 14);
const TOKEN_ARTIFACT_PACK_FLAP_GEOMETRY = new CylinderGeometry(0.07, 0.074, 0.024, 18);
const TOKEN_ARTIFACT_PACK_STRAP_GEOMETRY = new TorusGeometry(0.047, 0.0045, 8, 18);
const TOKEN_GOGGLE_RING_GEOMETRY = new TorusGeometry(0.035, 0.006, 10, 24);
const TOKEN_GOGGLE_LENS_GEOMETRY = new CircleGeometry(0.029, 24);
const TOKEN_GOGGLE_BRIDGE_GEOMETRY = new CylinderGeometry(0.006, 0.006, 0.09, 12);
const TOKEN_MUSTACHE_LOBE_GEOMETRY = new SphereGeometry(0.04, 18, 12);
const TOKEN_BEARD_LOBE_GEOMETRY = new SphereGeometry(0.036, 18, 12);
const TOKEN_HAT_GEOMETRY = new ConeGeometry(0.085, 0.18, 24);
const TOKEN_HAT_BRIM_GEOMETRY = new CylinderGeometry(0.092, 0.1, 0.025, 24);
const TOKEN_PIERCING_GEOMETRY = new TorusGeometry(0.026, 0.0045, 10, 18);
const TOKEN_TATTOO_GEOMETRY = new CircleGeometry(0.038, 5);

/**
 * Cara del token: recibe cualquier THREE.Texture y la proyecta como una
 * calcomania curvada sobre la cabeza. Puede mostrar iniciales o una textura
 * circular creada desde la foto del jugador.
 */
function AvatarFace({ texture, opacity }: { texture: Texture; opacity: number }) {
  return (
    <mesh geometry={TOKEN_FACE_DECAL_GEOMETRY} dispose={null} renderOrder={4}>
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        toneMapped={false}
        depthWrite={false}
        side={DoubleSide}
        polygonOffset
        polygonOffsetFactor={-4}
      />
    </mesh>
  );
}

function makeCurvedTokenFaceGeometry(): BufferGeometry {
  const headCenterY = 0.5;
  const headRadius = 0.135;
  const faceCenterY = 0.505;
  const faceRadius = 0.132;
  const surfaceLift = 0.004;
  const radialSegments = 24;
  const angularSegments = 80;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring <= radialSegments; ring += 1) {
    const radius = (faceRadius * ring) / radialSegments;
    for (let segment = 0; segment <= angularSegments; segment += 1) {
      const angle = (segment / angularSegments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const vertical = Math.sin(angle) * radius;
      const y = faceCenterY + vertical;
      const dy = y - headCenterY;
      const z = Math.sqrt(Math.max(0, headRadius * headRadius - x * x - dy * dy)) + surfaceLift;
      positions.push(x, y, z);
      uvs.push(0.5 + x / (faceRadius * 2), 0.5 + vertical / (faceRadius * 2));
    }
  }

  for (let ring = 0; ring < radialSegments; ring += 1) {
    const row = ring * (angularSegments + 1);
    const nextRow = (ring + 1) * (angularSegments + 1);
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const a = row + segment;
      const b = row + segment + 1;
      const c = nextRow + segment;
      const d = nextRow + segment + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

type TokenCharacter = Pick<Player, "id" | "name" | "color" | "groom">;

export function PlayerTokenPawn({
  character,
  facePhoto,
  facePhotoAlignment,
  faceAnchors,
  bodyAnchors,
  cosmeticIds = [],
  cosmeticCatalog = {},
  opacity = 1,
  focused = false,
}: {
  character: TokenCharacter;
  facePhoto?: string;
  facePhotoAlignment?: FacePhotoAlignment;
  faceAnchors?: Record<string, FaceAnchor>;
  bodyAnchors?: Record<string, FaceAnchor>;
  cosmeticIds?: string[];
  cosmeticCatalog?: Record<string, CosmeticDef>;
  opacity?: number;
  focused?: boolean;
}) {
  const baseColor = useMemo(() => new Color(character.color).multiplyScalar(0.62), [character.color]);
  const initials = useMemo(() => playerInitials(character.name), [character.name]);
  const faceTextureRef = useRef<Texture | null>(null);
  const [faceTexture, setFaceTextureState] = useState<Texture>(() => {
    const texture = makeFaceTexture(initials, character.color);
    faceTextureRef.current = texture;
    return texture;
  });
  const replaceFaceTexture = useCallback((texture: Texture) => {
    const previousTexture = faceTextureRef.current;
    if (previousTexture && previousTexture !== texture) previousTexture.dispose();
    faceTextureRef.current = texture;
    setFaceTextureState(texture);
  }, []);

  useEffect(() => {
    let cancelled = false;
    replaceFaceTexture(makeFaceTexture(initials, character.color));
    const photo = facePhoto?.trim();
    const imagePromise = photo ? loadImage(photo) : loadPlayerPhoto(character.id);
    void imagePromise.then((image) => {
      if (cancelled || !image) return;
      const texture = makePhotoFaceTexture(image, character.color, facePhotoAlignment);
      if (cancelled) {
        texture.dispose();
        return;
      }
      replaceFaceTexture(texture);
    });
    return () => {
      cancelled = true;
    };
  }, [
    character.color,
    character.id,
    facePhoto,
    facePhotoAlignment?.angle,
    facePhotoAlignment?.scale,
    facePhotoAlignment?.x,
    facePhotoAlignment?.y,
    initials,
    replaceFaceTexture,
  ]);

  useEffect(
    () => () => {
      faceTextureRef.current?.dispose();
      faceTextureRef.current = null;
    },
    []
  );

  return (
    <>
      {/* Base disc */}
      <mesh castShadow position={[0, 0.035, 0]} geometry={TOKEN_BASE_GEOMETRY} dispose={null}>
        <meshStandardMaterial color={baseColor} roughness={0.5} metalness={0.15} transparent opacity={opacity * 0.95} />
      </mesh>
      {/* Cuerpo tipo juguete: silueta capsule (esfera achatada verticalmente) */}
      <mesh castShadow position={[0, 0.235, 0]} scale={[1, 1.15, 1]} geometry={TOKEN_BODY_GEOMETRY} dispose={null}>
        <meshStandardMaterial color={character.color} roughness={0.35} metalness={0.1} transparent opacity={opacity} />
      </mesh>
      {/* Cabeza redonda */}
      <mesh castShadow position={[0, 0.5, 0]} geometry={TOKEN_HEAD_GEOMETRY} dispose={null}>
        <meshStandardMaterial color={character.color} roughness={0.3} metalness={0.08} transparent opacity={opacity} />
      </mesh>
      {/* Placa facial plana mirando a +Z (cámara): iniciales o la foto alineada */}
      <AvatarFace texture={faceTexture} opacity={opacity} />
      {/* Corona dorada para el novio/a */}
      {character.groom && (
        <mesh castShadow position={[0, 0.615, 0]} geometry={TOKEN_CROWN_GEOMETRY} dispose={null}>
          <meshStandardMaterial color="#facc15" emissive="#f59e0b" emissiveIntensity={0.35} roughness={0.35} metalness={0.4} transparent opacity={opacity} />
        </mesh>
      )}
      <TokenCosmetics cosmeticIds={cosmeticIds} cosmetics={cosmeticCatalog} faceAnchors={faceAnchors} bodyAnchors={bodyAnchors} opacity={opacity} />
      {focused && (
        <group position={[0, 0.11, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.33, 0.44, 40]} />
            <meshStandardMaterial color="#67e8f9" emissive="#0891b2" emissiveIntensity={0.5} transparent opacity={0.95} side={DoubleSide} />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.5, 0.55, 40]} />
            <meshStandardMaterial color="#fff4bf" emissive="#f5d547" emissiveIntensity={0.28} transparent opacity={0.7} side={DoubleSide} />
          </mesh>
        </group>
      )}
      {/* Soft shadow disc */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={TOKEN_SHADOW_GEOMETRY} dispose={null}>
        <meshStandardMaterial color="#000000" transparent opacity={focused ? 0.22 : 0.18} side={DoubleSide} />
      </mesh>
    </>
  );
}

/** Ids de cosméticos conocidos, para el catálogo/galería. */
export const COSMETIC_IDS = [
  "party-goggles",
  "big-mustache",
  "mustache-handlebar",
  "mustache-pencil",
  "mustache-chaplin",
  "party-hat",
  "top-hat",
  "cap",
  "field-hat",
  "coin-crown",
  "gold-chain",
  "dice-necklace",
  "wristwatch",
  "tuxedo",
  "pet-dog",
  "pet-cat",
  "corona-rey",
  "sombrero-mariachi",
  "gorro-bufon",
  "casco-vikingo",
  "corona-laurel",
  "aureola",
  "cuernos-diablo",
  "gorro-hongo",
  "helice-gorro",
  "corona-flores",
  "casco-obra",
  "sombrero-bruja",
  "cresta-punk",
  "fez",
  "aleta-tiburon",
  "pulpo-sombrero",
  "banana-cabeza",
  "lentes-corazon",
  "lentes-estrella",
  "monoculo",
  "lentes-3d",
  "antifaz",
  "parche-pirata",
  "lentes-pixel",
  "nariz-payaso",
  "ojos-saltones",
  "chupete",
  "puro",
  "pipa",
  "diente-oro",
  "barba-vikinga",
  "globo-chicle",
  "banda-novio",
  "medalla-oro",
  "armadura-caballero",
  "chaleco-salvavidas",
  "bandolera",
  "corbata-luces",
  "collar-hawaiano",
  "mochila-jet",
  "alas-angel",
  "alas-demonio",
  "caparazon-tortuga",
  "capa-super",
  "tanque-buzo",
  "alas-hada",
  "guantes-boxeo",
  "sable-laser",
  "varita-magica",
  "maracas",
  "copa-champan",
  "jarra-cerveza",
  "antorcha",
  "globo-perro",
] as const;

function TokenCosmetics({
  cosmeticIds,
  cosmetics,
  faceAnchors,
  bodyAnchors,
  opacity,
}: {
  cosmeticIds: string[];
  cosmetics: Record<string, CosmeticDef>;
  faceAnchors?: Record<string, FaceAnchor>;
  bodyAnchors?: Record<string, FaceAnchor>;
  opacity: number;
}) {
  const equipped = useMemo(
    () =>
      cosmeticIds
        .map((id) => cosmetics[id] ?? normalizeCosmeticDef({ id, name: id, assetId: id }))
        .sort((a, b) => (a.preview?.order ?? 0) - (b.preview?.order ?? 0) || a.name.localeCompare(b.name)),
    [cosmeticIds, cosmetics]
  );

  if (!equipped.length) return null;

  return (
    <>
      {equipped.map((cosmetic) => (
        <TokenCosmetic
          key={cosmetic.id}
          cosmetic={cosmetic}
          faceAnchors={faceAnchors}
          bodyAnchors={bodyAnchors}
          opacity={opacity}
        />
      ))}
    </>
  );
}

type CosmeticAnchors = {
  leftEye: Vec3;
  rightEye: Vec3;
  mouth: Vec3;
  head: Vec3;
  chest: Vec3;
  leftHand: Vec3;
  rightHand: Vec3;
  back: Vec3;
};

      function CosmeticAureola({ a, opacity }: { a: CosmeticAnchors; opacity: number }) {
        const ref = useRef<Group | null>(null);
        useFrame((state) => {
          if (!ref.current) return;
          const t = state.clock.elapsedTime;
          ref.current.position.y = a.head[1] + 0.19 + Math.sin(t * 1.6) * 0.02;
          ref.current.rotation.y = t * 0.6;
        });
        return (
          <group ref={ref} position={[0, a.head[1] + 0.19, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.075, 0.014, 14, 40]} />
              <meshStandardMaterial color={"#f5c542"} emissive="#fbbf24" emissiveIntensity={1.2} metalness={0.6} roughness={0.25} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1.35, 1.35, 1.35]}>
              <torusGeometry args={[0.075, 0.02, 12, 40]} />
              <meshBasicMaterial color="#fde68a" transparent opacity={opacity * 0.22} toneMapped={false} side={DoubleSide} />
            </mesh>
          </group>
        );
      }

      function CosmeticHeliceGorro({ a, opacity }: { a: CosmeticAnchors; opacity: number }) {
        const propRef = useRef<Group | null>(null);
        useFrame((state) => {
          if (!propRef.current) return;
          propRef.current.rotation.y = state.clock.elapsedTime * 14;
        });
        const panelColors = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
        const bladeColors = ["#f43f5e", "#22d3ee", "#facc15"];
        return (
          <group position={[0, a.head[1] + 0.02, 0]}>
            {panelColors.map((c, i) => (
              <mesh key={i} position={[0, 0.055, 0]} scale={[1, 0.6, 1]}>
                <sphereGeometry
                  args={[
                    0.11,
                    10,
                    12,
                    (i / panelColors.length) * Math.PI * 2,
                    (Math.PI * 2) / panelColors.length,
                    0,
                    Math.PI / 2,
                  ]}
                />
                <meshStandardMaterial color={c} roughness={0.45} side={DoubleSide} transparent opacity={opacity} />
              </mesh>
            ))}
            <mesh position={[0, 0.006, 0]}>
              <torusGeometry args={[0.11, 0.014, 10, 28]} />
              <meshStandardMaterial color="#ffffff" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.112, 0]}>
              <sphereGeometry args={[0.018, 14, 12]} />
              <meshStandardMaterial color="#f5c542" metalness={0.7} roughness={0.25} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.14, 0]}>
              <cylinderGeometry args={[0.006, 0.006, 0.05, 10]} />
              <meshStandardMaterial color="#111827" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <group ref={propRef} position={[0, 0.168, 0]}>
              {bladeColors.map((c, i) => (
                <mesh
                  key={i}
                  rotation={[0, (i / bladeColors.length) * Math.PI * 2, 0]}
                  position={[
                    Math.cos((i / bladeColors.length) * Math.PI * 2) * 0.045,
                    0,
                    -Math.sin((i / bladeColors.length) * Math.PI * 2) * 0.045,
                  ]}
                >
                  <boxGeometry args={[0.09, 0.006, 0.025]} />
                  <meshStandardMaterial color={c} roughness={0.35} side={DoubleSide} transparent opacity={opacity} toneMapped={false} />
                </mesh>
              ))}
              <mesh>
                <sphereGeometry args={[0.014, 12, 10]} />
                <meshStandardMaterial color="#f5c542" metalness={0.7} roughness={0.25} transparent opacity={opacity} />
              </mesh>
            </group>
          </group>
        );
      }

      function CosmeticOjosSaltones({ a, opacity }: { a: CosmeticAnchors; opacity: number }) {
        const leftRef = useRef<Group | null>(null);
        const rightRef = useRef<Group | null>(null);
        useFrame((state) => {
          const t = state.clock.elapsedTime;
          if (leftRef.current) {
            leftRef.current.position.x = a.leftEye[0] + Math.sin(t * 6) * 0.012;
            leftRef.current.position.y = a.leftEye[1] + Math.sin(t * 5 + 1.1) * 0.014;
            leftRef.current.rotation.z = Math.sin(t * 4) * 0.28;
          }
          if (rightRef.current) {
            rightRef.current.position.x = a.rightEye[0] + Math.sin(t * 6 + 2.3) * 0.012;
            rightRef.current.position.y = a.rightEye[1] + Math.sin(t * 5 + 3.4) * 0.014;
            rightRef.current.rotation.z = Math.sin(t * 4 + 1.7) * 0.28;
          }
        });
        const springColors = ["#f43f5e", "#f59e0b", "#22d3ee", "#a855f7", "#f43f5e", "#f59e0b"];
        const eyes: Array<{ ref: typeof leftRef; p: Vec3; k: string }> = [
          { ref: leftRef, p: a.leftEye, k: "L" },
          { ref: rightRef, p: a.rightEye, k: "R" },
        ];
        return (
          <group>
            {eyes.map((e) => (
              <group key={e.k} ref={e.ref} position={[e.p[0], e.p[1], e.p[2] + 0.03]}>
                {springColors.map((c, ci) => (
                  <mesh key={ci} position={[0, 0, ci * 0.013]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[0.015, 0.0045, 8, 16]} />
                    <meshStandardMaterial color={c} metalness={0.5} roughness={0.3} transparent opacity={opacity} />
                  </mesh>
                ))}
                <mesh position={[0, 0, 0.115]}>
                  <sphereGeometry args={[0.045, 20, 20]} />
                  <meshStandardMaterial color="#ffffff" roughness={0.25} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, 0, 0.156]}>
                  <sphereGeometry args={[0.02, 16, 16]} />
                  <meshStandardMaterial color="#111827" roughness={0.2} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0.007, 0.007, 0.17]}>
                  <sphereGeometry args={[0.007, 12, 12]} />
                  <meshBasicMaterial color="#ffffff" transparent opacity={opacity} toneMapped={false} />
                </mesh>
              </group>
            ))}
          </group>
        );
      }

      function CosmeticGloboChicle({ a, opacity }: { a: CosmeticAnchors; opacity: number }) {
        const ref = useRef<Group | null>(null);
        useFrame((state) => {
          if (!ref.current) return;
          const t = state.clock.elapsedTime;
          const s = 0.95 + Math.sin(t * 1.6) * 0.35;
          ref.current.scale.set(s, s, s);
        });
        return (
          <group ref={ref} position={[a.mouth[0], a.mouth[1] - 0.01, a.mouth[2] + 0.09]}>
            <mesh position={[0, -0.05, -0.02]}>
              <cylinderGeometry args={[0.006, 0.012, 0.035, 12]} />
              <meshStandardMaterial color="#ff6fb5" roughness={0.25} transparent opacity={opacity * 0.85} />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.06, 24, 24]} />
              <meshStandardMaterial
                color="#ff6fb5"
                emissive="#ff8ec7"
                emissiveIntensity={0.25}
                metalness={0.1}
                roughness={0.08}
                transparent
                opacity={opacity * 0.82}
              />
            </mesh>
            <mesh position={[-0.02, 0.022, 0.045]}>
              <sphereGeometry args={[0.015, 14, 14]} />
              <meshBasicMaterial color="#ffe3f2" transparent opacity={opacity * 0.7} toneMapped={false} />
            </mesh>
          </group>
        );
      }

      function CosmeticMochilaJet({ a, opacity }: { a: CosmeticAnchors; opacity: number }) {
        const ref = useRef<Group | null>(null);
        useFrame((state) => {
          if (!ref.current) return;
          const t = state.clock.elapsedTime;
          const flames = ref.current.children;
          for (let i = 0; i < flames.length; i++) {
            const f = flames[i] as unknown as Group;
            const phase = t * 22 + i * 2.1;
            const s = 0.72 + Math.sin(phase) * 0.28 + Math.sin(phase * 2.3) * 0.12;
            f.scale.set(1, Math.max(0.35, s), 1);
          }
        });
        const tankOffsets = [-0.055, 0.055];
        const tankColors = ["#9ca3af", "#ef4444"];
        const baseY = a.chest[1] + 0.02;
        const baseZ = a.back[2] - 0.06;
        const flameTopY = baseY - 0.135;
        return (
          <group>
            {tankOffsets.map((ox, i) => (
              <group key={`tank-${i}`} position={[ox, baseY, baseZ]}>
                <mesh>
                  <cylinderGeometry args={[0.03, 0.03, 0.17, 16]} />
                  <meshStandardMaterial color={tankColors[i]} metalness={0.7} roughness={0.3} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, 0.095, 0]}>
                  <sphereGeometry args={[0.03, 16, 12]} />
                  <meshStandardMaterial color="#d1d5db" metalness={0.75} roughness={0.25} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, 0, 0.025]}>
                  <boxGeometry args={[0.02, 0.11, 0.008]} />
                  <meshStandardMaterial color={"#f5c542"} metalness={0.8} roughness={0.25} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, -0.11, 0]}>
                  <coneGeometry args={[0.028, 0.05, 16]} />
                  <meshStandardMaterial color="#4b5563" metalness={0.8} roughness={0.3} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
            <group ref={ref}>
              {tankOffsets.map((ox, i) => (
                <group key={`flame-${i}`} position={[ox, flameTopY, baseZ]}>
                  <mesh position={[0, -0.045, 0]} rotation={[Math.PI, 0, 0]}>
                    <coneGeometry args={[0.026, 0.09, 14]} />
                    <meshBasicMaterial color="#fb923c" transparent opacity={opacity * 0.85} toneMapped={false} />
                  </mesh>
                  <mesh position={[0, -0.032, 0]} rotation={[Math.PI, 0, 0]}>
                    <coneGeometry args={[0.014, 0.058, 12]} />
                    <meshBasicMaterial color="#60a5fa" transparent opacity={opacity * 0.95} toneMapped={false} />
                  </mesh>
                </group>
              ))}
            </group>
          </group>
        );
      }

function CosmeticSableLaser({ a, opacity }: { a: CosmeticAnchors; opacity: number }) {
  const blade = useRef<Group | null>(null);
  useFrame((state) => {
    if (!blade.current) return;
    const t = state.clock.elapsedTime;
    blade.current.scale.y = 1 + Math.sin(t * 22) * 0.02 + Math.sin(t * 9) * 0.015;
  });
  return (
    <group position={[a.rightHand[0] + 0.02, a.rightHand[1] + 0.03, a.rightHand[2] + 0.02]} rotation={[0, 0, -0.15]}>
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.06, 12]} />
        <meshStandardMaterial color="#6b7280" metalness={0.8} roughness={0.3} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, 0.006, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.008, 12]} />
        <meshStandardMaterial color="#111827" metalness={0.6} roughness={0.4} transparent opacity={opacity} />
      </mesh>
      <group ref={blade} position={[0, 0.03, 0]}>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.009, 0.009, 0.24, 12]} />
          <meshStandardMaterial color="#bbf7d0" emissive="#22c55e" emissiveIntensity={1.1} transparent opacity={opacity} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.016, 0.016, 0.235, 12]} />
          <meshBasicMaterial color="#4ade80" transparent opacity={opacity * 0.25} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <sphereGeometry args={[0.009, 10, 8]} />
          <meshStandardMaterial color="#dcfce7" emissive="#22c55e" emissiveIntensity={1.1} transparent opacity={opacity} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function CosmeticAntorcha({ a, opacity }: { a: CosmeticAnchors; opacity: number }) {
  const flame = useRef<Group | null>(null);
  useFrame((state) => {
    if (!flame.current) return;
    const t = state.clock.elapsedTime;
    flame.current.scale.y = 1 + Math.sin(t * 15) * 0.12 + Math.sin(t * 27) * 0.06;
    flame.current.scale.x = 1 + Math.sin(t * 19) * 0.05;
    flame.current.rotation.z = Math.sin(t * 6) * 0.08;
  });
  return (
    <group position={[a.rightHand[0] + 0.02, a.rightHand[1] + 0.03, a.rightHand[2] + 0.02]}>
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.011, 0.013, 0.11, 10]} />
        <meshStandardMaterial color="#5b3a1e" roughness={0.7} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.02, 0.016, 0.03, 10]} />
        <meshStandardMaterial color="#3a2412" roughness={0.6} transparent opacity={opacity} />
      </mesh>
      <group ref={flame} position={[0, 0.06, 0]}>
        <mesh position={[0, 0.05, 0]}>
          <coneGeometry args={[0.03, 0.11, 12]} />
          <meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={0.9} transparent opacity={opacity * 0.9} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <coneGeometry args={[0.02, 0.09, 12]} />
          <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={1} transparent opacity={opacity} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.065, 0]}>
          <coneGeometry args={[0.011, 0.06, 10]} />
          <meshStandardMaterial color="#fef9c3" emissive="#fde68a" emissiveIntensity={1.2} transparent opacity={opacity} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function TokenCosmetic({
  cosmetic,
  faceAnchors,
  bodyAnchors,
  opacity,
}: {
  cosmetic: CosmeticDef;
  faceAnchors?: Record<string, FaceAnchor>;
  bodyAnchors?: Record<string, FaceAnchor>;
  opacity: number;
}) {
  const kind = cosmeticAssetKind(cosmetic);
  const primary = cosmeticColor(cosmetic, "color", defaultCosmeticColor(kind));
  const secondary = cosmeticColor(cosmetic, "secondaryColor", kind === "goggles" ? "#67e8f9" : primary);
  const rotation = cosmeticRotation(cosmetic);
  const scale = cosmeticScale(cosmetic);

  if (kind === "goggles") {
    const anchorRefs = cosmeticAnchorRefs(cosmetic);
    const firstRef = anchorRefs[0] ?? { anchorType: "face" as const, anchorId: "leftEye" };
    const secondRef = anchorRefs[1] ?? { anchorType: "face" as const, anchorId: firstRef.anchorId === "leftEye" ? "rightEye" : firstRef.anchorId };
    const leftEye = anchorSurfaceForRef(firstRef, faceAnchors, bodyAnchors);
    const rightEye = anchorSurfaceForRef(secondRef, faceAnchors, bodyAnchors);
    const z = Math.max(leftEye[2], rightEye[2]) + 0.026 + (cosmetic.transform?.z ?? 0);
    return (
      <group rotation={[0, 0, rotation]}>
        {[leftEye, rightEye].map((position, index) => (
          <group
            key={index}
            position={[
              position[0] + (cosmetic.transform?.x ?? 0),
              position[1] + (cosmetic.transform?.y ?? 0),
              position[2] + 0.026 + (cosmetic.transform?.z ?? 0),
            ]}
            scale={scale}
          >
            <mesh geometry={TOKEN_GOGGLE_LENS_GEOMETRY} dispose={null}>
              <meshBasicMaterial color={secondary} transparent opacity={opacity * 0.45} side={DoubleSide} toneMapped={false} />
            </mesh>
            <mesh geometry={TOKEN_GOGGLE_RING_GEOMETRY} dispose={null}>
              <meshStandardMaterial color={primary} roughness={0.32} metalness={0.18} transparent opacity={opacity} />
            </mesh>
          </group>
        ))}
        <mesh
          position={[(leftEye[0] + rightEye[0]) / 2 + (cosmetic.transform?.x ?? 0), (leftEye[1] + rightEye[1]) / 2 + (cosmetic.transform?.y ?? 0), z]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[scale[0], scale[1], scale[2]]}
          geometry={TOKEN_GOGGLE_BRIDGE_GEOMETRY}
          dispose={null}
        >
          <meshStandardMaterial color={primary} roughness={0.35} metalness={0.15} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "mustache") {
    const mouth = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: -0.02, z: 0.032 });
    return (
      <group position={mouth} rotation={[0, 0, rotation]}>
        <mesh position={[-0.035, 0, 0]} rotation={[0, 0, -0.25]} scale={[1.35 * scale[0], 0.42 * scale[1], 0.25 * scale[2]]} geometry={TOKEN_MUSTACHE_LOBE_GEOMETRY} dispose={null}>
          <meshStandardMaterial color={primary} roughness={0.58} metalness={0.02} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0.035, 0, 0]} rotation={[0, 0, 0.25]} scale={[1.35 * scale[0], 0.42 * scale[1], 0.25 * scale[2]]} geometry={TOKEN_MUSTACHE_LOBE_GEOMETRY} dispose={null}>
          <meshStandardMaterial color={primary} roughness={0.58} metalness={0.02} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "mustache-handlebar") {
    const mouth = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: -0.005, z: 0.03 });
    return (
      <group position={mouth} rotation={[0, 0, rotation]} scale={scale}>
        <mesh scale={[1.3, 0.34, 0.3]}>
          <sphereGeometry args={[0.045, 12, 8]} />
          <meshStandardMaterial color={primary} roughness={0.6} transparent opacity={opacity} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.06, 0.02, 0.006]} rotation={[Math.PI / 2, 0, side * 0.9]}>
            <torusGeometry args={[0.02, 0.008, 6, 12, Math.PI * 1.3]} />
            <meshStandardMaterial color={primary} roughness={0.6} transparent opacity={opacity} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === "mustache-pencil") {
    const mouth = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: 0.005, z: 0.03 });
    return (
      <group position={mouth} rotation={[0, 0, rotation]} scale={scale}>
        <mesh scale={[1, 0.16, 0.22]}>
          <boxGeometry args={[0.11, 0.02, 0.02]} />
          <meshStandardMaterial color={primary} roughness={0.5} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "mustache-chaplin") {
    const mouth = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: 0.002, z: 0.032 });
    return (
      <group position={mouth} rotation={[0, 0, rotation]} scale={scale}>
        <mesh scale={[0.52, 0.7, 0.24]}>
          <boxGeometry args={[0.07, 0.055, 0.02]} />
          <meshStandardMaterial color={primary} roughness={0.55} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "beard") {
    const mouth = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: -0.065, z: 0.032 });
    return (
      <group position={mouth} rotation={[0, 0, rotation]} scale={scale}>
        {[-0.05, 0, 0.05].map((x, index) => (
          <mesh key={index} position={[x, index === 1 ? -0.014 : 0.006, 0]} scale={[1.12, 0.8, 0.35]} geometry={TOKEN_BEARD_LOBE_GEOMETRY} dispose={null}>
            <meshStandardMaterial color={primary} roughness={0.7} metalness={0.01} transparent opacity={opacity} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === "top-hat") {
    const head = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: 0.02 });
    return (
      <group position={head} rotation={[0, 0, rotation]} scale={scale}>
        <mesh position={[0, 0.012, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.016, 20]} />
          <meshStandardMaterial color={primary} roughness={0.4} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.085, 0.09, 0.2, 20]} />
          <meshStandardMaterial color={primary} roughness={0.4} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.045, 0]}>
          <cylinderGeometry args={[0.092, 0.092, 0.03, 20]} />
          <meshStandardMaterial color={secondary} roughness={0.5} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "cap") {
    const head = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: 0.02 });
    return (
      <group position={head} rotation={[0, 0, rotation]} scale={scale}>
        <mesh position={[0, 0.03, 0]}>
          <sphereGeometry args={[0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={primary} roughness={0.55} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.02, 0.11]} rotation={[-0.25, 0, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.016, 16, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color={secondary} roughness={0.55} side={DoubleSide} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.11, 0]}>
          <sphereGeometry args={[0.014, 8, 6]} />
          <meshStandardMaterial color={secondary} roughness={0.5} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "field-hat") {
    const head = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: 0.02 });
    return (
      <group position={head} rotation={[0, 0, rotation]} scale={scale}>
        <mesh position={[0, 0.012, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.012, 20]} />
          <meshStandardMaterial color={primary} roughness={0.7} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.065, 0]}>
          <cylinderGeometry args={[0.072, 0.09, 0.1, 16]} />
          <meshStandardMaterial color={primary} roughness={0.7} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.035, 0]}>
          <cylinderGeometry args={[0.092, 0.092, 0.022, 16]} />
          <meshStandardMaterial color={secondary} roughness={0.75} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "coin-crown") {
    const head = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: 0.02 });
    return (
      <group position={head} rotation={[0, 0, rotation]} scale={scale}>
        <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.1, 0.016, 8, 20]} />
          <meshStandardMaterial color={primary} metalness={0.85} roughness={0.2} transparent opacity={opacity} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const angle = (index / 6) * Math.PI * 2;
          return (
            <mesh key={index} position={[Math.cos(angle) * 0.1, 0.075, Math.sin(angle) * 0.1]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.026, 0.026, 0.008, 14]} />
              <meshStandardMaterial color={primary} metalness={0.85} roughness={0.22} transparent opacity={opacity} />
            </mesh>
          );
        })}
      </group>
    );
  }

  if (kind === "hat") {
    const head = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { z: -0.025 });
    return (
      <group position={head} rotation={[0.12, 0, -0.08 + rotation]} scale={scale}>
        <mesh position={[0, 0.072, 0]} geometry={TOKEN_HAT_GEOMETRY} dispose={null}>
          <meshStandardMaterial color={primary} emissive={primary} emissiveIntensity={0.12} roughness={0.5} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, -0.006, 0]} geometry={TOKEN_HAT_BRIM_GEOMETRY} dispose={null}>
          <meshStandardMaterial color={secondary} roughness={0.38} metalness={0.08} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "gold-chain" || kind === "dice-necklace") {
    const chest = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { y: 0.07, z: -0.02 });
    const isDice = kind === "dice-necklace";
    return (
      <group position={chest} rotation={[0, 0, rotation]} scale={scale}>
        <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.68]}>
          <torusGeometry args={[0.12, isDice ? 0.009 : 0.013, 8, 26]} />
          <meshStandardMaterial color={primary} metalness={0.8} roughness={0.24} transparent opacity={opacity} />
        </mesh>
        {isDice ? (
          <>
            <mesh position={[0, -0.08, 0.045]} rotation={[0.2, 0.4, 0]}>
              <boxGeometry args={[0.05, 0.05, 0.05]} />
              <meshStandardMaterial color={secondary} roughness={0.4} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, -0.08, 0.072]}>
              <sphereGeometry args={[0.007, 6, 6]} />
              <meshStandardMaterial color="#111827" transparent opacity={opacity} />
            </mesh>
          </>
        ) : (
          <mesh position={[0, -0.07, 0.03]}>
            <sphereGeometry args={[0.022, 10, 8]} />
            <meshStandardMaterial color={primary} metalness={0.85} roughness={0.22} transparent opacity={opacity} />
          </mesh>
        )}
      </group>
    );
  }

  if (kind === "wristwatch") {
    const hand = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { z: 0.008 });
    return (
      <group position={hand} rotation={[0, 0, rotation]} scale={scale}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.032, 0.032, 0.022, 14, 1, true]} />
          <meshStandardMaterial color={primary} roughness={0.6} side={DoubleSide} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0, 0.03]}>
          <cylinderGeometry args={[0.026, 0.026, 0.012, 16]} />
          <meshStandardMaterial color={secondary} metalness={0.6} roughness={0.3} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0, 0.037]}>
          <cylinderGeometry args={[0.02, 0.02, 0.003, 16]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.4} transparent opacity={opacity} />
        </mesh>
      </group>
    );
  }

  if (kind === "tuxedo") {
    return (
      <group
        position={[cosmetic.transform?.x ?? 0, cosmetic.transform?.y ?? 0, cosmetic.transform?.z ?? 0]}
        rotation={[0, 0, rotation]}
        scale={scale}
      >
        <mesh position={[0, 0.235, 0]} scale={[1.06, 1.12, 1.06]}>
          <sphereGeometry args={[0.19, 20, 14]} />
          <meshStandardMaterial color={primary} roughness={0.5} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.24, 0.18]}>
          <boxGeometry args={[0.07, 0.22, 0.02]} />
          <meshStandardMaterial color={secondary} roughness={0.5} transparent opacity={opacity} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.055, 0.31, 0.185]} rotation={[0, 0, side * 0.5]}>
            <boxGeometry args={[0.035, 0.12, 0.01]} />
            <meshStandardMaterial color="#1f2937" roughness={0.5} transparent opacity={opacity} />
          </mesh>
        ))}
        {[-1, 1].map((side) => (
          <mesh key={`bow-${side}`} position={[side * 0.028, 0.4, 0.17]} rotation={[0, 0, side * 0.5]} scale={[1.5, 0.85, 0.4]}>
            <sphereGeometry args={[0.03, 10, 8]} />
            <meshStandardMaterial color="#111827" roughness={0.5} transparent opacity={opacity} />
          </mesh>
        ))}
        {[0.29, 0.23].map((y) => (
          <mesh key={y} position={[0, y, 0.2]}>
            <sphereGeometry args={[0.008, 6, 6]} />
            <meshStandardMaterial color="#f5c542" metalness={0.8} roughness={0.25} transparent opacity={opacity} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === "pet-dog" || kind === "pet-cat") {
    return (
      <PetCompanion
        opacity={opacity}
        kind={kind === "pet-dog" ? "dog" : "cat"}
        color={primary}
        secondaryColor={secondary}
      />
    );
  }

  if (kind === "piercing") {
    const chest = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { z: 0.04 });
    return (
      <group position={chest} rotation={[0, 0, rotation]} scale={scale}>
        {[-0.045, 0.045].map((x) => (
          <mesh key={x} position={[x, 0, 0]} geometry={TOKEN_PIERCING_GEOMETRY} dispose={null}>
            <meshStandardMaterial color={primary} roughness={0.25} metalness={0.65} transparent opacity={opacity} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === "tattoo") {
    const chest = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { z: 0.04 });
    return (
      <group position={chest} rotation={[0, 0, rotation]} scale={scale}>
        <mesh rotation={[0, 0, Math.PI / 4]} geometry={TOKEN_TATTOO_GEOMETRY} dispose={null}>
          <meshBasicMaterial color={primary} transparent opacity={opacity * 0.85} side={DoubleSide} toneMapped={false} />
        </mesh>
        <mesh position={[0.012, -0.03, 0.001]} rotation={[0, 0, Math.PI / 4]} scale={[0.7, 1.15, 1]} geometry={TOKEN_TATTOO_GEOMETRY} dispose={null}>
          <meshBasicMaterial color={primary} transparent opacity={opacity * 0.85} side={DoubleSide} toneMapped={false} />
        </mesh>
      </group>
    );
  }

  const a: CosmeticAnchors = {
    leftEye: anchorSurface("face", "leftEye", faceAnchors, bodyAnchors),
    rightEye: anchorSurface("face", "rightEye", faceAnchors, bodyAnchors),
    mouth: anchorSurface("face", "mouth", faceAnchors, bodyAnchors),
    head: anchorSurface("body", "head", faceAnchors, bodyAnchors),
    chest: anchorSurface("body", "chest", faceAnchors, bodyAnchors),
    leftHand: anchorSurface("body", "leftHand", faceAnchors, bodyAnchors),
    rightHand: anchorSurface("body", "rightHand", faceAnchors, bodyAnchors),
    back: anchorSurface("body", "back", faceAnchors, bodyAnchors),
  };
  const black = "#111827";
  const gold = "#f5c542";
  const hatBase: Vec3 = [0, a.head[1] + 0.02, 0];
  if (kind === "corona-rey") {
    {
        const gems = ["#ef4444", "#3b82f6", "#22c55e", "#ef4444", "#3b82f6"];
        const bandR = 0.105;
        return (
          <group position={[0, a.head[1] + 0.05, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[bandR, 0.02, 12, 28]} />
              <meshStandardMaterial color={gold} metalness={0.9} roughness={0.15} transparent opacity={opacity} />
            </mesh>
            {gems.map((gem, i) => {
              const ang = (i / gems.length) * Math.PI * 2;
              const px = Math.cos(ang) * bandR;
              const pz = Math.sin(ang) * bandR;
              return (
                <group key={i} position={[px, 0, pz]}>
                  <mesh position={[0, 0.05, 0]}>
                    <coneGeometry args={[0.024, 0.08, 12]} />
                    <meshStandardMaterial color={gold} metalness={0.9} roughness={0.15} transparent opacity={opacity} />
                  </mesh>
                  <mesh position={[0, 0.104, 0]}>
                    <octahedronGeometry args={[0.022, 0]} />
                    <meshStandardMaterial color={gem} emissive={gem} emissiveIntensity={0.35} metalness={0.3} roughness={0.1} transparent opacity={opacity} toneMapped={false} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      }
  }
  if (kind === "sombrero-mariachi") {
    return (
          <group position={hatBase}>
            <mesh position={[0, 0.008, 0]}>
              <cylinderGeometry args={[0.22, 0.22, 0.014, 40]} />
              <meshStandardMaterial color="#c8965a" roughness={0.85} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.218, 0.012, 10, 44]} />
              <meshStandardMaterial color="#b5854a" roughness={0.85} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.024, 0]}>
              <cylinderGeometry args={[0.1, 0.135, 0.028, 32]} />
              <meshStandardMaterial color="#b5854a" roughness={0.85} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.104, 0.013, 10, 32]} />
              <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.13, 0]}>
              <coneGeometry args={[0.1, 0.18, 32]} />
              <meshStandardMaterial color="#c8965a" roughness={0.85} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.098, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.066, 0.008, 8, 28]} />
              <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.222, 0]}>
              <sphereGeometry args={[0.032, 20, 16]} />
              <meshStandardMaterial color="#b5854a" roughness={0.85} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "gorro-bufon") {
    return (
          <group position={hatBase}>
            <mesh position={[0, 0.03, 0]}>
              <sphereGeometry args={[0.11, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#7c3aed" roughness={0.7} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0.028, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.108, 0.016, 10, 24]} />
              <meshStandardMaterial color={gold} metalness={0.6} roughness={0.35} transparent opacity={opacity} />
            </mesh>
            <group position={[-0.085, 0.055, 0]} rotation={[0, 0, 1.05]}>
              <mesh position={[0, 0.065, 0]}>
                <coneGeometry args={[0.038, 0.13, 14]} />
                <meshStandardMaterial color="#ef4444" roughness={0.65} transparent opacity={opacity} side={DoubleSide} />
              </mesh>
              <mesh position={[0, 0.148, 0]}>
                <sphereGeometry args={[0.022, 12, 10]} />
                <meshStandardMaterial color={gold} metalness={0.8} roughness={0.2} transparent opacity={opacity} />
              </mesh>
            </group>
            <group position={[0.01, 0.1, 0]} rotation={[0, 0, -0.14]}>
              <mesh position={[0, 0.07, 0]}>
                <coneGeometry args={[0.038, 0.14, 14]} />
                <meshStandardMaterial color="#22c55e" roughness={0.65} transparent opacity={opacity} side={DoubleSide} />
              </mesh>
              <mesh position={[0, 0.158, 0]}>
                <sphereGeometry args={[0.022, 12, 10]} />
                <meshStandardMaterial color={gold} metalness={0.8} roughness={0.2} transparent opacity={opacity} />
              </mesh>
            </group>
            <group position={[0.085, 0.05, 0]} rotation={[0, 0, -1.1]}>
              <mesh position={[0, 0.0625, 0]}>
                <coneGeometry args={[0.038, 0.125, 14]} />
                <meshStandardMaterial color="#a855f7" roughness={0.65} transparent opacity={opacity} side={DoubleSide} />
              </mesh>
              <mesh position={[0, 0.143, 0]}>
                <sphereGeometry args={[0.022, 12, 10]} />
                <meshStandardMaterial color={gold} metalness={0.8} roughness={0.2} transparent opacity={opacity} />
              </mesh>
            </group>
          </group>
        );
  }
  if (kind === "casco-vikingo") {
    return (
          <group position={hatBase}>
            <mesh position={[0, 0.05, 0]}>
              <sphereGeometry args={[0.125, 22, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#9ca3af" metalness={0.55} roughness={0.35} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0.048, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.126, 0.016, 12, 30]} />
              <meshStandardMaterial color="#6b7280" metalness={0.7} roughness={0.3} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.052, 0.128]}>
              <boxGeometry args={[0.03, 0.11, 0.02]} />
              <meshStandardMaterial color="#6b7280" metalness={0.7} roughness={0.3} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.165, 0]}>
              <sphereGeometry args={[0.022, 14, 12]} />
              <meshStandardMaterial color="#6b7280" metalness={0.7} roughness={0.3} transparent opacity={opacity} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={`socket-${s}`} position={[s * 0.088, 0.058, 0]} rotation={[0, 0, s * -0.6]}>
                <cylinderGeometry args={[0.03, 0.032, 0.028, 14]} />
                <meshStandardMaterial color="#6b7280" metalness={0.7} roughness={0.3} transparent opacity={opacity} />
              </mesh>
            ))}
            {[-1, 1].map((s) => (
              <mesh key={`horn-${s}`} position={[s * 0.115, 0.115, 0]} rotation={[0, 0, s * -0.85]}>
                <coneGeometry args={[0.032, 0.17, 16]} />
                <meshStandardMaterial color="#f4ecd8" metalness={0.1} roughness={0.6} transparent opacity={opacity} />
              </mesh>
            ))}
            {[-1, 1].map((s) => (
              <mesh key={`tip-${s}`} position={[s * 0.175, 0.235, 0]} rotation={[0, 0, s * -0.28]}>
                <coneGeometry args={[0.018, 0.13, 16]} />
                <meshStandardMaterial color="#faf6ea" metalness={0.1} roughness={0.55} transparent opacity={opacity} />
              </mesh>
            ))}
          </group>
        );
  }
  if (kind === "corona-laurel") {
    return (
          <group position={hatBase}>
            {[-1, 1].map((side) => (
              <group key={side} scale={[side, 1, 1]}>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                  const ang = 0.34 + (i / 6) * (Math.PI * 0.6);
                  const r = 0.112;
                  const lx = Math.sin(ang) * r;
                  const ly = 0.026 + Math.cos(ang) * 0.052;
                  const lz = Math.cos(ang) * r * 0.35;
                  return (
                    <mesh
                      key={i}
                      position={[lx, ly, lz]}
                      rotation={[0.35, -ang * 0.9 - 0.3, ang * 0.5 + 0.4]}
                      scale={[0.05, 0.02, 0.03]}
                    >
                      <coneGeometry args={[1, 2, 6]} />
                      <meshStandardMaterial
                        color={i % 2 === 0 ? "#2f7d32" : "#3f9a45"}
                        roughness={0.9}
                        metalness={0}
                        transparent
                        opacity={opacity}
                      />
                    </mesh>
                  );
                })}
              </group>
            ))}
            {[-1, 1].map((side) => (
              <mesh
                key={`berry-${side}`}
                position={[side * 0.05, 0.052, 0.045]}
              >
                <sphereGeometry args={[0.011, 10, 10]} />
                <meshStandardMaterial
                  color={gold}
                  metalness={0.85}
                  roughness={0.25}
                  emissive={gold}
                  emissiveIntensity={0.25}
                  transparent
                  opacity={opacity}
                />
              </mesh>
            ))}
          </group>
        );
  }
  if (kind === "aureola") {
    return <CosmeticAureola a={a} opacity={opacity} />;
  }
  if (kind === "cuernos-diablo") {
    return (
          <group position={hatBase}>
            {[-1, 1].map((s) => (
              <group key={s} position={[s * 0.07, 0.04, -0.02]}>
                <mesh position={[0, 0, 0]} rotation={[-0.35, 0, s * 0.28]}>
                  <coneGeometry args={[0.028, 0.075, 16]} />
                  <meshStandardMaterial color="#dc2626" roughness={0.12} metalness={0.15} transparent opacity={opacity} />
                </mesh>
                <mesh position={[s * 0.006, 0.052, -0.016]} rotation={[-0.75, 0, s * 0.4]}>
                  <coneGeometry args={[0.016, 0.055, 16]} />
                  <meshStandardMaterial color="#ef4444" roughness={0.1} metalness={0.2} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, -0.026, 0.006]}>
                  <sphereGeometry args={[0.026, 16, 16]} />
                  <meshStandardMaterial color="#b91c1c" roughness={0.15} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
          </group>
        );
  }
  if (kind === "gorro-hongo") {
    return (
          <group position={hatBase}>
            <mesh position={[0, 0.05, 0]}>
              <cylinderGeometry args={[0.075, 0.09, 0.05, 24]} />
              <meshStandardMaterial color="#f5ecd8" roughness={0.7} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.085, 0]} scale={[1, 0.72, 1]}>
              <sphereGeometry args={[0.135, 26, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#e23c2e" roughness={0.45} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.087, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.132, 0.012, 10, 30]} />
              <meshStandardMaterial color="#c22b1f" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            {[
              [0.0, 0.182, 0.0],
              [0.085, 0.162, 0.031],
              [-0.1, 0.143, 0.057],
              [-0.028, 0.15, -0.104],
              [0.042, 0.132, 0.117],
              [0.06, 0.16, -0.072],
              [-0.108, 0.14, -0.02],
            ].map((p, i) => (
              <mesh key={i} position={[p[0], p[1], p[2]]} scale={[1, 0.55, 1]}>
                <sphereGeometry args={[0.022 - (i % 3) * 0.003, 14, 10]} />
                <meshStandardMaterial color="#fbf6ec" roughness={0.6} transparent opacity={opacity} />
              </mesh>
            ))}
          </group>
        );
  }
  if (kind === "helice-gorro") {
    return <CosmeticHeliceGorro a={a} opacity={opacity} />;
  }
  if (kind === "corona-flores") {
    return (
          <group position={hatBase}>
            <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.115, 0.014, 10, 28]} />
              <meshStandardMaterial color="#3f9d4f" roughness={0.6} transparent opacity={opacity} />
            </mesh>
            {[
              { ang: 0, petal: "#f472b6" },
              { ang: (Math.PI * 2) / 7, petal: "#f9fafb" },
              { ang: (Math.PI * 4) / 7, petal: "#c4b5fd" },
              { ang: (Math.PI * 6) / 7, petal: "#fb7185" },
              { ang: (Math.PI * 8) / 7, petal: "#e9d5ff" },
              { ang: (Math.PI * 10) / 7, petal: "#f472b6" },
              { ang: (Math.PI * 12) / 7, petal: "#fbcfe8" },
            ].map((f, i) => {
              const r = 0.115;
              const fx = Math.cos(f.ang) * r;
              const fz = Math.sin(f.ang) * r;
              const fy = 0.058;
              return (
                <group key={i} position={[fx, fy, fz]} rotation={[0, -f.ang, 0]}>
                  {[0, 1, 2, 3, 4].map((p) => {
                    const pa = (p / 5) * Math.PI * 2;
                    const pr = 0.026;
                    return (
                      <mesh
                        key={p}
                        position={[0, Math.sin(pa) * pr, Math.cos(pa) * pr]}
                        scale={[0.45, 1, 1]}
                      >
                        <sphereGeometry args={[0.02, 10, 10]} />
                        <meshStandardMaterial color={f.petal} roughness={0.5} transparent opacity={opacity} />
                      </mesh>
                    );
                  })}
                  <mesh scale={[0.6, 1, 1]}>
                    <sphereGeometry args={[0.016, 10, 10]} />
                    <meshStandardMaterial color={gold} emissive="#eab308" emissiveIntensity={0.25} roughness={0.4} transparent opacity={opacity} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
  }
  if (kind === "casco-obra") {
    return (
          <group position={hatBase}>
            <mesh position={[0, 0.035, 0]}>
              <sphereGeometry args={[0.12, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#facc15" metalness={0.15} roughness={0.45} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0.035, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.026, 0.026, 0.2, 14, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color="#f59e0b" metalness={0.15} roughness={0.4} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0.03, 0.108]} rotation={[-0.32, 0, 0]}>
              <boxGeometry args={[0.16, 0.014, 0.07]} />
              <meshStandardMaterial color="#facc15" metalness={0.15} roughness={0.45} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.008, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.116, 0.011, 10, 30]} />
              <meshStandardMaterial color="#f59e0b" metalness={0.2} roughness={0.4} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "sombrero-bruja") {
    return (
          <group position={hatBase}>
            <mesh position={[0, 0.008, 0]}>
              <cylinderGeometry args={[0.185, 0.185, 0.004, 28]} />
              <meshStandardMaterial color="#4c1d95" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.013, 0]}>
              <cylinderGeometry args={[0.16, 0.16, 0.012, 28]} />
              <meshStandardMaterial color="#2e1065" roughness={0.6} metalness={0.1} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.012, 0.06, 0]} rotation={[0, 0, -0.14]}>
              <coneGeometry args={[0.085, 0.11, 24]} />
              <meshStandardMaterial color="#3b0764" roughness={0.6} metalness={0.1} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.032, 0.145, 0]} rotation={[0, 0, -0.34]}>
              <coneGeometry args={[0.05, 0.1, 24]} />
              <meshStandardMaterial color="#3b0764" roughness={0.6} metalness={0.1} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.058, 0.215, 0]} rotation={[0, 0, -0.6]}>
              <coneGeometry args={[0.024, 0.09, 24]} />
              <meshStandardMaterial color="#2e1065" roughness={0.6} metalness={0.1} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.02, 0.048, 0]} rotation={[0, 0, -0.14]}>
              <cylinderGeometry args={[0.09, 0.096, 0.03, 24]} />
              <meshStandardMaterial color="#1e1b4b" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.028, 0.048, 0.088]}>
              <boxGeometry args={[0.032, 0.032, 0.01]} />
              <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.028, 0.048, 0.09]}>
              <boxGeometry args={[0.015, 0.015, 0.01]} />
              <meshStandardMaterial color="#1e1b4b" roughness={0.5} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "cresta-punk") {
    {
        const spikes = [0.05, 0.09, 0.13, 0.16, 0.13, 0.09, 0.05];
        const pinks = ["#ec4899", "#f0399f", "#f5259a", "#ff1493", "#f5259a", "#f0399f", "#ec4899"];
        return (
          <group position={hatBase}>
            <mesh position={[0, 0.02, a.head[2]]} rotation={[Math.PI / 2, 0, 0]}>
              <boxGeometry args={[0.022, 0.13, 0.02]} />
              <meshStandardMaterial color="#be185d" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            {spikes.map((h, i) => {
              const z = a.head[2] + 0.055 - i * 0.018;
              return (
                <mesh key={i} position={[0, 0.02 + h / 2, z]}>
                  <coneGeometry args={[0.026, h, 4]} />
                  <meshStandardMaterial color={pinks[i]} roughness={0.35} emissive={pinks[i]} emissiveIntensity={0.35} transparent opacity={opacity} />
                </mesh>
              );
            })}
          </group>
        );
      }
  }
  if (kind === "fez") {
    return (
          <group position={hatBase}>
            <mesh position={[0, 0.055, 0]}>
              <cylinderGeometry args={[0.075, 0.088, 0.11, 24]} />
              <meshStandardMaterial color="#d92b2b" roughness={0.45} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.112, 0]}>
              <cylinderGeometry args={[0.075, 0.075, 0.006, 24]} />
              <meshStandardMaterial color="#a81f1f" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.118, 0]}>
              <cylinderGeometry args={[0.014, 0.014, 0.01, 12]} />
              <meshStandardMaterial color={gold} metalness={0.8} roughness={0.25} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.02, 0.13, 0]} rotation={[0, 0, -0.35]}>
              <cylinderGeometry args={[0.004, 0.004, 0.04, 8]} />
              <meshStandardMaterial color={black} roughness={0.6} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.05, 0.075, 0]}>
              <cylinderGeometry args={[0.005, 0.005, 0.07, 8]} />
              <meshStandardMaterial color={black} roughness={0.6} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.05, 0.033, 0]}>
              <sphereGeometry args={[0.017, 12, 12]} />
              <meshStandardMaterial color={black} roughness={0.7} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "aleta-tiburon") {
    return (
          <group position={[0, a.head[1] + 0.02, 0]}>
            <mesh position={[0, 0.085, -0.012]} rotation={[0.28, 0, 0]} scale={[1, 1, 0.14]}>
              <coneGeometry args={[0.085, 0.19, 3]} />
              <meshStandardMaterial color="#5b6b7a" roughness={0.9} metalness={0.04} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0.088, 0.006]} rotation={[0.28, 0, 0]} scale={[0.7, 0.86, 0.1]}>
              <coneGeometry args={[0.085, 0.19, 3]} />
              <meshStandardMaterial color="#7d8fa0" roughness={0.95} metalness={0.02} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
          </group>
        );
  }
  if (kind === "pulpo-sombrero") {
    return (
          <group position={[0, a.head[1] + 0.06, 0]}>
            <mesh position={[0, 0.055, 0]} scale={[1, 0.88, 1]}>
              <sphereGeometry args={[0.12, 24, 20]} />
              <meshStandardMaterial color="#a855f7" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            {[-1, 1].map((s) => (
              <group key={s}>
                <mesh position={[s * 0.045, 0.085, 0.105]}>
                  <sphereGeometry args={[0.036, 16, 16]} />
                  <meshStandardMaterial color="#ffffff" roughness={0.3} transparent opacity={opacity} />
                </mesh>
                <mesh position={[s * 0.05, 0.082, 0.135]}>
                  <sphereGeometry args={[0.017, 14, 14]} />
                  <meshStandardMaterial color={black} roughness={0.2} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const ang = (i / 6) * Math.PI * 2;
              const r = 0.095;
              const tx = Math.cos(ang) * r;
              const tz = Math.sin(ang) * r;
              return (
                <group key={i} position={[tx, -0.02, tz]} rotation={[0, -ang + Math.PI / 2, 0]}>
                  <mesh position={[0, -0.06, 0.02]} rotation={[0.55, 0, 0]}>
                    <coneGeometry args={[0.03, 0.16, 12]} />
                    <meshStandardMaterial color="#9333ea" roughness={0.5} transparent opacity={opacity} />
                  </mesh>
                  <mesh position={[0, -0.13, 0.075]} rotation={[1.1, 0, 0]}>
                    <coneGeometry args={[0.016, 0.07, 10]} />
                    <meshStandardMaterial color="#7e22ce" roughness={0.5} transparent opacity={opacity} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
  }
  if (kind === "banana-cabeza") {
    return (
          <group position={[0, a.head[1] + 0.14, 0]}>
            <mesh position={[-0.1, 0.02, 0]} rotation={[0, 0, 0.7]}>
              <cylinderGeometry args={[0.02, 0.032, 0.09, 12]} />
              <meshStandardMaterial color="#facc15" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[-0.055, 0.05, 0]} rotation={[0, 0, 0.35]}>
              <cylinderGeometry args={[0.032, 0.032, 0.075, 12]} />
              <meshStandardMaterial color="#fde047" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.06, 0]} rotation={[0, 0, 0]}>
              <cylinderGeometry args={[0.034, 0.034, 0.075, 12]} />
              <meshStandardMaterial color="#fde047" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.055, 0.05, 0]} rotation={[0, 0, -0.35]}>
              <cylinderGeometry args={[0.032, 0.032, 0.075, 12]} />
              <meshStandardMaterial color="#fde047" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.1, 0.02, 0]} rotation={[0, 0, -0.7]}>
              <cylinderGeometry args={[0.032, 0.02, 0.09, 12]} />
              <meshStandardMaterial color="#facc15" roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[-0.128, -0.002, 0]} rotation={[0, 0, 0.95]}>
              <cylinderGeometry args={[0.008, 0.018, 0.04, 10]} />
              <meshStandardMaterial color="#4d7c0f" roughness={0.6} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.128, -0.002, 0]} rotation={[0, 0, -0.95]}>
              <cylinderGeometry args={[0.018, 0.008, 0.04, 10]} />
              <meshStandardMaterial color="#78350f" roughness={0.6} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "lentes-corazon") {
    return (
          <group>
            {[a.leftEye, a.rightEye].map((p, i) => (
              <group key={i} position={[p[0], p[1], p[2] + 0.03]}>
                <mesh position={[-0.015, 0.011, 0]}>
                  <sphereGeometry args={[0.018, 16, 16]} />
                  <meshStandardMaterial color="#f43f5e" emissive="#ef4444" emissiveIntensity={0.35} roughness={0.25} metalness={0.1} transparent opacity={opacity * 0.7} />
                </mesh>
                <mesh position={[0.015, 0.011, 0]}>
                  <sphereGeometry args={[0.018, 16, 16]} />
                  <meshStandardMaterial color="#f43f5e" emissive="#ef4444" emissiveIntensity={0.35} roughness={0.25} metalness={0.1} transparent opacity={opacity * 0.7} />
                </mesh>
                <mesh position={[0, -0.014, 0]} rotation={[0, 0, Math.PI]}>
                  <coneGeometry args={[0.032, 0.04, 4]} />
                  <meshStandardMaterial color="#f43f5e" emissive="#ef4444" emissiveIntensity={0.35} roughness={0.25} metalness={0.1} transparent opacity={opacity * 0.7} />
                </mesh>
                <mesh position={[-0.015, 0.012, 0.006]}>
                  <torusGeometry args={[0.017, 0.0035, 8, 20]} />
                  <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0.015, 0.012, 0.006]}>
                  <torusGeometry args={[0.017, 0.0035, 8, 20]} />
                  <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
                </mesh>
                <mesh position={[-0.011, -0.015, 0.006]} rotation={[0, 0, 0.7]}>
                  <cylinderGeometry args={[0.0035, 0.0035, 0.034, 8]} />
                  <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0.011, -0.015, 0.006]} rotation={[0, 0, -0.7]}>
                  <cylinderGeometry args={[0.0035, 0.0035, 0.034, 8]} />
                  <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
            <mesh position={[(a.leftEye[0] + a.rightEye[0]) / 2, (a.leftEye[1] + a.rightEye[1]) / 2 + 0.006, (a.leftEye[2] + a.rightEye[2]) / 2 + 0.03]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.004, 0.004, 0.03, 10]} />
              <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
            </mesh>
            {[a.leftEye, a.rightEye].map((p, i) => (
              <mesh
                key={`arm-${i}`}
                position={[p[0] + (i === 0 ? -0.05 : 0.05), p[1] + 0.008, p[2] - 0.01]}
                rotation={[-0.32, 0, 0]}
              >
                <boxGeometry args={[0.006, 0.006, 0.06]} />
                <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
              </mesh>
            ))}
          </group>
        );
  }
  if (kind === "lentes-estrella") {
    return (
          <group>
            {[a.leftEye, a.rightEye].map((p, i) => (
              <group key={i} position={[p[0], p[1], p[2] + 0.03]}>
                <mesh>
                  <circleGeometry args={[0.03, 24]} />
                  <meshBasicMaterial color="#7c3aed" transparent opacity={opacity * 0.55} side={DoubleSide} toneMapped={false} />
                </mesh>
                {[0, 1, 2, 3, 4].map((k) => {
                  const ang = (k * Math.PI * 2) / 5;
                  const r = 0.036;
                  return (
                    <mesh
                      key={k}
                      position={[Math.sin(ang) * r, Math.cos(ang) * r, 0.004]}
                      rotation={[0, 0, -ang]}
                    >
                      <coneGeometry args={[0.016, 0.03, 4]} />
                      <meshStandardMaterial color={gold} metalness={0.9} roughness={0.15} emissive="#b8860b" emissiveIntensity={0.35} transparent opacity={opacity} />
                    </mesh>
                  );
                })}
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.03, 0.006, 8, 24]} />
                  <meshStandardMaterial color={gold} metalness={0.9} roughness={0.15} emissive="#b8860b" emissiveIntensity={0.35} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
            <mesh position={[(a.leftEye[0] + a.rightEye[0]) / 2, (a.leftEye[1] + a.rightEye[1]) / 2, a.leftEye[2] + 0.03]}>
              <boxGeometry args={[0.028, 0.007, 0.007]} />
              <meshStandardMaterial color={gold} metalness={0.9} roughness={0.15} emissive="#b8860b" emissiveIntensity={0.35} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "monoculo") {
    return (
          <group>
            <mesh position={[a.rightEye[0], a.rightEye[1], a.rightEye[2] + 0.032]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.034, 0.006, 10, 26]} />
              <meshStandardMaterial color={gold} metalness={0.9} roughness={0.18} transparent opacity={opacity} />
            </mesh>
            <mesh position={[a.rightEye[0], a.rightEye[1], a.rightEye[2] + 0.03]}>
              <circleGeometry args={[0.03, 24]} />
              <meshBasicMaterial color="#bae6fd" transparent opacity={opacity * 0.3} side={DoubleSide} toneMapped={false} />
            </mesh>
            <mesh position={[a.rightEye[0] - 0.014, a.rightEye[1] + 0.011, a.rightEye[2] + 0.031]} rotation={[0, 0, 0.7]}>
              <planeGeometry args={[0.02, 0.006]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={opacity * 0.5} side={DoubleSide} toneMapped={false} />
            </mesh>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const t = i / 5;
              const sx = a.rightEye[0] + 0.03;
              const sy = a.rightEye[1] - 0.03;
              const ex = a.chest[0] + 0.05;
              const ey = a.chest[1] + 0.02;
              const px = sx + (ex - sx) * t;
              const py = sy + (ey - sy) * t - Math.sin(t * Math.PI) * 0.03;
              const pz = a.rightEye[2] + 0.03;
              return (
                <mesh key={i} position={[px, py, pz]}>
                  <sphereGeometry args={[0.007, 8, 8]} />
                  <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
                </mesh>
              );
            })}
          </group>
        );
  }
  if (kind === "lentes-3d") {
    return (
          <group>
            <mesh position={[a.leftEye[0], a.leftEye[1], a.leftEye[2] + 0.03]}>
              <boxGeometry args={[0.05, 0.036, 0.004]} />
              <meshStandardMaterial color="#ef4444" transparent opacity={opacity * 0.55} side={DoubleSide} roughness={0.25} />
            </mesh>
            <mesh position={[a.rightEye[0], a.rightEye[1], a.rightEye[2] + 0.03]}>
              <boxGeometry args={[0.05, 0.036, 0.004]} />
              <meshStandardMaterial color="#22d3ee" transparent opacity={opacity * 0.55} side={DoubleSide} roughness={0.25} />
            </mesh>
            {[a.leftEye, a.rightEye].map((p, i) => (
              <group key={i} position={[p[0], p[1], p[2] + 0.032]}>
                <mesh position={[0, 0.022, 0]}>
                  <boxGeometry args={[0.062, 0.008, 0.012]} />
                  <meshStandardMaterial color={black} roughness={0.6} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, -0.022, 0]}>
                  <boxGeometry args={[0.062, 0.008, 0.012]} />
                  <meshStandardMaterial color={black} roughness={0.6} transparent opacity={opacity} />
                </mesh>
                <mesh position={[-0.029, 0, 0]}>
                  <boxGeometry args={[0.008, 0.05, 0.012]} />
                  <meshStandardMaterial color={black} roughness={0.6} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0.029, 0, 0]}>
                  <boxGeometry args={[0.008, 0.05, 0.012]} />
                  <meshStandardMaterial color={black} roughness={0.6} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
            <mesh position={[(a.leftEye[0] + a.rightEye[0]) / 2, (a.leftEye[1] + a.rightEye[1]) / 2, a.leftEye[2] + 0.032]}>
              <boxGeometry args={[0.03, 0.01, 0.012]} />
              <meshStandardMaterial color={black} roughness={0.6} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "antifaz") {
    {
        const cx = (a.leftEye[0] + a.rightEye[0]) / 2;
        const cy = (a.leftEye[1] + a.rightEye[1]) / 2;
        const cz = Math.max(a.leftEye[2], a.rightEye[2]) + 0.03;
        const eyes: Vec3[] = [a.leftEye, a.rightEye];
        return (
          <group position={[cx, cy, cz]}>
            <mesh position={[0, 0.006, 0]}>
              <boxGeometry args={[0.185, 0.07, 0.014]} />
              <meshStandardMaterial color={black} roughness={0.8} metalness={0.05} transparent opacity={opacity} />
            </mesh>
            {eyes.map((p, i) => {
              const side = i === 0 ? -1 : 1;
              return (
                <mesh key={`peak-${i}`} position={[side * 0.082, 0.036, 0.002]} rotation={[0, 0, side * -0.6]}>
                  <coneGeometry args={[0.026, 0.05, 4]} />
                  <meshStandardMaterial color={black} roughness={0.8} transparent opacity={opacity} />
                </mesh>
              );
            })}
            {eyes.map((p, i) => (
              <mesh key={`hole-${i}`} position={[p[0] - cx, p[1] - cy, 0.006]}>
                <circleGeometry args={[0.021, 24]} />
                <meshBasicMaterial color="#000000" transparent opacity={opacity * 0.9} side={DoubleSide} toneMapped={false} />
              </mesh>
            ))}
            {eyes.map((p, i) => (
              <mesh key={`ring-${i}`} position={[p[0] - cx, p[1] - cy, 0.01]}>
                <torusGeometry args={[0.023, 0.006, 10, 24]} />
                <meshStandardMaterial color={gold} metalness={0.9} roughness={0.25} emissive={gold} emissiveIntensity={0.2} transparent opacity={opacity} toneMapped={false} />
              </mesh>
            ))}
            {eyes.map((p, i) => {
              const side = i === 0 ? -1 : 1;
              return (
                <mesh key={`strap-${i}`} position={[side * 0.11, 0.006, -0.022]} rotation={[0, side * 0.5, 0]}>
                  <boxGeometry args={[0.07, 0.018, 0.008]} />
                  <meshStandardMaterial color={black} roughness={0.85} transparent opacity={opacity * 0.9} />
                </mesh>
              );
            })}
          </group>
        );
      }
  }
  if (kind === "parche-pirata") {
    return (
          <group>
            <group position={[a.leftEye[0], a.leftEye[1], a.leftEye[2] + 0.03]}>
              <mesh scale={[1, 1.12, 0.4]}>
                <sphereGeometry args={[0.05, 20, 16]} />
                <meshStandardMaterial color={black} roughness={0.9} metalness={0.05} transparent opacity={opacity} />
              </mesh>
              <mesh position={[0, 0, 0.02]} scale={[1, 1.12, 0.35]}>
                <sphereGeometry args={[0.052, 20, 16]} />
                <meshStandardMaterial color="#0b0f19" roughness={0.95} transparent opacity={opacity} />
              </mesh>
              <mesh position={[-0.014, 0.016, 0.024]}>
                <sphereGeometry args={[0.009, 10, 8]} />
                <meshBasicMaterial color="#4b5563" transparent opacity={opacity * 0.6} toneMapped={false} />
              </mesh>
            </group>
            <mesh
              position={[a.leftEye[0] + 0.02, a.leftEye[1] + 0.05, a.leftEye[2] - 0.02]}
              rotation={[0, 0, -Math.PI / 3.2]}
            >
              <boxGeometry args={[0.024, 0.24, 0.02]} />
              <meshStandardMaterial color={black} roughness={0.9} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "lentes-pixel") {
    {
        const px = 0.011;
        const cy = (a.leftEye[1] + a.rightEye[1]) / 2;
        const cx = (a.leftEye[0] + a.rightEye[0]) / 2;
        const cz = Math.max(a.leftEye[2], a.rightEye[2]) + 0.032;
        const lensCX = (a.leftEye[0] - cx) / px;
        const rows = [1.5, 0.5, -0.5, -1.5];
        return (
          <group position={[cx, cy, cz]}>
            {[a.leftEye, a.rightEye].map((p, side) => {
              const dir = side === 0 ? -1 : 1;
              const lensX = dir * Math.abs(lensCX);
              const cols = [-1.5, -0.5, 0.5, 1.5];
              return (
                <group key={side} position={[lensX * px, 0, 0]}>
                  {rows.map((ry, ri) =>
                    cols.map((cxi, ci) => (
                      <mesh key={`${ri}-${ci}`} position={[cxi * px, ry * px, 0]}>
                        <boxGeometry args={[px, px, px]} />
                        <meshStandardMaterial
                          color={black}
                          roughness={0.3}
                          metalness={0.2}
                          transparent
                          opacity={opacity}
                        />
                      </mesh>
                    )),
                  )}
                  <mesh position={[dir * 2.5 * px, 1.5 * px, 0]}>
                    <boxGeometry args={[px, px, px]} />
                    <meshStandardMaterial
                      color={black}
                      roughness={0.3}
                      metalness={0.2}
                      transparent
                      opacity={opacity}
                    />
                  </mesh>
                  <mesh position={[dir * 2.5 * px, 0.5 * px, 0]}>
                    <boxGeometry args={[px, px, px]} />
                    <meshStandardMaterial
                      color={black}
                      roughness={0.3}
                      metalness={0.2}
                      transparent
                      opacity={opacity}
                    />
                  </mesh>
                  {[0.65, -0.35].map((sy, gi) => (
                    <mesh
                      key={`glint-${gi}`}
                      position={[(-1.1 + gi * 0.9) * px, sy * px, px * 0.55]}
                    >
                      <boxGeometry args={[px * 0.85, px * 0.85, px * 0.25]} />
                      <meshBasicMaterial
                        color="#5b6270"
                        transparent
                        opacity={opacity * 0.9}
                        toneMapped={false}
                      />
                    </mesh>
                  ))}
                  <mesh position={[dir * 3.5 * px, 0.5 * px, -px * 0.4]}>
                    <boxGeometry args={[px * 2, px * 0.9, px * 0.9]} />
                    <meshStandardMaterial
                      color={black}
                      roughness={0.35}
                      metalness={0.2}
                      transparent
                      opacity={opacity}
                    />
                  </mesh>
                </group>
              );
            })}
            {[0.5, -0.5].map((by, bi) => (
              <mesh key={`bridge-${bi}`} position={[0, by * px, 0]}>
                <boxGeometry args={[Math.abs(2 * lensCX - 2) * px, px, px]} />
                <meshStandardMaterial
                  color={black}
                  roughness={0.3}
                  metalness={0.2}
                  transparent
                  opacity={opacity}
                />
              </mesh>
            ))}
          </group>
        );
      }
  }
  if (kind === "nariz-payaso") {
    return (
          <group position={[a.mouth[0], a.mouth[1] + 0.05, a.mouth[2] + 0.03]}>
            <mesh>
              <sphereGeometry args={[0.032, 20, 20]} />
              <meshStandardMaterial color="#ff1f1f" roughness={0.08} metalness={0.1} emissive="#7f0000" emissiveIntensity={0.25} transparent opacity={opacity} />
            </mesh>
            <mesh position={[-0.01, 0.009, 0.024]}>
              <sphereGeometry args={[0.008, 12, 12]} />
              <meshBasicMaterial color="#ffe0e0" transparent opacity={opacity * 0.9} toneMapped={false} />
            </mesh>
          </group>
        );
  }
  if (kind === "ojos-saltones") {
    return <CosmeticOjosSaltones a={a} opacity={opacity} />;
  }
  if (kind === "chupete") {
    return (
          <group position={[a.mouth[0], a.mouth[1], a.mouth[2] + 0.03]}>
            <mesh position={[0, 0, 0.01]}>
              <sphereGeometry args={[0.022, 16, 12]} />
              <meshStandardMaterial color="#fca5a5" roughness={0.35} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.085, 0.085, 0.014, 24]} />
              <meshStandardMaterial color="#38bdf8" roughness={0.3} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0, 0.062]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.05, 0.014, 12, 28]} />
              <meshStandardMaterial color="#f472b6" roughness={0.3} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "puro") {
    return (
          <group position={[a.mouth[0] + 0.03, a.mouth[1] - 0.005, a.mouth[2] + 0.03]}>
            <mesh position={[0.0234, 0.0553, 0]} rotation={[0, 0, -0.4]}>
              <cylinderGeometry args={[0.015, 0.015, 0.12, 14]} />
              <meshStandardMaterial color="#7b4a1e" roughness={0.75} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.0272, 0.0645, 0]} rotation={[0, 0, -0.4]}>
              <cylinderGeometry args={[0.0155, 0.0155, 0.02, 14]} />
              <meshStandardMaterial color="#d1d5db" roughness={0.95} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.0347, 0.082, 0]}>
              <sphereGeometry args={[0.01, 12, 12]} />
              <meshStandardMaterial color="#ff5a1f" emissive="#ff3d00" emissiveIntensity={1.4} roughness={0.5} transparent opacity={opacity} toneMapped={false} />
            </mesh>
          </group>
        );
  }
  if (kind === "pipa") {
    {
        const woodDark = "#5a3617";
        const woodLight = "#8b5a2b";
        const ember = "#ff6b1a";
        const mx = a.mouth[0];
        const my = a.mouth[1];
        const mz = a.mouth[2] + 0.03;
        return (
          <group position={[mx, my, mz]}>
            <mesh position={[0.0, -0.007, 0.006]} rotation={[0, 0, -Math.PI / 2.6]}>
              <sphereGeometry args={[0.014, 12, 12]} />
              <meshStandardMaterial color={black} roughness={0.4} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.024, -0.02, 0.012]} rotation={[0, 0, -Math.PI / 2.6]}>
              <cylinderGeometry args={[0.01, 0.012, 0.055, 12]} />
              <meshStandardMaterial color={woodDark} roughness={0.6} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.058, -0.05, 0.022]} rotation={[Math.PI / 6, 0, -Math.PI / 3.2]}>
              <cylinderGeometry args={[0.0085, 0.011, 0.06, 12]} />
              <meshStandardMaterial color={woodDark} roughness={0.6} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.078, -0.088, 0.035]}>
              <cylinderGeometry args={[0.026, 0.021, 0.052, 18]} />
              <meshStandardMaterial color={woodLight} roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.078, -0.062, 0.035]}>
              <torusGeometry args={[0.026, 0.004, 8, 20]} />
              <meshStandardMaterial color={woodDark} roughness={0.5} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.078, -0.062, 0.035]}>
              <cylinderGeometry args={[0.021, 0.021, 0.003, 18]} />
              <meshBasicMaterial color={ember} transparent opacity={opacity * 0.9} toneMapped={false} />
            </mesh>
            <mesh position={[0.078, -0.056, 0.035]}>
              <sphereGeometry args={[0.009, 8, 8]} />
              <meshBasicMaterial color="#ffd27f" transparent opacity={opacity * 0.6} toneMapped={false} />
            </mesh>
          </group>
        );
      }
  }
  if (kind === "diente-oro") {
    return (
          <group position={[a.mouth[0], a.mouth[1] - 0.02, a.mouth[2] + 0.035]}>
            <mesh>
              <boxGeometry args={[0.026, 0.032, 0.014]} />
              <meshStandardMaterial color={gold} metalness={0.95} roughness={0.12} emissive={gold} emissiveIntensity={0.25} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.017, 0.004]}>
              <boxGeometry args={[0.022, 0.008, 0.008]} />
              <meshStandardMaterial color="#fff7cc" metalness={0.9} roughness={0.05} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            <mesh position={[0.026, -0.002, -0.001]}>
              <boxGeometry args={[0.017, 0.024, 0.012]} />
              <meshStandardMaterial color={gold} metalness={0.95} roughness={0.14} emissive={gold} emissiveIntensity={0.2} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            <mesh position={[0.003, 0.005, 0.009]}>
              <sphereGeometry args={[0.004, 12, 12]} />
              <meshStandardMaterial color="#ffffff" metalness={0.2} roughness={0.05} emissive="#ffffff" emissiveIntensity={0.5} transparent opacity={opacity} toneMapped={false} />
            </mesh>
          </group>
        );
  }
  if (kind === "barba-vikinga") {
    return (
          <group position={[a.mouth[0], a.mouth[1] - 0.05, a.mouth[2] + 0.02]}>
            <mesh position={[0, 0, 0]} scale={[1, 0.7, 0.7]}>
              <sphereGeometry args={[0.11, 20, 16]} />
              <meshStandardMaterial color="#8a5a2b" roughness={0.85} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, -0.02, 0.02]} scale={[0.85, 0.6, 0.6]}>
              <sphereGeometry args={[0.09, 16, 14]} />
              <meshStandardMaterial color="#a06a35" roughness={0.8} transparent opacity={opacity} />
            </mesh>
            {[-0.05, 0.05].map((bx, bi) => (
              <group key={bi} position={[bx, -0.07, 0.02]}>
                {[0, 1, 2].map((si) => (
                  <mesh key={si} position={[0, -si * 0.045, 0]} scale={[1, 0.9, 0.9]}>
                    <sphereGeometry args={[0.03, 14, 12]} />
                    <meshStandardMaterial color="#8a5a2b" roughness={0.85} transparent opacity={opacity} />
                  </mesh>
                ))}
                <mesh position={[0, -0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.028, 0.006, 8, 18]} />
                  <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, -0.135, 0]} rotation={[Math.PI, 0, 0]}>
                  <coneGeometry args={[0.022, 0.05, 12]} />
                  <meshStandardMaterial color="#8a5a2b" roughness={0.85} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
          </group>
        );
  }
  if (kind === "globo-chicle") {
    return <CosmeticGloboChicle a={a} opacity={opacity} />;
  }
  if (kind === "banda-novio") {
    return (
          <group position={[a.chest[0], a.chest[1] + 0.02, a.chest[2] + 0.05]}>
            <group rotation={[0, 0, 0.6]}>
              <mesh>
                <boxGeometry args={[0.34, 0.075, 0.02]} />
                <meshStandardMaterial color="#2563eb" roughness={0.35} metalness={0.15} transparent opacity={opacity} />
              </mesh>
              <mesh position={[0, 0.031, 0.011]}>
                <boxGeometry args={[0.34, 0.012, 0.006]} />
                <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} transparent opacity={opacity} />
              </mesh>
              <mesh position={[0, -0.031, 0.011]}>
                <boxGeometry args={[0.34, 0.012, 0.006]} />
                <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} transparent opacity={opacity} />
              </mesh>
              <group position={[0.12, 0.0, 0.02]} scale={[1, 1, 0.4]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <octahedronGeometry args={[0.042, 0]} />
                  <meshStandardMaterial color={gold} emissive="#f59e0b" emissiveIntensity={0.5} metalness={0.9} roughness={0.15} transparent opacity={opacity} toneMapped={false} />
                </mesh>
                <mesh rotation={[Math.PI / 2, 0, Math.PI / 4]}>
                  <octahedronGeometry args={[0.042, 0]} />
                  <meshStandardMaterial color={gold} emissive="#f59e0b" emissiveIntensity={0.5} metalness={0.9} roughness={0.15} transparent opacity={opacity} toneMapped={false} />
                </mesh>
              </group>
            </group>
          </group>
        );
  }
  if (kind === "medalla-oro") {
    return (
          <group position={[a.chest[0], a.chest[1], a.chest[2] + 0.03]}>
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.045, 0.085, 0]}
                rotation={[0, 0, s * 0.42]}
              >
                <boxGeometry args={[0.02, 0.17, 0.008]} />
                <meshStandardMaterial
                  color={s < 0 ? "#dc2626" : "#2563eb"}
                  roughness={0.6}
                  transparent
                  opacity={opacity}
                />
              </mesh>
            ))}
            <mesh position={[0, 0.02, 0.004]}>
              <cylinderGeometry args={[0.008, 0.008, 0.01, 12]} />
              <meshStandardMaterial
                color={gold}
                metalness={0.95}
                roughness={0.2}
                transparent
                opacity={opacity}
              />
            </mesh>
            <mesh position={[0, -0.03, 0.006]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.06, 0.06, 0.014, 32]} />
              <meshStandardMaterial
                color={gold}
                metalness={0.95}
                roughness={0.15}
                transparent
                opacity={opacity}
              />
            </mesh>
            <mesh position={[0, -0.03, 0.006]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.06, 0.008, 12, 32]} />
              <meshStandardMaterial
                color="#fde68a"
                metalness={0.9}
                roughness={0.2}
                transparent
                opacity={opacity}
              />
            </mesh>
            {[0, 1, 2, 3, 4].map((i) => {
              const ang = (i / 5) * Math.PI * 2 + Math.PI / 2;
              return (
                <mesh
                  key={i}
                  position={[
                    Math.cos(ang) * 0.02,
                    -0.03 + Math.sin(ang) * 0.02,
                    0.015,
                  ]}
                  rotation={[0, 0, ang - Math.PI / 2]}
                >
                  <coneGeometry args={[0.011, 0.028, 4]} />
                  <meshStandardMaterial
                    color="#fffbe6"
                    metalness={0.85}
                    roughness={0.25}
                    transparent
                    opacity={opacity}
                  />
                </mesh>
              );
            })}
            <mesh position={[0, -0.03, 0.015]}>
              <cylinderGeometry args={[0.014, 0.014, 0.006, 5]} />
              <meshStandardMaterial
                color="#fffbe6"
                metalness={0.85}
                roughness={0.25}
                transparent
                opacity={opacity}
              />
            </mesh>
          </group>
        );
  }
  if (kind === "armadura-caballero") {
    return (
          <group position={[a.chest[0], a.chest[1] + 0.02, a.chest[2] + 0.02]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[1.15, 0.7, 1.3]}>
              <sphereGeometry args={[0.14, 24, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#9aa3ad" metalness={0.75} roughness={0.35} side={DoubleSide} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, -0.06, 0.02]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.02, 0.6, 1.05]}>
              <sphereGeometry args={[0.12, 24, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#b3bcc6" metalness={0.7} roughness={0.4} side={DoubleSide} transparent opacity={opacity} />
            </mesh>
            {[
              [-0.11, 0.05, 0.06],
              [0.11, 0.05, 0.06],
              [-0.1, -0.08, 0.06],
              [0.1, -0.08, 0.06],
            ].map((p, i) => (
              <mesh key={i} position={[p[0], p[1], p[2]]}>
                <sphereGeometry args={[0.012, 10, 10]} />
                <meshStandardMaterial color="#e5e9ee" metalness={0.9} roughness={0.2} transparent opacity={opacity} />
              </mesh>
            ))}
            <mesh position={[0, -0.01, 0.085]}>
              <boxGeometry args={[0.07, 0.09, 0.012]} />
              <meshStandardMaterial color="#c62828" metalness={0.4} roughness={0.45} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, -0.05, 0.09]}>
              <coneGeometry args={[0.036, 0.045, 4]} />
              <meshStandardMaterial color="#c62828" metalness={0.4} roughness={0.45} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.02, 0.093]}>
              <boxGeometry args={[0.008, 0.05, 0.01]} />
              <meshStandardMaterial color={gold} metalness={0.85} roughness={0.25} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.03, 0.093]}>
              <boxGeometry args={[0.032, 0.008, 0.01]} />
              <meshStandardMaterial color={gold} metalness={0.85} roughness={0.25} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "chaleco-salvavidas") {
    return (
          <group position={[a.chest[0], a.chest[1], a.chest[2] + 0.055]}>
            {[-1, 1].map((s) => (
              <group key={s} position={[s * 0.075, 0.01, 0]}>
                <mesh>
                  <boxGeometry args={[0.1, 0.19, 0.055]} />
                  <meshStandardMaterial color="#ff6a00" roughness={0.9} metalness={0} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, 0.095, 0]}>
                  <cylinderGeometry args={[0.05, 0.05, 0.055, 12]} />
                  <meshStandardMaterial color="#ff6a00" roughness={0.9} metalness={0} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, -0.095, 0]}>
                  <cylinderGeometry args={[0.05, 0.05, 0.055, 12]} />
                  <meshStandardMaterial color="#ff6a00" roughness={0.9} metalness={0} transparent opacity={opacity} />
                </mesh>
                {[0.05, -0.03].map((sy) => (
                  <mesh key={sy} position={[0, sy, 0.029]}>
                    <boxGeometry args={[0.098, 0.026, 0.004]} />
                    <meshStandardMaterial color="#cbd5e1" roughness={0.35} metalness={0.5} transparent opacity={opacity} />
                  </mesh>
                ))}
              </group>
            ))}
            {[0.06, -0.005, -0.07].map((sy) => (
              <mesh key={sy} position={[0, sy, 0.012]}>
                <boxGeometry args={[0.075, 0.018, 0.02]} />
                <meshStandardMaterial color={black} roughness={0.6} transparent opacity={opacity} />
              </mesh>
            ))}
            {[0.06, -0.005, -0.07].map((sy) => (
              <mesh key={sy} position={[0, sy, 0.024]}>
                <boxGeometry args={[0.022, 0.024, 0.01]} />
                <meshStandardMaterial color="#9ca3af" roughness={0.4} metalness={0.6} transparent opacity={opacity} />
              </mesh>
            ))}
            <mesh position={[0, 0.12, 0.005]}>
              <boxGeometry args={[0.2, 0.03, 0.045]} />
              <meshStandardMaterial color="#ff6a00" roughness={0.9} metalness={0} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "bandolera") {
    return (
          <group position={[a.chest[0], a.chest[1] + 0.02, a.chest[2] + 0.05]} rotation={[0, 0, -Math.PI / 4]}>
            <mesh>
              <boxGeometry args={[0.05, 0.34, 0.028]} />
              <meshStandardMaterial color="#5a3a1e" roughness={0.85} metalness={0.05} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0, 0, 0.017]}>
              <boxGeometry args={[0.012, 0.34, 0.006]} />
              <meshStandardMaterial color="#3a2410" roughness={0.9} transparent opacity={opacity} />
            </mesh>
            {[-0.13, -0.078, -0.026, 0.026, 0.078, 0.13].map((s, i) => (
              <group key={i} position={[0, s, 0.02]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.012, 0.012, 0.03, 12]} />
                  <meshStandardMaterial color={gold} metalness={0.9} roughness={0.2} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, 0, 0.025]} rotation={[Math.PI / 2, 0, 0]}>
                  <coneGeometry args={[0.012, 0.018, 12]} />
                  <meshStandardMaterial color="#c9822a" metalness={0.7} roughness={0.35} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
          </group>
        );
  }
  if (kind === "corbata-luces") {
    return (
          <group position={[a.chest[0], a.chest[1] + 0.09, a.chest[2] + 0.02]}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.055, 0, 0]} rotation={[0, 0, s * 0.35]} scale={[1.25, 0.85, 0.55]}>
                <sphereGeometry args={[0.05, 16, 16]} />
                <meshStandardMaterial color="#7f1020" roughness={0.35} metalness={0.15} transparent opacity={opacity} />
              </mesh>
            ))}
            <mesh>
              <boxGeometry args={[0.032, 0.05, 0.045]} />
              <meshStandardMaterial color={black} roughness={0.4} transparent opacity={opacity} />
            </mesh>
            {[
              { p: [-0.075, 0.018, 0.032], c: "#ff2d55" },
              { p: [-0.045, -0.02, 0.034], c: "#3ba7ff" },
              { p: [-0.022, 0.026, 0.03], c: "#ffd028" },
              { p: [-0.09, -0.01, 0.026], c: "#3dff88" },
              { p: [0.022, 0.02, 0.03], c: "#ff2d55" },
              { p: [0.05, -0.022, 0.034], c: "#c46bff" },
              { p: [0.078, 0.014, 0.03], c: "#3ba7ff" },
              { p: [0.09, -0.008, 0.026], c: "#ffd028" },
              { p: [-0.06, 0.03, 0.028], c: "#3dff88" },
              { p: [0.062, 0.03, 0.028], c: "#ff8a00" },
            ].map((d, i) => (
              <mesh key={i} position={d.p as [number, number, number]}>
                <sphereGeometry args={[0.009, 10, 10]} />
                <meshStandardMaterial color={d.c} emissive={d.c} emissiveIntensity={1.4} toneMapped={false} transparent opacity={opacity} />
              </mesh>
            ))}
          </group>
        );
  }
  if (kind === "collar-hawaiano") {
    return (
          <group position={[a.chest[0], a.chest[1] + 0.08, a.chest[2] + 0.02]} rotation={[0.5, 0, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.72]}>
              <torusGeometry args={[0.11, 0.009, 8, 30]} />
              <meshStandardMaterial color="#3f6212" roughness={0.7} transparent opacity={opacity} />
            </mesh>
            {Array.from({ length: 12 }).map((_, i) => {
              const ang = (i / 12) * Math.PI * 2;
              const fx = Math.cos(ang) * 0.11;
              const fz = Math.sin(ang) * 0.11 * 0.72;
              const petalColors = ["#ec4899", "#ffffff", "#facc15", "#fb923c"];
              const petal = petalColors[i % 4];
              return (
                <group key={i} position={[fx, 0, fz]} rotation={[0, Math.atan2(fx, fz), 0]}>
                  {Array.from({ length: 5 }).map((__, j) => {
                    const pAng = (j / 5) * Math.PI * 2;
                    return (
                      <mesh
                        key={j}
                        position={[Math.cos(pAng) * 0.02, Math.sin(pAng) * 0.02, 0.012]}
                      >
                        <sphereGeometry args={[0.016, 8, 8]} />
                        <meshStandardMaterial color={petal} roughness={0.45} transparent opacity={opacity} />
                      </mesh>
                    );
                  })}
                  <mesh position={[0, 0, 0.022]}>
                    <sphereGeometry args={[0.012, 8, 8]} />
                    <meshStandardMaterial color="#fde047" emissive="#f59e0b" emissiveIntensity={0.35} roughness={0.4} transparent opacity={opacity} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
  }
  if (kind === "mochila-jet") {
    return <CosmeticMochilaJet a={a} opacity={opacity} />;
  }
  if (kind === "alas-angel") {
    return (
        <group position={[0, a.chest[1] + 0.06, a.back[2] - 0.05]}>
          {[-1, 1].map((s) => (
            <group key={s} rotation={[0, s * 0.35, 0]}>
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const t = i / 5;
                return (
                  <mesh
                    key={i}
                    position={[s * (0.02 + t * 0.14), -0.02 + t * 0.16, -0.005 - t * 0.015]}
                    rotation={[0, 0, s * (0.4 + t * 0.7)]}
                    scale={[0.85 - t * 0.25, 1.6 - t * 0.5, 0.32]}
                  >
                    <sphereGeometry args={[0.05, 10, 8]} />
                    <meshStandardMaterial color="#fbfbf5" roughness={0.8} transparent opacity={opacity} />
                  </mesh>
                );
              })}
            </group>
          ))}
        </group>
      );
  }
  if (kind === "alas-demonio") {
    return (
          <group position={[0, a.chest[1] + 0.05, a.back[2] - 0.02]}>
            {[-1, 1].map((s) => {
              const spokeAngles = [0.5, 0.15, -0.25, -0.6];
              const spokeLen = [0.2, 0.24, 0.22, 0.16];
              const origin: [number, number, number] = [0.03, 0.0, -0.01];
              return (
                <group
                  key={s}
                  scale={[s, 1, 1]}
                  rotation={[0, s === 1 ? -0.4 : 0.4, 0]}
                >
                  <mesh position={[0.02, 0, -0.01]} rotation={[Math.PI / 2, 0, 0.25]}>
                    <cylinderGeometry args={[0.014, 0.02, 0.11, 8]} />
                    <meshStandardMaterial color="#3b0d10" roughness={0.6} transparent opacity={opacity} />
                  </mesh>
                  {spokeAngles.map((ang, i) => (
                    <mesh
                      key={`spoke-${i}`}
                      position={[
                        origin[0] + (Math.cos(ang) * spokeLen[i]) / 2,
                        origin[1] + (Math.sin(ang) * spokeLen[i]) / 2,
                        origin[2],
                      ]}
                      rotation={[0, 0, ang - Math.PI / 2]}
                    >
                      <cylinderGeometry args={[0.006, 0.011, spokeLen[i], 6]} />
                      <meshStandardMaterial color="#3b0d10" roughness={0.55} transparent opacity={opacity} />
                    </mesh>
                  ))}
                  {spokeAngles.map((ang, i) => (
                    <mesh
                      key={`claw-${i}`}
                      position={[
                        origin[0] + Math.cos(ang) * (spokeLen[i] + 0.02),
                        origin[1] + Math.sin(ang) * (spokeLen[i] + 0.02),
                        origin[2],
                      ]}
                      rotation={[0, 0, ang - Math.PI / 2]}
                    >
                      <coneGeometry args={[0.013, 0.04, 6]} />
                      <meshStandardMaterial color="#1f0507" roughness={0.5} transparent opacity={opacity} />
                    </mesh>
                  ))}
                  {spokeAngles.slice(0, -1).map((ang, i) => {
                    const nextAng = spokeAngles[i + 1];
                    const nextLen = spokeLen[i + 1];
                    const len = spokeLen[i];
                    const tipX = origin[0] + Math.cos(ang) * len;
                    const tipY = origin[1] + Math.sin(ang) * len;
                    const nextTipX = origin[0] + Math.cos(nextAng) * nextLen;
                    const nextTipY = origin[1] + Math.sin(nextAng) * nextLen;
                    const cx = (origin[0] + tipX + nextTipX) / 3;
                    const cy = (origin[1] + tipY + nextTipY) / 3;
                    const panelAng = (ang + nextAng) / 2;
                    const panelLen = (len + nextLen) / 2;
                    const spread = Math.abs(ang - nextAng);
                    return (
                      <mesh
                        key={`web-${i}`}
                        position={[cx, cy, origin[2] - 0.008]}
                        rotation={[0, 0, panelAng]}
                        scale={[panelLen * 1.05, panelLen * spread * 1.9, 1]}
                      >
                        <circleGeometry args={[0.5, 3]} />
                        <meshStandardMaterial
                          color="#5c0f16"
                          emissive="#2a0508"
                          emissiveIntensity={0.3}
                          roughness={0.7}
                          side={DoubleSide}
                          transparent
                          opacity={opacity * 0.9}
                        />
                      </mesh>
                    );
                  })}
                </group>
              );
            })}
          </group>
        );
  }
  if (kind === "caparazon-tortuga") {
    return (
          <group position={[0, a.chest[1] + 0.02, a.back[2] - 0.03]} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh scale={[1.15, 1.15, 0.85]}>
              <sphereGeometry args={[0.15, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#3f8f4f" roughness={0.9} metalness={0} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0.13, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.008, 6]} />
              <meshStandardMaterial color="#2c6636" roughness={0.95} transparent opacity={opacity} />
            </mesh>
            {Array.from({ length: 6 }).map((_, i) => {
              const ang = (i / 6) * Math.PI * 2;
              const tilt = Math.PI / 4;
              const r = Math.sin(tilt) * 0.15;
              const x = Math.cos(ang) * r * 1.15;
              const z = Math.sin(ang) * r * 1.15;
              const y = Math.cos(tilt) * 0.15;
              return (
                <mesh
                  key={`plate-${i}`}
                  position={[x, y, z]}
                  rotation={[tilt * Math.sin(ang), -ang, tilt * Math.cos(ang)]}
                >
                  <cylinderGeometry args={[0.038, 0.038, 0.008, 6]} />
                  <meshStandardMaterial color="#2c6636" roughness={0.95} transparent opacity={opacity} />
                </mesh>
              );
            })}
            {Array.from({ length: 18 }).map((_, i) => {
              const ang = (i / 18) * Math.PI * 2;
              return (
                <mesh
                  key={`rim-${i}`}
                  position={[Math.cos(ang) * 0.153 * 1.15, 0.004, Math.sin(ang) * 0.153 * 1.15]}
                  rotation={[0, -ang, 0]}
                >
                  <boxGeometry args={[0.036, 0.03, 0.02]} />
                  <meshStandardMaterial color="#b8895a" roughness={0.95} transparent opacity={opacity} />
                </mesh>
              );
            })}
          </group>
        );
  }
  if (kind === "capa-super") {
    return (
          <group position={[0, a.chest[1] + 0.05, a.back[2] - 0.02]}>
            <mesh position={[0, 0.02, 0]} rotation={[0, 0, 0.04]}>
              <boxGeometry args={[0.16, 0.13, 0.008]} />
              <meshStandardMaterial color="#dc2626" roughness={0.55} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[-0.055, -0.08, -0.012]} rotation={[0.12, 0.14, 0.05]}>
              <boxGeometry args={[0.11, 0.16, 0.008]} />
              <meshStandardMaterial color="#c81e1e" roughness={0.55} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0.055, -0.08, -0.012]} rotation={[0.12, -0.14, -0.05]}>
              <boxGeometry args={[0.11, 0.16, 0.008]} />
              <meshStandardMaterial color="#c81e1e" roughness={0.55} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[-0.1, -0.16, -0.028]} rotation={[0.24, 0.26, 0.08]}>
              <boxGeometry args={[0.095, 0.17, 0.008]} />
              <meshStandardMaterial color="#b91c1c" roughness={0.55} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0.1, -0.16, -0.028]} rotation={[0.24, -0.26, -0.08]}>
              <boxGeometry args={[0.095, 0.17, 0.008]} />
              <meshStandardMaterial color="#b91c1c" roughness={0.55} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <mesh position={[0, -0.2, -0.04]} rotation={[0.32, 0, 0]}>
              <boxGeometry args={[0.13, 0.16, 0.008]} />
              <meshStandardMaterial color="#a01414" roughness={0.55} transparent opacity={opacity} side={DoubleSide} />
            </mesh>
            <group position={[0, 0.085, 0.02]}>
              <mesh position={[-0.06, 0, 0]}>
                <sphereGeometry args={[0.02, 14, 14]} />
                <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} transparent opacity={opacity} />
              </mesh>
              <mesh position={[0.06, 0, 0]}>
                <sphereGeometry args={[0.02, 14, 14]} />
                <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} transparent opacity={opacity} />
              </mesh>
              <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.006, 0.006, 0.12, 10]} />
                <meshStandardMaterial color={gold} metalness={0.85} roughness={0.2} transparent opacity={opacity} />
              </mesh>
            </group>
          </group>
        );
  }
  if (kind === "tanque-buzo") {
    return (
          <group position={[a.chest[0], a.chest[1] + 0.02, a.back[2] - 0.04]}>
            {[-0.045, 0.045].map((dx, i) => (
              <group key={i} position={[dx, 0, 0]}>
                <mesh position={[0, 0, 0]}>
                  <cylinderGeometry args={[0.035, 0.035, 0.19, 20]} />
                  <meshStandardMaterial
                    color={i === 0 ? "#14b8a6" : "#facc15"}
                    metalness={0.55}
                    roughness={0.18}
                    transparent
                    opacity={opacity}
                  />
                </mesh>
                <mesh position={[0, 0.098, 0]}>
                  <sphereGeometry args={[0.035, 20, 12]} />
                  <meshStandardMaterial
                    color={i === 0 ? "#14b8a6" : "#facc15"}
                    metalness={0.55}
                    roughness={0.18}
                    transparent
                    opacity={opacity}
                  />
                </mesh>
                <mesh position={[0, -0.098, 0]}>
                  <sphereGeometry args={[0.035, 20, 12]} />
                  <meshStandardMaterial
                    color={i === 0 ? "#0f766e" : "#ca8a04"}
                    metalness={0.55}
                    roughness={0.18}
                    transparent
                    opacity={opacity}
                  />
                </mesh>
                <mesh position={[0, 0.128, 0]}>
                  <cylinderGeometry args={[0.011, 0.011, 0.03, 12]} />
                  <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.25} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, 0.148, 0]}>
                  <sphereGeometry args={[0.02, 14, 10]} />
                  <meshStandardMaterial color={black} metalness={0.4} roughness={0.4} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, 0.048, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.036, 0.006, 8, 20]} />
                  <meshStandardMaterial color="#f97316" metalness={0.3} roughness={0.5} transparent opacity={opacity} />
                </mesh>
                <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.036, 0.006, 8, 20]} />
                  <meshStandardMaterial color="#f97316" metalness={0.3} roughness={0.5} transparent opacity={opacity} />
                </mesh>
              </group>
            ))}
            {[
              { p: [0.045, 0.15, 0.02] as Vec3, r: [0.3, 0, -0.5] as Vec3 },
              { p: [0.068, 0.155, 0.06] as Vec3, r: [0.7, 0, -0.85] as Vec3 },
              { p: [0.085, 0.135, 0.11] as Vec3, r: [1.1, 0, -1.05] as Vec3 },
              { p: [0.085, 0.095, 0.155] as Vec3, r: [1.45, 0, -1.0] as Vec3 },
            ].map((seg, i) => (
              <mesh key={`hose-${i}`} position={seg.p} rotation={seg.r}>
                <cylinderGeometry args={[0.009, 0.009, 0.065, 10]} />
                <meshStandardMaterial color="#1f2937" metalness={0.3} roughness={0.6} transparent opacity={opacity} />
              </mesh>
            ))}
            <mesh position={[0.085, 0.07, 0.185]} rotation={[Math.PI / 2, 0, 0]}>
              <boxGeometry args={[0.05, 0.03, 0.02]} />
              <meshStandardMaterial color={black} metalness={0.5} roughness={0.35} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "alas-hada") {
    return (
          <group position={[0, a.chest[1] + 0.05, a.back[2] - 0.02]}>
            {[-1, 1].map((s) => (
              <group key={s}>
                <mesh position={[s * 0.11, 0.06, -0.008]} rotation={[0, s * -0.4, s * 0.5]} scale={[0.09, 0.15, 1]}>
                  <circleGeometry args={[1, 28]} />
                  <meshStandardMaterial color="#f9a8d4" emissive="#ec4899" emissiveIntensity={0.4} roughness={0.25} transparent opacity={opacity * 0.5} side={DoubleSide} />
                </mesh>
                <mesh position={[s * 0.075, 0.05, 0.004]} rotation={[0, s * -0.4, s * 0.5]} scale={[0.05, 0.1, 1]}>
                  <circleGeometry args={[1, 28]} />
                  <meshStandardMaterial color="#a7f3d0" emissive="#2dd4bf" emissiveIntensity={0.35} roughness={0.25} transparent opacity={opacity * 0.4} side={DoubleSide} />
                </mesh>
                <mesh position={[s * 0.09, -0.08, -0.008]} rotation={[0, s * -0.32, s * -0.55]} scale={[0.06, 0.1, 1]}>
                  <circleGeometry args={[1, 28]} />
                  <meshStandardMaterial color="#c4b5fd" emissive="#8b5cf6" emissiveIntensity={0.4} roughness={0.25} transparent opacity={opacity * 0.48} side={DoubleSide} />
                </mesh>
                <mesh position={[s * 0.065, -0.07, 0.004]} rotation={[0, s * -0.32, s * -0.55]} scale={[0.035, 0.065, 1]}>
                  <circleGeometry args={[1, 28]} />
                  <meshStandardMaterial color="#bae6fd" emissive="#38bdf8" emissiveIntensity={0.35} roughness={0.25} transparent opacity={opacity * 0.4} side={DoubleSide} />
                </mesh>
                <mesh position={[s * 0.11, 0.06, 0.008]} rotation={[0, s * -0.4, s * 0.5]}>
                  <boxGeometry args={[0.004, 0.26, 0.004]} />
                  <meshStandardMaterial color="#fbcfe8" emissive="#f9a8d4" emissiveIntensity={0.3} transparent opacity={opacity * 0.7} />
                </mesh>
                <mesh position={[s * 0.09, -0.08, 0.008]} rotation={[0, s * -0.32, s * -0.55]}>
                  <boxGeometry args={[0.004, 0.18, 0.004]} />
                  <meshStandardMaterial color="#ddd6fe" emissive="#c4b5fd" emissiveIntensity={0.3} transparent opacity={opacity * 0.7} />
                </mesh>
              </group>
            ))}
          </group>
        );
  }
  if (kind === "guantes-boxeo") {
    return (
          <group>
            {[a.leftHand, a.rightHand].map((h, i) => {
              const side = i === 0 ? -1 : 1;
              return (
                <group key={i} position={[h[0], h[1], h[2] + 0.01]}>
                  <mesh scale={[1, 0.92, 0.85]}>
                    <sphereGeometry args={[0.075, 20, 20]} />
                    <meshStandardMaterial color="#dc2626" roughness={0.15} metalness={0.1} transparent opacity={opacity} />
                  </mesh>
                  <mesh position={[side * 0.055, -0.028, 0.02]} scale={[1, 1.1, 1]}>
                    <sphereGeometry args={[0.032, 16, 16]} />
                    <meshStandardMaterial color="#dc2626" roughness={0.15} metalness={0.1} transparent opacity={opacity} />
                  </mesh>
                  <mesh position={[0, -0.066, 0]}>
                    <cylinderGeometry args={[0.052, 0.052, 0.04, 18]} />
                    <meshStandardMaterial color="#ffffff" roughness={0.55} transparent opacity={opacity} />
                  </mesh>
                  {[0, 1, 2].map((j) => (
                    <mesh key={j} position={[0, 0.024 - j * 0.022, 0.07]} rotation={[0, 0, j % 2 === 0 ? 0.35 : -0.35]}>
                      <boxGeometry args={[0.05, 0.006, 0.005]} />
                      <meshStandardMaterial color="#ffffff" roughness={0.55} transparent opacity={opacity} />
                    </mesh>
                  ))}
                </group>
              );
            })}
          </group>
        );
  }
  if (kind === "sable-laser") {
    return <CosmeticSableLaser a={a} opacity={opacity} />;
  }
  if (kind === "varita-magica") {
    return (
        <group position={[a.rightHand[0] + 0.02, a.rightHand[1] + 0.05, a.rightHand[2] + 0.02]} rotation={[0, 0, 0.12]}>
          <mesh>
            <cylinderGeometry args={[0.007, 0.009, 0.18, 10]} />
            <meshStandardMaterial color="#3a2b1a" roughness={0.6} transparent opacity={opacity} />
          </mesh>
          <group position={[0, 0.11, 0]}>
            {[0, 1, 2, 3, 4].map((i) => {
              const ang = (i / 5) * Math.PI * 2;
              return (
                <mesh key={i} position={[Math.cos(ang) * 0.03, Math.sin(ang) * 0.03, 0]} rotation={[0, 0, ang - Math.PI / 2]}>
                  <coneGeometry args={[0.014, 0.055, 4]} />
                  <meshStandardMaterial color={gold} emissive="#fbbf24" emissiveIntensity={0.9} roughness={0.3} transparent opacity={opacity} toneMapped={false} />
                </mesh>
              );
            })}
            <mesh>
              <sphereGeometry args={[0.02, 12, 10]} />
              <meshStandardMaterial color="#fff7cc" emissive="#fde68a" emissiveIntensity={1} transparent opacity={opacity} toneMapped={false} />
            </mesh>
          </group>
        </group>
      );
  }
  if (kind === "maracas") {
    return (
        <group>
          {[
            { p: a.leftHand, c: "#ef4444", s: -1 },
            { p: a.rightHand, c: "#f59e0b", s: 1 },
          ].map((m, i) => (
            <group key={i} position={[m.p[0] + m.s * 0.01, m.p[1] + 0.05, m.p[2] + 0.01]} rotation={[0, 0, m.s * 0.25]}>
              <mesh position={[0, 0.03, 0]}>
                <sphereGeometry args={[0.045, 14, 12]} />
                <meshStandardMaterial color={m.c} roughness={0.55} transparent opacity={opacity} />
              </mesh>
              <mesh position={[0, -0.03, 0]}>
                <cylinderGeometry args={[0.012, 0.014, 0.07, 10]} />
                <meshStandardMaterial color="#7a4a24" roughness={0.6} transparent opacity={opacity} />
              </mesh>
              {[0, 1, 2].map((d) => (
                <mesh key={d} position={[Math.cos(d * 2.1) * 0.028, 0.03 + Math.sin(d * 2.1) * 0.028, 0.038]}>
                  <sphereGeometry args={[0.006, 6, 6]} />
                  <meshStandardMaterial color="#fef3c7" roughness={0.5} transparent opacity={opacity} />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      );
  }
  if (kind === "copa-champan") {
    return (
        <group position={[a.rightHand[0] + 0.02, a.rightHand[1] + 0.05, a.rightHand[2] + 0.02]}>
          <mesh position={[0, -0.055, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.005, 16]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.2} metalness={0.1} transparent opacity={opacity * 0.85} />
          </mesh>
          <mesh position={[0, -0.01, 0]}>
            <cylinderGeometry args={[0.005, 0.005, 0.09, 8]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.15} transparent opacity={opacity * 0.7} />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.028, 0.014, 0.075, 16, 1, true]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.1} metalness={0.05} transparent opacity={opacity * 0.35} side={DoubleSide} />
          </mesh>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.02, 0.013, 0.045, 16]} />
            <meshStandardMaterial color="#facc15" roughness={0.2} transparent opacity={opacity * 0.7} />
          </mesh>
          {[0, 1, 2].map((b) => (
            <mesh key={b} position={[(b - 1) * 0.008, 0.07 + b * 0.015, 0.006]}>
              <sphereGeometry args={[0.0035, 6, 6]} />
              <meshStandardMaterial color="#fffbeb" transparent opacity={opacity * 0.85} />
            </mesh>
          ))}
        </group>
      );
  }
  if (kind === "jarra-cerveza") {
    return (
          <group position={[a.rightHand[0], a.rightHand[1] + 0.05, a.rightHand[2] + 0.01]}>
            <mesh position={[0, 0, 0]}>
              <cylinderGeometry args={[0.055, 0.05, 0.13, 20]} />
              <meshStandardMaterial color="#cfe8ff" metalness={0.1} roughness={0.05} transparent opacity={opacity * 0.35} side={DoubleSide} />
            </mesh>
            <mesh position={[0, -0.012, 0]}>
              <cylinderGeometry args={[0.049, 0.045, 0.095, 20]} />
              <meshStandardMaterial color="#f5a623" emissive="#c97a00" emissiveIntensity={0.2} roughness={0.25} transparent opacity={opacity * 0.92} />
            </mesh>
            <mesh position={[0, -0.062, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.012, 20]} />
              <meshStandardMaterial color="#bcd9f0" metalness={0.2} roughness={0.1} transparent opacity={opacity * 0.5} />
            </mesh>
            <mesh position={[0.06, 0.005, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.036, 0.011, 10, 20, Math.PI]} />
              <meshStandardMaterial color="#cfe8ff" metalness={0.15} roughness={0.08} transparent opacity={opacity * 0.45} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0.06, 0]}>
              <sphereGeometry args={[0.05, 16, 14]} />
              <meshStandardMaterial color="#fffdf5" roughness={0.85} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.024, 0.075, 0.018]}>
              <sphereGeometry args={[0.03, 14, 12]} />
              <meshStandardMaterial color="#ffffff" roughness={0.85} transparent opacity={opacity} />
            </mesh>
            <mesh position={[-0.026, 0.073, -0.012]}>
              <sphereGeometry args={[0.028, 14, 12]} />
              <meshStandardMaterial color="#fbfaf3" roughness={0.85} transparent opacity={opacity} />
            </mesh>
            <mesh position={[0.002, 0.088, -0.02]}>
              <sphereGeometry args={[0.024, 12, 10]} />
              <meshStandardMaterial color="#ffffff" roughness={0.85} transparent opacity={opacity} />
            </mesh>
          </group>
        );
  }
  if (kind === "antorcha") {
    return <CosmeticAntorcha a={a} opacity={opacity} />;
  }
  if (kind === "globo-perro") {
    return (
        <group position={[a.leftHand[0] - 0.03, a.leftHand[1] + 0.07, a.leftHand[2] + 0.02]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.018, 0.018, 0.09, 12]} />
            <meshStandardMaterial color="#ec4899" roughness={0.15} metalness={0.05} transparent opacity={opacity} />
          </mesh>
          {[[-0.035, -0.02], [-0.035, 0.02], [0.035, -0.02], [0.035, 0.02]].map((pos, i) => (
            <mesh key={i} position={[pos[0], -0.03, pos[1]]}>
              <cylinderGeometry args={[0.013, 0.013, 0.05, 10]} />
              <meshStandardMaterial color="#ec4899" roughness={0.15} metalness={0.05} transparent opacity={opacity} />
            </mesh>
          ))}
          <mesh position={[0.05, 0.03, 0]} rotation={[0, 0, -0.5]}>
            <cylinderGeometry args={[0.014, 0.014, 0.06, 10]} />
            <meshStandardMaterial color="#ec4899" roughness={0.15} metalness={0.05} transparent opacity={opacity} />
          </mesh>
          <mesh position={[0.075, 0.06, 0]}>
            <sphereGeometry args={[0.022, 12, 10]} />
            <meshStandardMaterial color="#ec4899" roughness={0.15} metalness={0.05} transparent opacity={opacity} />
          </mesh>
          <mesh position={[0.095, 0.052, 0]} rotation={[0, 0, 1.4]}>
            <cylinderGeometry args={[0.009, 0.011, 0.03, 8]} />
            <meshStandardMaterial color="#ec4899" roughness={0.15} metalness={0.05} transparent opacity={opacity} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.07, 0.075, s * 0.016]} rotation={[Math.PI / 2, 0.3, 0]}>
              <torusGeometry args={[0.014, 0.006, 8, 14]} />
              <meshStandardMaterial color="#db2777" roughness={0.2} metalness={0.05} transparent opacity={opacity} />
            </mesh>
          ))}
          {[[0.04, 0], [-0.04, 0], [0.05, 0.055]].map((pos, i) => (
            <mesh key={i} position={[pos[0], pos[1], 0]}>
              <sphereGeometry args={[0.008, 8, 8]} />
              <meshStandardMaterial color="#f9a8d4" roughness={0.2} transparent opacity={opacity} />
            </mesh>
          ))}
        </group>
      );
  }

  const anchor = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { z: 0.04 });
  return (
    <group position={anchor} rotation={[0, 0, rotation]} scale={scale}>
      <mesh geometry={TOKEN_TATTOO_GEOMETRY} dispose={null}>
        <meshBasicMaterial color={primary} transparent opacity={opacity * 0.9} side={DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

function PetCompanion({
  opacity,
  kind,
  color,
  secondaryColor,
}: {
  opacity: number;
  kind: "dog" | "cat";
  color: string;
  secondaryColor: string;
}) {
  const hop = useRef<Group | null>(null);
  useFrame((state) => {
    if (!hop.current) return;
    const time = state.clock.elapsedTime;
    hop.current.position.y = Math.abs(Math.sin(time * 3.4)) * 0.09;
    hop.current.rotation.x = Math.sin(time * 3.4) * 0.12;
  });

  return (
    <group position={[0.42, 0, 0.06]}>
      <group ref={hop}>
        <mesh castShadow position={[0, 0.08, 0]} scale={[1, 0.85, 1.35]}>
          <sphereGeometry args={[0.08, 12, 10]} />
          <meshStandardMaterial color={color} roughness={0.65} transparent opacity={opacity} />
        </mesh>
        <mesh castShadow position={[0, 0.14, 0.09]}>
          <sphereGeometry args={[0.06, 12, 10]} />
          <meshStandardMaterial color={color} roughness={0.65} transparent opacity={opacity} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.035, 0.19, 0.08]} scale={kind === "cat" ? [0.55, 1.1, 0.4] : [0.75, 0.7, 0.45]}>
            <sphereGeometry args={[0.026, 8, 6]} />
            <meshStandardMaterial color={secondaryColor} roughness={0.7} transparent opacity={opacity} />
          </mesh>
        ))}
        <mesh position={[0, 0.115, 0.14]}>
          <sphereGeometry args={[0.03, 8, 6]} />
          <meshStandardMaterial color={secondaryColor} roughness={0.65} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.12, 0.17]}>
          <sphereGeometry args={[0.011, 8, 6]} />
          <meshStandardMaterial color="#111827" roughness={0.5} transparent opacity={opacity} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={`eye-${side}`} position={[side * 0.022, 0.15, 0.135]}>
            <sphereGeometry args={[0.008, 6, 6]} />
            <meshStandardMaterial color="#111827" roughness={0.4} transparent opacity={opacity} />
          </mesh>
        ))}
        {([[-0.04, -0.05], [0.04, -0.05], [-0.04, 0.06], [0.04, 0.06]] as [number, number][]).map(([x, z], index) => (
          <mesh key={index} position={[x, 0.02, z]}>
            <cylinderGeometry args={[0.015, 0.015, 0.06, 6]} />
            <meshStandardMaterial color={secondaryColor} roughness={0.7} transparent opacity={opacity} />
          </mesh>
        ))}
        <mesh position={[0, 0.12, -0.09]} rotation={[0.7, 0, 0]}>
          <cylinderGeometry args={[0.01, 0.016, 0.11, 6]} />
          <meshStandardMaterial color={color} roughness={0.65} transparent opacity={opacity} />
        </mesh>
      </group>
    </group>
  );
}

function anchorSurface(
  anchorType: "face" | "body" | "token",
  anchorId: string,
  faceAnchors?: Record<string, FaceAnchor>,
  bodyAnchors?: Record<string, FaceAnchor>
): Vec3 {
  if (anchorType === "face") {
    return tokenAnchorSurface({ id: anchorId, scope: "face" }, faceAnchors?.[anchorId] ?? defaultTokenAnchor(anchorId)).position;
  }
  if (anchorType === "body") {
    return tokenAnchorSurface({ id: anchorId, scope: "body" }, bodyAnchors?.[anchorId] ?? defaultTokenAnchor(anchorId)).position;
  }
  return [0, 0.2, 0.2];
}

function anchorSurfaceForRef(
  anchor: { anchorType: "face" | "body" | "token"; anchorId: string },
  faceAnchors?: Record<string, FaceAnchor>,
  bodyAnchors?: Record<string, FaceAnchor>
): Vec3 {
  return anchorSurface(anchor.anchorType, anchor.anchorId, faceAnchors, bodyAnchors);
}

function transformedAnchor(
  cosmetic: CosmeticDef,
  faceAnchors: Record<string, FaceAnchor> | undefined,
  bodyAnchors: Record<string, FaceAnchor> | undefined,
  defaults: { x?: number; y?: number; z?: number }
): Vec3 {
  const base = anchorSurfaceForRef(cosmeticAnchorRefs(cosmetic)[0] ?? { anchorType: "body", anchorId: "chest" }, faceAnchors, bodyAnchors);
  return [
    base[0] + (defaults.x ?? 0) + (cosmetic.transform?.x ?? 0),
    base[1] + (defaults.y ?? 0) + (cosmetic.transform?.y ?? 0),
    base[2] + (defaults.z ?? 0) + (cosmetic.transform?.z ?? 0),
  ];
}

function cosmeticScale(cosmetic: CosmeticDef): [number, number, number] {
  const base = cosmetic.transform?.scale ?? 1;
  return [
    base * (cosmetic.transform?.scaleX ?? 1),
    base * (cosmetic.transform?.scaleY ?? 1),
    base * (cosmetic.transform?.scaleZ ?? 1),
  ];
}

function cosmeticRotation(cosmetic: CosmeticDef): number {
  return (((cosmetic.transform?.rotationZ ?? cosmetic.transform?.rotation ?? 0) * Math.PI) / 180);
}

function cosmeticColor(cosmetic: CosmeticDef, key: "color" | "secondaryColor", fallback: string): string {
  const previewValue = cosmetic.preview?.[key];
  if (previewValue) return previewValue;
  if (typeof cosmetic.asset !== "string") return cosmetic.asset[key] ?? fallback;
  return fallback;
}

function defaultCosmeticColor(kind: string): string {
  if (kind === "mustache-handlebar") return "#3a2416";
  if (kind === "mustache-pencil") return "#111827";
  if (kind === "mustache-chaplin") return "#160b05";
  if (kind === "top-hat") return "#111827";
  if (kind === "cap") return "#2563eb";
  if (kind === "field-hat") return "#c69a5b";
  if (kind === "coin-crown" || kind === "gold-chain") return "#f5c542";
  if (kind === "dice-necklace") return "#cbd5e1";
  if (kind === "wristwatch") return "#3a2416";
  if (kind === "tuxedo") return "#0f1115";
  if (kind === "pet-dog") return "#a9702f";
  if (kind === "pet-cat") return "#7c8794";
  if (kind === "hat") return "#a855f7";
  if (kind === "piercing") return "#e5e7eb";
  if (kind === "tattoo") return "#111827";
  if (kind === "beard") return "#4b2a12";
  return "#111827";
}

function PlayerToken({
  player,
  active,
  path,
  motion,
  motionKind,
  motionNonce,
  focused,
  cosmeticCatalog,
  effectVisuals,
  onSelect,
  onClickSound,
  trackRef,
}: {
  player: Player;
  active: boolean;
  path: Vec3[];
  motion: BoardMotionSettings;
  motionKind: BoardMotionKind;
  motionNonce: string;
  focused: boolean;
  cosmeticCatalog: Record<string, CosmeticDef>;
  effectVisuals: EffectInstance[];
  onSelect?: (playerId: string) => void;
  onClickSound?: (playerId: string) => void;
  /** la cámara lee de acá la posición viva del muñeco seguido */
  trackRef?: { current: Vector3 | null };
}) {
  const { gl } = useThree();
  const group = useRef<Group | null>(null);
  const visualGroup = useRef<Group | null>(null);
  const markerRef = useRef<Mesh | null>(null);
  const squishAge = useRef(Number.POSITIVE_INFINITY);
  const segment = useRef(0);
  const progress = useRef(0);
  const selectPlayer = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (!onSelect) return;
      event.stopPropagation();
      squishAge.current = 0;
      onClickSound?.(player.id);
      onSelect(player.id);
    },
    [onClickSound, onSelect, player.id]
  );
  const setPointerCursor = useCallback(
    (cursor: string) => {
      if (onSelect) gl.domElement.style.cursor = cursor;
    },
    [gl, onSelect]
  );
  useEffect(
    () => () => {
      if (onSelect && gl.domElement.style.cursor === "pointer") gl.domElement.style.cursor = "";
    },
    [gl, onSelect]
  );
  const pathKey = `${motionKind}:${motionNonce}:${path.map((point) => point.join(",")).join("|")}`;
  const points = useMemo(() => path.map((point) => new Vector3(...point)), [pathKey]);
  const finalPoint = path[path.length - 1] ?? [0, 0, 0];
  const start = motion.tokenStepSeconds === 0 ? finalPoint : path[0] ?? finalPoint;

  useEffect(() => {
    segment.current = 0;
    progress.current = 0;
    if (group.current) group.current.position.copy(new Vector3(...start));
  }, [pathKey, start]);

  useFrame((state, delta) => {
    const token = group.current;
    if (!token || points.length === 0) return;
    if (motion.tokenStepSeconds === 0) {
      token.position.copy(points[points.length - 1]);
    } else if (points.length === 1) {
      token.position.lerp(points[0], frameLerp(delta, 10));
    } else {
      const next = Math.min(segment.current + 1, points.length - 1);
      progress.current += delta / motion.tokenStepSeconds;
      const t = easeOut(Math.min(1, progress.current));
      token.position.lerpVectors(points[segment.current], points[next], t);
      token.position.y += Math.sin(Math.min(1, progress.current) * Math.PI) * (motionKind === "jump" ? 0.95 : 0.22);
      if (progress.current >= 1) {
        segment.current = next;
        progress.current = 0;
        token.position.copy(points[next]);
      }
    }
    // La cámara sigue esta posición viva (no el destino final)
    if (trackRef) trackRef.current = (trackRef.current ?? new Vector3()).copy(token.position);
    // Floating turn marker above the active pawn (pawn itself stays still)
    if (markerRef.current && active && motion.tokenStepSeconds !== 0) {
      markerRef.current.position.y = 0.94 + Math.sin(state.clock.elapsedTime * 2.6) * 0.05;
      markerRef.current.rotation.y = state.clock.elapsedTime * 1.6;
    }
    if (visualGroup.current) {
      const age = squishAge.current;
      if (age < 0.22) {
        const t = age / 0.22;
        const pulse = Math.sin(t * Math.PI);
        const rebound = Math.sin(Math.min(1, t * 1.35) * Math.PI) * 0.05;
        visualGroup.current.scale.set(1 + pulse * 0.18, 1 - pulse * 0.22 + rebound, 1 + pulse * 0.18);
        squishAge.current += delta;
      } else {
        visualGroup.current.scale.lerp(new Vector3(1, 1, 1), frameLerp(delta, 16));
      }
    }
  });

  const opacity = player.connected ? 1 : 0.45;
  const hasBackpackArtifact = effectVisuals.some((effect) => effect.visualAssetId === "backpack");

  return (
    <group
      ref={group}
      position={start}
      name={`player-token-${player.id}`}
      userData={{ kind: "player-token", playerId: player.id }}
      onClick={onSelect ? selectPlayer : undefined}
      onPointerOver={onSelect ? (event) => { event.stopPropagation(); setPointerCursor("pointer"); } : undefined}
      onPointerOut={onSelect ? () => setPointerCursor("") : undefined}
    >
      {onSelect && (
        <mesh
          name={`player-hit-target-${player.id}`}
          userData={{ kind: "player-token-hit-target", playerId: player.id }}
          position={[0, 0.42, 0]}
        >
          <cylinderGeometry args={[0.38, 0.42, 0.9, 24]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <group ref={visualGroup}>
        <PlayerTokenPawn
          character={player}
          facePhoto={player.facePhoto}
          facePhotoAlignment={player.facePhotoAlignment}
          faceAnchors={player.faceAnchors}
          bodyAnchors={player.bodyAnchors}
          cosmeticIds={player.cosmeticIds}
          cosmeticCatalog={cosmeticCatalog}
          opacity={opacity}
          focused={focused}
        />
        {hasBackpackArtifact && <TokenArtifactBackpack opacity={opacity} />}
      </group>
      {/* Floating turn marker */}
      {active && (
        <mesh ref={markerRef} position={[0, 0.94, 0]} geometry={TOKEN_MARKER_GEOMETRY} dispose={null}>
          <meshStandardMaterial color="#fde047" emissive="#f59e0b" emissiveIntensity={0.85} roughness={0.25} />
        </mesh>
      )}
    </group>
  );
}

function TokenArtifactBackpack({ opacity }: { opacity: number }) {
  return (
    <group position={[0, 0.32, 0.17]} rotation={[0.12, 0, 0]}>
      <mesh castShadow scale={[0.95, 1.15, 0.58]} geometry={TOKEN_ARTIFACT_PACK_GEOMETRY} dispose={null}>
        <meshStandardMaterial color="#2563eb" roughness={0.55} metalness={0.08} transparent opacity={opacity} />
      </mesh>
      <mesh castShadow position={[0, 0.055, 0.048]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.72, 1]} geometry={TOKEN_ARTIFACT_PACK_FLAP_GEOMETRY} dispose={null}>
        <meshStandardMaterial color="#1d4ed8" roughness={0.5} metalness={0.12} transparent opacity={opacity} />
      </mesh>
      <mesh position={[-0.065, 0.01, -0.006]} rotation={[Math.PI / 2, 0.18, 0]} scale={[0.62, 1, 0.72]} geometry={TOKEN_ARTIFACT_PACK_STRAP_GEOMETRY} dispose={null}>
        <meshStandardMaterial color="#bae6fd" roughness={0.4} transparent opacity={opacity * 0.86} />
      </mesh>
      <mesh position={[0.065, 0.01, -0.006]} rotation={[Math.PI / 2, -0.18, 0]} scale={[0.62, 1, 0.72]} geometry={TOKEN_ARTIFACT_PACK_STRAP_GEOMETRY} dispose={null}>
        <meshStandardMaterial color="#bae6fd" roughness={0.4} transparent opacity={opacity * 0.86} />
      </mesh>
    </group>
  );
}

const DICE_PIP_LAYOUTS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [-1, 1],
    [0, 0],
    [1, -1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ],
};

// Standard die layout: 1 on top, 6 on bottom, 2 front, 5 back, 3 right, 4 left
// (opposite faces always sum to 7).
const DICE_FACES: Array<{
  value: number;
  toPosition: (u: number, v: number, h: number) => Vec3;
  rotation: [number, number, number];
}> = [
  { value: 1, toPosition: (u, v, h) => [u, h, -v], rotation: [-Math.PI / 2, 0, 0] },
  { value: 6, toPosition: (u, v, h) => [u, -h, v], rotation: [Math.PI / 2, 0, 0] },
  { value: 2, toPosition: (u, v, h) => [u, v, h], rotation: [0, 0, 0] },
  { value: 5, toPosition: (u, v, h) => [-u, v, -h], rotation: [0, Math.PI, 0] },
  { value: 3, toPosition: (u, v, h) => [h, v, -u], rotation: [0, Math.PI / 2, 0] },
  { value: 4, toPosition: (u, v, h) => [-h, v, u], rotation: [0, -Math.PI / 2, 0] },
];

// Euler rotations that bring the face with a given value to the top (+Y).
const DICE_FACE_UP_EULER: Record<number, [number, number, number]> = {
  1: [0, 0, 0],
  2: [-Math.PI / 2, 0, 0],
  3: [0, 0, Math.PI / 2],
  4: [0, 0, -Math.PI / 2],
  5: [Math.PI / 2, 0, 0],
  6: [Math.PI, 0, 0],
};

// Duración total del tiro: tirar+girar por ~0.7s y asentar con rebote por ~0.3s.
const DICE_TOSS_SECONDS = 0.7;
const DICE_SETTLE_SECONDS = 0.35;
const DICE_ROLL_TOTAL_SECONDS = DICE_TOSS_SECONDS + DICE_SETTLE_SECONDS;
const DICE_TOSS_ARC_HEIGHT = 0.9;

function FloatingDice({ cue, position, motion }: { cue: BoardDiceCue; position: Vec3; motion: BoardMotionSettings }) {
  const group = useRef<Group | null>(null);
  const cubeRef = useRef<Group | null>(null);
  const rollValue = cue.value ?? 1;
  const hasBaseValue = typeof cue.baseValue === "number" && Number.isFinite(cue.baseValue);
  const baseRollValue = hasBaseValue ? cue.baseValue! : rollValue;
  const value = Math.max(1, Math.min(6, baseRollValue));
  const modifiedValue = hasBaseValue ? baseRollValue !== rollValue : rollValue !== value;
  const DICE_SIZE = 0.64;
  const animated = motion.tokenStepSeconds !== 0;
  // Cuánto pasó desde que arrancó el tiro actual (nonce), para animar en función
  // del tiempo transcurrido en vez de acumular estado cuadro a cuadro.
  const rollStartRef = useRef<number | null>(null);
  const rollSeedRef = useRef(0);
  const settledQuat = useMemo(() => {
    const align = new Quaternion().setFromEuler(new Euler(...DICE_FACE_UP_EULER[value]));
    const tilt = new Quaternion().setFromEuler(new Euler(0.52, 0, 0));
    return tilt.multiply(align);
  }, [value]);

  useEffect(() => {
    // Nueva tirada: reiniciamos el reloj de la animación. Semilla determinística
    // por nonce (no Math.random en el frame) para variar un poco el tumble eje
    // a eje entre tiradas sin depender de aleatoriedad por cuadro.
    rollStartRef.current = null;
    let seed = 0;
    for (let i = 0; i < cue.nonce.length; i++) seed = (seed * 31 + cue.nonce.charCodeAt(i)) >>> 0;
    rollSeedRef.current = seed;
  }, [cue.nonce]);

  useFrame((state, delta) => {
    if (!group.current) return;
    if (rollStartRef.current === null) rollStartRef.current = state.clock.elapsedTime;
    const elapsedRoll = state.clock.elapsedTime - rollStartRef.current;
    const skipToss = !animated; // reduced motion: directo a la pose asentada
    const inToss = !skipToss && elapsedRoll < DICE_ROLL_TOTAL_SECONDS;

    const cube = cubeRef.current;

    if (inToss) {
      const tossT = Math.min(1, elapsedRoll / DICE_TOSS_SECONDS);
      // Arco de salto: sube y baja como una parábola (0 -> 1 -> 0).
      const arc = Math.sin(Math.min(1, tossT) * Math.PI);
      const bob = arc * DICE_TOSS_ARC_HEIGHT;
      group.current.position.set(position[0], position[1] + 1.18 + bob, position[2]);

      if (cube) {
        if (elapsedRoll < DICE_TOSS_SECONDS) {
          // Tumble determinístico en 2 ejes, con velocidad propia por tirada
          // (semilla del nonce) — nada de Math.random dentro de useFrame.
          const seedA = 6.5 + (rollSeedRef.current % 7) * 0.6;
          const seedB = 8.5 + ((rollSeedRef.current >> 3) % 7) * 0.5;
          cube.rotation.x = elapsedRoll * seedA;
          cube.rotation.z = elapsedRoll * seedB;
          cube.rotation.y += delta * 4.5;
          cube.scale.setScalar(1 + Math.sin(tossT * Math.PI) * 0.06);
        } else {
          // Fase de asentado con un pequeño rebote antes de quedar quieto.
          const settleT = Math.min(1, (elapsedRoll - DICE_TOSS_SECONDS) / DICE_SETTLE_SECONDS);
          const bounce = Math.sin(settleT * Math.PI) * (1 - settleT) * 0.12;
          cube.position.y = bounce;
          cube.quaternion.slerp(settledQuat, easeOut(settleT));
          cube.scale.setScalar(1 + (1 - settleT) * 0.04);
        }
      }
    } else {
      // Reposo: flota suavemente arriba del token, cara legible hacia arriba.
      const bob = Math.sin(state.clock.elapsedTime * 2.4) * 0.05;
      group.current.position.set(position[0], position[1] + 1.18 + bob, position[2]);
      if (cube) {
        cube.position.y = 0;
        cube.quaternion.slerp(settledQuat, frameLerp(delta, 9));
        cube.scale.setScalar(cube.scale.x + (1 - cube.scale.x) * frameLerp(delta, 10));
      }
    }
  });

  const rolling = cue.rolling;

  return (
    <group ref={group} position={[position[0], position[1] + 1.18, position[2]]}>
      <group ref={cubeRef}>
        {/* Main dice body */}
        <mesh castShadow>
          <boxGeometry args={[DICE_SIZE, DICE_SIZE, DICE_SIZE]} />
          <meshStandardMaterial
            color="#fffbf0"
            roughness={0.24}
            metalness={0.04}
            emissive="#fef9c3"
            emissiveIntensity={rolling ? 0.22 : 0.08}
          />
        </mesh>
        {/* Pips on all six faces (opposites sum to 7) */}
        <DicePips size={DICE_SIZE} />
      </group>
      {modifiedValue && <DiceModifiedValue value={rollValue} size={DICE_SIZE} />}

      {/* Glow ring below (does not rotate with the dice) */}
      <mesh position={[0, -(DICE_SIZE / 2 + 0.28), 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.38, 0.6, 32]} />
        <meshStandardMaterial
          color="#fde047"
          emissive="#f59e0b"
          emissiveIntensity={rolling ? 0.6 : 0.35}
          transparent
          opacity={rolling ? 0.65 : 0.42}
          side={DoubleSide}
        />
      </mesh>
      {/* Outer glow ring */}
      <mesh position={[0, -(DICE_SIZE / 2 + 0.29), 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.9, 32]} />
        <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.25} transparent opacity={0.18} side={DoubleSide} />
      </mesh>
    </group>
  );
}

function DiceModifiedValue({ value, size }: { value: number; size: number }) {
  const label = useMemo(() => formatDiceValue(value), [value]);
  const texture = useMemo(() => makeLabelTexture(label, "rgba(34, 27, 51, 0.95)", "#fde047"), [label]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={[0, size / 2 + 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size * 1.02, size * 0.46]} />
      <meshStandardMaterial map={texture} transparent roughness={0.32} metalness={0.02} emissive="#f59e0b" emissiveIntensity={0.12} />
    </mesh>
  );
}

function DicePips({ size }: { size: number }) {
  const h = size / 2 + 0.0015;
  const offset = size * 0.24;
  const pipR = size * 0.085;

  return (
    <group>
      {DICE_FACES.map((face) =>
        (DICE_PIP_LAYOUTS[face.value] ?? []).map(([u, v], index) => (
          <mesh key={`${face.value}-${index}`} position={face.toPosition(u * offset, v * offset, h)} rotation={face.rotation}>
            <circleGeometry args={[pipR, 16]} />
            <meshStandardMaterial color="#221b33" roughness={0.35} />
          </mesh>
        ))
      )}
    </group>
  );
}

function formatDiceValue(value: number): string {
  if (!Number.isFinite(value)) return "?";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
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

function trajectoryMidpoint(
  trajectory: { fromPlayerId: string; toPlayerId: string } | null,
  players: Player[],
  slotPositions: Map<number, Vec3>
): Vec3 | null {
  if (!trajectory) return null;
  const from = players.find((player) => player.id === trajectory.fromPlayerId);
  const to = players.find((player) => player.id === trajectory.toPlayerId);
  const fromSlot = from ? slotPositions.get(from.position) : undefined;
  const toSlot = to ? slotPositions.get(to.position) : undefined;
  if (!fromSlot || !toSlot) return null;
  return [
    roundLocal((fromSlot[0] + toSlot[0]) / 2),
    roundLocal((fromSlot[1] + toSlot[1]) / 2),
    roundLocal((fromSlot[2] + toSlot[2]) / 2),
  ];
}

function trajectoryPoints(
  trajectory: { fromPlayerId: string; toPlayerId: string } | null,
  players: Player[],
  occupancy: Map<number, Player[]>,
  slotPositions: Map<number, Vec3>
): { from: Vec3; to: Vec3 } | null {
  if (!trajectory) return null;
  const from = players.find((player) => player.id === trajectory.fromPlayerId);
  const to = players.find((player) => player.id === trajectory.toPlayerId);
  if (!from || !to) return null;
  return {
    from: playerTokenPosition(from, occupancy, slotPositions),
    to: playerTokenPosition(to, occupancy, slotPositions),
  };
}

function playerTokenPosition(player: Player, occupancy: Map<number, Player[]>, slotPositions: Map<number, Vec3>): Vec3 {
  const stack = occupancy.get(player.position) ?? [];
  const stackIndex = Math.max(0, stack.findIndex((candidate) => candidate.id === player.id));
  const stackTotal = stack.length || 1;
  return tokenWorldPosition(slotPositions.get(player.position) ?? [0, 0, 0], stackIndex, stackTotal);
}

function roundLocal(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Iniciales para la placa facial por defecto (1-2 letras, ej. "Juan Pérez" → "JP"). */
function playerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
