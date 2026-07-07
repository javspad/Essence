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
  TorusGeometry,
  Vector3,
  type Group,
  type Mesh,
  type PointLight,
  type Texture,
} from "three";
import type { CosmeticDef, FaceAnchor, FacePhotoAlignment, MapArtifact, MapAssetDef, MapBoardShape, MapGridPoint, MapRoute, MapTerrace, Player, Tile } from "@essence/shared";
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
  focusedPlayerId?: FocusedPlayerId;
  onPlayerFocus?: (playerId: string) => void;
}

export default function Board3DShell({
  tiles,
  players = [],
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
  focusedPlayerId = null,
  onPlayerFocus,
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
  // La cámara sigue al foco elegido; sin foco, sigue al que se está moviendo (evento incluido), no solo al del turno.
  const trackedId = cameraMode === "followActivePlayer" ? focusedPlayer?.id ?? activeMotion?.playerId ?? activeId : activeMotion?.playerId ?? activeId;
  const trackedPlayer = trackedId ? players.find((player) => player.id === trackedId) : undefined;
  const trackedSlot = slotPositions.get(trackedPlayer?.position ?? activePlayer?.position ?? 0) ?? activeSlot;
  // Posición viva del muñeco animado: el token la escribe cada frame, la cámara la lee.
  const trackedTokenRef = useRef<Vector3 | null>(null);
  const overviewShot = useMemo(() => boardCameraOverviewShot(bounds, terraces), [bounds, terraces]);
  const activePath = new Set(
    activeMotion && activeMotion.playerId === activeId
      ? activeMotion.path
      : movementPath(activePlayer?.position ?? -1, lastRoll, boardLength)
  );
  const occupancy = useMemo(() => playersByPosition(players), [players]);
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
        <CinematicCamera
          mode={cameraMode}
          target={trackedSlot}
          tokenRef={trackedTokenRef}
          motion={motion}
          walking={activeMotion !== null}
          dice={Boolean(diceCue)}
          turnKey={activeId ?? ""}
          overview={overviewShot}
        />
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
            onSelect={onPlayerFocus}
            trackRef={player.id === trackedId ? trackedTokenRef : undefined}
          />
        ))}

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

  const anchor = transformedAnchor(cosmetic, faceAnchors, bodyAnchors, { z: 0.04 });
  return (
    <group position={anchor} rotation={[0, 0, rotation]} scale={scale}>
      <mesh geometry={TOKEN_TATTOO_GEOMETRY} dispose={null}>
        <meshBasicMaterial color={primary} transparent opacity={opacity * 0.9} side={DoubleSide} toneMapped={false} />
      </mesh>
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
  onSelect,
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
  onSelect?: (playerId: string) => void;
  /** la cámara lee de acá la posición viva del muñeco seguido */
  trackRef?: { current: Vector3 | null };
}) {
  const { gl } = useThree();
  const group = useRef<Group | null>(null);
  const markerRef = useRef<Mesh | null>(null);
  const segment = useRef(0);
  const progress = useRef(0);
  const selectPlayer = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (!onSelect) return;
      event.stopPropagation();
      onSelect(player.id);
    },
    [onSelect, player.id]
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
  });

  const opacity = player.connected ? 1 : 0.45;

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
      {/* Floating turn marker */}
      {active && (
        <mesh ref={markerRef} position={[0, 0.94, 0]} geometry={TOKEN_MARKER_GEOMETRY} dispose={null}>
          <meshStandardMaterial color="#fde047" emissive="#f59e0b" emissiveIntensity={0.85} roughness={0.25} />
        </mesh>
      )}
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
  const value = Math.max(1, Math.min(6, rollValue));
  const modifiedValue = rollValue !== value;
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

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Iniciales para la placa facial por defecto (1-2 letras, ej. "Juan Pérez" → "JP"). */
function playerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
