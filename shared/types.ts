// ============================================================================
// Contrato compartido entre server y clientes.
// El server es la fuente de verdad; los clientes espejan el GameState.
// ============================================================================

// ---------------------------------------------------------------------------
// Tablero / contenido
// ---------------------------------------------------------------------------

export const TILE_TYPES = [
  "start",
  "finish",
  "minigame",
  "trivia",
  "vote",
  "judge",
  "dare",
  "fate",
  "groom",
  "reaction",
  "estimate",
  "shop",
] as const;

export type TileType = (typeof TILE_TYPES)[number];

export interface TileLayout {
  /** coordenadas visuales de casillero; x/y son plano de tablero, z es altura opcional */
  x: number;
  y: number;
  z?: number;
  /** orientación visual opcional, en grados alrededor del eje vertical */
  rot?: number;
}

export interface Tile {
  id: number;
  type: TileType;
  /** id dentro del catálogo de minijuegos (para minigame/trivia/vote/judge/groom) */
  minigameId?: string;
  /** id dentro del catálogo de dares */
  dareId?: string;
  /** id dentro del catálogo de fates */
  fateId?: string;
  /** contrato visual: no afecta la mecánica del server */
  layout?: TileLayout;
  label?: string;
  /** reservado para eventos futuros que no entren en los catálogos actuales */
  eventKind?: "none" | "minigame" | "dare" | "fate" | "custom";
  eventId?: string;
  /** candidatos de eventos para este casillero; se elige el mejor para el jugador que cae */
  eventIds?: string[];
  /** ajustes narrativos/temáticos editables desde el map builder */
  storyParams?: Record<string, string>;
}

export type MapTerrain =
  | "stone"
  | "grass"
  | "sand"
  | "water"
  | "asphalt"
  | "magic";

export interface MapGridPoint {
  x: number;
  y: number;
}

export interface MapBorderEdge {
  id: string;
  from: MapGridPoint;
  to: MapGridPoint;
  terrain?: MapTerrain;
  label?: string;
}

export interface MapBoardShape {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  blockedCells?: MapGridPoint[];
  borderEdges?: MapBorderEdge[];
}

export type MapTerraceSurface = "grass" | "sand" | "water" | "stone" | "plaza";

/** Meseta de terreno: región rectangular elevada que forma el relieve del mapa. */
export interface MapTerrace {
  id: string;
  /** región en coordenadas de grilla (mismas unidades que TileLayout.x/y), bordes inclusive */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** altura del piso en unidades de mundo 3D (0 = nivel base); los casilleros la heredan según su x/y */
  elevation: number;
  surface?: MapTerraceSurface;
  /** pisa el color derivado de surface (ej. lomas rosas de la meta) */
  color?: string;
  label?: string;
}

export interface MapRoute {
  id: string;
  from: number;
  to: number;
  terrain: MapTerrain;
  /** texto mostrado al elegir una rama, ej. "Izquierda" */
  choiceLabel?: string;
  /** puntos intermedios para dibujar curvas/quiebres de la ruta */
  points?: TileLayout[];
  label?: string;
  bidirectional?: boolean;
}

export type MapPropKind =
  | "tree"
  | "house"
  | "court"
  | "vehicle"
  | "mountain"
  | "water"
  | "sign"
  | "plaza"
  | "decor"
  | "custom";

/** @deprecated Use MapPropKind; Artifact is reserved for gameplay items. */
export type MapArtifactKind = MapPropKind;

export type MapAssetFootprintShape = "rect" | "circle" | "ellipse" | "triangle";

export interface MapAssetFootprint {
  width: number;
  height: number;
  shape: MapAssetFootprintShape;
}

export interface MapAssetProjectionPoint {
  /** Three.js local +X axis, in model/world units before board grid spacing is applied. */
  x: number;
  /** Three.js local +Z axis, in model/world units before board grid spacing is applied. */
  z: number;
}

export interface MapAssetProjectionBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapAssetProjection {
  points?: MapAssetProjectionPoint[];
  bounds?: MapAssetProjectionBounds;
  shape?: MapAssetFootprintShape;
}

export interface MapAssetDef {
  id: string;
  name: string;
  kind: MapPropKind;
  defaultScale?: number;
  footprint?: MapAssetFootprint;
  projection?: MapAssetProjection;
  color?: string;
  tags?: string[];
}

export interface MapProp {
  id: string;
  assetId: string;
  label?: string;
  position: TileLayout;
  scale?: number;
  visible?: boolean;
  tint?: string;
  data?: Record<string, unknown>;
}

/** @deprecated Use MapProp; Artifact is reserved for gameplay items. */
export type MapArtifact = MapProp;

export interface MapTheme {
  base?: string;
  path?: string;
  accent?: string;
  sky?: string;
}

export interface MapDefinition {
  id: string;
  name: string;
  description?: string;
  board: Tile[];
  routes: MapRoute[];
  /** Legacy runtime field kept for existing content/import compatibility. Prefer mapProps in authored JSON. */
  artifacts: MapProp[];
  /** Canonical authored field for decorative board objects. */
  mapProps?: MapProp[];
  /** relieve: mesetas con elevación; sin terrazas el mapa es plano (nivel 0) */
  terraces?: MapTerrace[];
  boardShape?: MapBoardShape;
  theme?: MapTheme;
}

export interface RiggedConfig {
  /** jamás pueden salir primeros (van al fondo del ranking) */
  losers?: string[];
  /** siempre salen arriba */
  winners?: string[];
}

/** UI/resolution unit that an event can run. */
export type EventActivityType =
  | "prompt"
  | "hostPick"
  | "selfTap"
  | "vote"
  | "buzzer"
  | "judge"
  | "timing"
  | "reaction"
  | "estimate"
  | "whack"
  | "maze"
  | "flappy"
  | "snake"
  | "horserace"
  | "redlight";

/** Legacy name kept for existing minigame definitions and engines. */
export type MinigameType =
  | EventActivityType
  | "masher"
  | "memory"
  | "order"
  | "clicker";

export interface MinigameDef {
  type: MinigameType;
  /** variante visual / temática: "bostezo" | "lujan" | "default" | ... */
  skin?: string;
  /** preguntas, persona, prompts, etc. (forma depende del motor) */
  content: unknown;
  rigged?: RiggedConfig;
}

export interface DareDef {
  text: string;
}

export interface FateDef {
  text: string;
  /** casilleros a avanzar (+) o retroceder (-) */
  delta?: number;
  /** monedas a sumar (+) o restar (-) */
  coins?: number;
}

export type EventKind = "story" | "activity";
/** @deprecated Legacy prompt resolver; normalized into first-class activity types. */
export type EventResolutionMode = "none" | "hostPick" | "selfTap" | "vote";
export type EventParticipantMode = "everyone" | "landing" | "host";
export type EventConfirmationMode = "self" | "rest" | "everyone" | "host";

export type EventTriggerScope =
  | { type: "anyPlayer" }
  | { type: "player"; playerId: string };

export interface EventStory {
  title?: string;
  setup?: string;
  prompt?: string;
  reward?: string;
  reveal?: string;
}

export interface EventActivity {
  type: EventActivityType;
  skin?: string;
  content?: unknown;
  /** @deprecated Use activity.type: "hostPick" | "selfTap" | "vote" instead. */
  resolutionMode?: EventResolutionMode;
  participants?: EventParticipantMode;
  /** Optional subject set to rank independently from the players who submit input. */
  subjects?: EventParticipantMode;
  /** Confirmation rules for prompt/offline activities. Defaults to the rest of the group. */
  confirmation?: {
    mode?: EventConfirmationMode;
    playerIds?: string[];
  };
  rigged?: RiggedConfig;
}

export type TargetSelector =
  | "landing"
  | "acting"
  | "target"
  | "winner"
  | "loser"
  | "everyone"
  | { playerId: string }
  | { rank: number }
  | { rankFrom: number; rankTo: number }
  | { nearest: "ahead" | "behind"; from?: "landing" | "acting" | "target" | { playerId: string } };

export type EventActionTarget = TargetSelector;

export type OfflineActionKind = "takeShot" | "custom";

export type ConsequenceTiming = {
  hook?: EffectLifecycleHook;
  when?: EffectCondition;
  /** Attach this action to the selected user as a live effect instead of resolving it immediately. */
  duration?: EffectDuration;
  expiresOnTrigger?: boolean;
};

export type ConsequencePresentation = {
  icon?: string;
};

export type ConsequenceCore =
  | { type: "text"; text: string; target?: EventActionTarget }
  | { type: "coins"; value: number; target?: EventActionTarget; text?: string }
  | { type: "move"; delta: number; target?: EventActionTarget; text?: string }
  | { type: "moveTo"; tileId: number; target?: EventActionTarget; text?: string }
  | { type: "skipTurn"; target?: EventActionTarget; text?: string }
  | { type: "extraTurn"; target?: EventActionTarget; text?: string }
  | { type: "offlineAction"; action: OfflineActionKind; target?: EventActionTarget; text?: string; confirmation?: EventActivity["confirmation"] }
  | { type: "applyEffect"; effectId: string; target?: EventActionTarget; text?: string; duration?: EffectDuration }
  | { type: "halfMovement"; target?: EventActionTarget; text?: string; rounding?: "floor" | "ceil" | "round" }
  | { type: "movementMultiplier"; target?: EventActionTarget; text?: string; multiplier: number; rounding?: "floor" | "ceil" | "round" }
  | { type: "diceBias"; target?: EventActionTarget; text?: string; face: number; chanceDeltaPercent: number }
  | { type: "swapPositions"; target?: EventActionTarget; withTarget: EventActionTarget; text?: string }
  | { type: "moveToNearest"; target?: EventActionTarget; direction: "ahead" | "behind"; text?: string };

export type ConsequenceDef = ConsequenceCore & ConsequenceTiming & ConsequencePresentation;

export type EventAction = ConsequenceDef;

export interface EventOutcomeBranch {
  id?: string;
  label?: string;
  when: EventActionTarget;
  actions: EventAction[];
}

export interface GameEventDef {
  name: string;
  kind?: EventKind;
  tags?: string[];
  /** qué jugador puede disparar este evento; por defecto cualquiera */
  trigger?: EventTriggerScope;
  story?: EventStory;
  activity?: EventActivity;
  /** immediate actions for story-only events */
  actions?: EventAction[];
  /** actions applied after an activity resolves to a ranking */
  outcomes?: EventOutcomeBranch[];
}

export interface PlayerEventOverride {
  eventId?: string;
  tags?: string[];
  kind?: EventKind;
  activityType?: EventActivityType;
  story?: EventStory;
  activity?: Partial<EventActivity>;
  actions?: EventAction[];
  outcomes?: EventOutcomeBranch[];
}

export interface PlayerStoryBank {
  overrides: PlayerEventOverride[];
}

export interface PlayerDef {
  id: string;
  name: string;
  /** marca al novio para casilleros `groom` y guiños */
  groom?: boolean;
  color?: string;
}

export type ArtifactRarity = "common" | "epic" | "legendary";
export type CatalogRarity = ArtifactRarity | "uncommon" | "rare";
export type ArtifactTargetMode = "none" | "self" | "choosePlayer";
export type ArtifactUseFlow = "immediate" | "targeted";

export interface ArtifactRarityRates {
  common: number;
  epic: number;
  legendary: number;
}

export type EffectDuration =
  | { mode: "turns"; value: number }
  | { mode: "rounds"; value: number }
  | { mode: "uses"; value: number }
  | { mode: "untilTriggered" }
  | { mode: "game" };

export type EffectDurationState =
  | { mode: "turns"; remaining: number }
  | { mode: "rounds"; remaining: number }
  | { mode: "uses"; remaining: number }
  | { mode: "untilTriggered" }
  | { mode: "game" };

export type EffectLifecycleHook =
  | "beforeRoll"
  | "afterRoll"
  | "beforeMovement"
  | "afterMovement"
  | "onCellEnter"
  | "onActivityResult"
  | "onTurnEnd";

export type EffectCondition = {
  rollEquals?: number;
  phase?: Phase;
};

export type EffectModifier =
  | { type: "halfMovement"; hook?: Extract<EffectLifecycleHook, "beforeMovement">; rounding?: "floor" | "ceil" | "round" }
  | { type: "movementMultiplier"; hook?: Extract<EffectLifecycleHook, "beforeMovement">; multiplier: number; rounding?: "floor" | "ceil" | "round" }
  | { type: "diceBias"; hook?: Extract<EffectLifecycleHook, "beforeRoll">; face: number; chanceDeltaPercent: number }
  | { type: "skipTurn"; hook?: EffectLifecycleHook; text?: string }
  | { type: "extraTurn"; hook?: EffectLifecycleHook; text?: string }
  | { type: "coins"; hook?: EffectLifecycleHook; value: number; text?: string }
  | { type: "move"; hook?: EffectLifecycleHook; delta: number; text?: string }
  | { type: "moveTo"; hook?: EffectLifecycleHook; tileId: number; text?: string }
  | { type: "swapPositions"; hook?: EffectLifecycleHook; target: EventActionTarget; text?: string }
  | { type: "moveToNearest"; hook?: EffectLifecycleHook; direction: "ahead" | "behind"; text?: string }
  | {
      type: "conditionalConsequences";
      hook?: EffectLifecycleHook;
      when?: EffectCondition;
      consequences: EventAction[];
      expiresOnTrigger?: boolean;
    };

export interface FaceAnchor {
  x: number;
  y: number;
  z?: number;
  angle?: number;
}

export interface FacePhotoAlignment {
  x: number;
  y: number;
  scale: number;
  angle?: number;
}

export interface CharacterLoadout {
  cosmeticIds?: string[];
}

export interface CharacterDef {
  id: string;
  /** Canonical authored name shown to players. */
  displayName: string;
  /** Legacy/import alias normalized into displayName. */
  name?: string;
  color?: string;
  groom?: boolean;
  facePhoto?: string;
  facePhotoAlignment?: FacePhotoAlignment;
  faceAnchors?: Record<string, FaceAnchor>;
  bodyAnchors?: Record<string, FaceAnchor>;
  defaultLoadout?: CharacterLoadout;
  /** Legacy/import alias normalized into defaultLoadout.cosmeticIds. */
  defaultCosmetics?: string[];
  defaultTraits?: string[];
}

export interface CharacterSlot {
  id: string;
  displayName: string;
  color: string;
  groom: boolean;
  facePhoto?: string;
  facePhotoAlignment?: FacePhotoAlignment;
  faceAnchors?: Record<string, FaceAnchor>;
  bodyAnchors?: Record<string, FaceAnchor>;
  defaultLoadout?: CharacterLoadout;
  claimedByPlayerId?: string;
  connected?: boolean;
}

export type CosmeticAnchorType = "face" | "body" | "token";
export type CosmeticAssetKind =
  | "goggles"
  | "mustache"
  | "hat"
  | "beard"
  | "piercing"
  | "tattoo"
  | "badge"
  | "custom";

export interface CosmeticAsset {
  kind: CosmeticAssetKind | string;
  color?: string;
  secondaryColor?: string;
  src?: string;
  label?: string;
}

export interface CosmeticAnchorRef {
  anchorType: CosmeticAnchorType;
  anchorId: string;
  label?: string;
}

export interface CosmeticTransform {
  /** local offset in token/world preview units after anchor placement */
  x?: number;
  y?: number;
  z?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  /** rotation around the cosmetic's facing plane, in degrees */
  rotation?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
}

export interface CosmeticCompatibility {
  characterIds?: string[];
  excludeCharacterIds?: string[];
  tags?: string[];
}

export interface CosmeticPreviewMeta {
  color?: string;
  secondaryColor?: string;
  label?: string;
  order?: number;
}

export interface CosmeticDef {
  id: string;
  name: string;
  description?: string;
  price: number;
  asset: CosmeticAsset | string;
  /** Ordered anchor placements. The first anchor is mirrored to anchorType/anchorId for older imports. */
  anchors?: CosmeticAnchorRef[];
  anchorType: CosmeticAnchorType;
  anchorId: string;
  transform?: CosmeticTransform;
  compatibility?: CosmeticCompatibility;
  preview?: CosmeticPreviewMeta;
  tags?: string[];
  /** Legacy/import alias normalized into asset. */
  assetId?: string;
  /** Legacy/import alias normalized into anchorId. */
  anchor?: string;
}

export interface EffectDef {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  duration: EffectDuration;
  hooks?: EffectLifecycleHook[];
  consequences?: EventAction[];
  /** @deprecated Use consequences. */
  modifiers?: EffectModifier[];
  /** @deprecated Use consequences. */
  actions?: EventAction[];
  visualAssetId?: string;
}

export interface ArtifactDef {
  id: string;
  name: string;
  description?: string;
  price: number;
  rarity: ArtifactRarity;
  targetMode: ArtifactTargetMode;
  useFlow?: ArtifactUseFlow;
  target?: EventActionTarget;
  consequences?: EventAction[];
  effects?: string[];
  visual?: {
    assetId?: string;
    anchorType?: CosmeticAnchorType;
    anchorId?: string;
    label?: string;
    color?: string;
  };
  animations?: {
    outgoing?: string;
    incoming?: string;
  };
  weightOverrides?: {
    shop?: number;
  };
  /** Legacy/import alias for visual.assetId. */
  visualAssetId?: string;
  /** Legacy/import alias for weightOverrides.shop. */
  shopWeight?: number;
}

export interface ArtifactOffer {
  id: string;
  artifactId: string;
  price: number;
  rarity: ArtifactRarity;
}

export interface ArtifactShopState {
  visitId: string;
  playerId: string;
  tileId: number;
  offers: ArtifactOffer[];
  rolled: boolean;
  purchasedOfferId?: string;
}

export interface PendingArtifactUse {
  playerId: string;
  artifactId: string;
  offerId?: string;
  targetMode: ArtifactTargetMode;
  validTargetIds: string[];
}

export interface GameContent {
  board: Tile[];
  activeMapId?: string;
  maps?: MapDefinition[];
  assetCatalog?: MapAssetDef[];
  events?: Record<string, GameEventDef>;
  playerStories?: Record<string, PlayerStoryBank>;
  characters?: Record<string, CharacterDef>;
  cosmetics?: Record<string, CosmeticDef>;
  /** Legacy/import alias normalized into cosmetics. */
  characterCosmetics?: unknown[];
  artifactRarityRates?: ArtifactRarityRates;
  artifacts?: Record<string, ArtifactDef>;
  effects?: Record<string, EffectDef>;
  minigames: Record<string, MinigameDef>;
  dares: Record<string, DareDef>;
  fates: Record<string, FateDef>;
  players: PlayerDef[];
  /** monedas por puesto del ranking, de 1ro a último (se reparte por defecto) */
  coinPayout?: number[];
}

// ---------------------------------------------------------------------------
// Estado de juego (autoritativo en server, espejado en clientes)
// ---------------------------------------------------------------------------

export interface Player {
  id: string;
  characterId?: string;
  name: string;
  socketId: string | null; // null = desconectado
  connected: boolean;
  position: number;
  coins: number;
  isHost: boolean;
  groom: boolean;
  color: string;
  facePhoto?: string;
  facePhotoAlignment?: FacePhotoAlignment;
  faceAnchors?: Record<string, FaceAnchor>;
  bodyAnchors?: Record<string, FaceAnchor>;
  ownedCosmeticIds?: string[];
  cosmeticIds?: string[];
}

export interface EffectInstance {
  id: string;
  effectId: string;
  name: string;
  description?: string;
  sourcePlayerId?: string;
  targetPlayerId: string;
  remaining: EffectDurationState;
  hooks: EffectLifecycleHook[];
  consequences: EventAction[];
  icon?: string;
  visualAssetId?: string;
  startedRound: number;
  startedTurnId?: string;
}

export type Phase =
  | "lobby"
  | "turn" // esperando que el jugador activo tire
  | "moving" // animación de movimiento
  | "shop" // jugador activo cayó en tienda y resuelve compra/uso de artifact
  | "event" // resolviendo un casillero no-minijuego (dare/fate)
  | "minigame" // minijuego en curso (clientes jugando local)
  | "reveal" // mostrando resultados
  | "finished";

export interface ActiveMinigame {
  /** event id or legacy minigame id */
  id: string;
  eventId?: string;
  protagonistId?: string;
  type: EventActivityType;
  skin?: string;
  content: unknown;
  story?: EventStory;
  /** jugadores que deben submittear resultado (ids) */
  participants: string[];
  /** jugadores que se rankean para outcomes; por defecto coincide con participants */
  subjects?: string[];
  /** ids que ya enviaron resultado */
  submitted: string[];
  judge?: {
    phase: "writing" | "voting";
    submissions?: { id: string; text: string }[];
  };
}

export interface ActiveEvent {
  id?: string;
  kind: EventKind | "dare" | "fate";
  title?: string;
  text: string;
  story?: EventStory;
  playerId: string;
  actions?: AppliedEventAction[];
  artifactUse?: {
    artifactId: string;
    artifactName: string;
    sourcePlayerId: string;
    targetPlayerId?: string | null;
    targetMode: ArtifactTargetMode;
  };
}

export interface GameState {
  code: string;
  /** nombre legible de la sala, elegido por el host al crearla */
  roomName: string;
  phase: Phase;
  characterSlots?: CharacterSlot[];
  mapId?: string;
  mapName?: string | null;
  /** layout del tablero (tipos/labels); el contenido sensible no viaja */
  board: Tile[];
  routes?: MapRoute[];
  /** Legacy decorative map props. Gameplay artifacts are exposed via artifactCatalog. */
  artifacts?: MapArtifact[];
  assetCatalog?: MapAssetDef[];
  cosmetics?: Record<string, CosmeticDef>;
  artifactCatalog?: Record<string, ArtifactDef>;
  artifactRarityRates?: ArtifactRarityRates;
  artifactShop: ArtifactShopState | null;
  pendingArtifactUse: PendingArtifactUse | null;
  boardShape?: MapBoardShape;
  terraces?: MapTerrace[];
  players: Player[];
  /** orden de turnos por id */
  turnOrder: string[];
  /** índice dentro de turnOrder del jugador activo */
  activeIndex: number;
  round: number;
  boardLength: number;
  /** physical die face before roll modifiers; null when no roll is active */
  lastBaseRoll: number | null;
  /** effective movement roll after active roll modifiers */
  lastRoll: number | null;
  /** cells actually moved this roll; can be shorter than lastRoll when stopped by an interrupting tile */
  lastMovement?: number | null;
  activeMinigame: ActiveMinigame | null;
  activeEvent: ActiveEvent | null;
  reveal: RevealPayload | null;
  winnerId: string | null;
  effects?: Record<string, EffectDef>;
  activeEffects: EffectInstance[];
}

// ---------------------------------------------------------------------------
// Resultados de minijuego
// ---------------------------------------------------------------------------

export interface MinigameResult {
  playerId: string;
  score: number;
  outcome?: "win" | "loss";
  /** "qué hizo": mensaje, tiempo, secuencia, aciertos, etc. */
  payload: unknown;
}

export interface AppliedEventAction {
  type: EventAction["type"];
  targetPlayerIds: string[];
  text: string;
  value?: number;
  tileId?: number;
  effectId?: string;
  effectInstanceIds?: string[];
  offlineAction?: OfflineActionKind;
  requiresConfirmation?: boolean;
}

export interface RevealEntry {
  playerId: string;
  name: string;
  rank: number; // 1 = primero
  score: number;
  coins: number;
  payload: unknown;
  /** Primary standardized result shown beside the player name. */
  resultLabel?: string;
  /** Secondary standardized detail derived from payload/content. */
  detailLabel?: string;
  /** texto extra para la pantalla de reveal (ej. respuesta de Luján) */
  flavor?: string;
}

export interface RevealPayload {
  minigameId: string;
  eventId?: string;
  type: EventActivityType;
  skin?: string;
  title: string;
  story?: EventStory;
  ranking: string[]; // ids de 1ro a último (rig ya aplicado)
  entries: RevealEntry[];
  coins: Record<string, number>;
  actions?: AppliedEventAction[];
}

// ---------------------------------------------------------------------------
// Listado público de salas (para la pantalla de "unirme")
// ---------------------------------------------------------------------------

export interface RoomSummary {
  code: string;
  name: string;
  phase: Phase;
  mapId?: string;
  mapName?: string | null;
  characterSlots?: CharacterSlot[];
  /** cantidad de jugadores conectados ahora */
  players: number;
  /** cupo máximo definido por el contenido (content.players.length) */
  maxPlayers: number;
  /** nombre del host (o primer jugador) */
  host: string | null;
}

export interface ContentMapSummary {
  id: string;
  name: string;
  description?: string;
  cells: number;
  routes: number;
  props: number;
  terraces: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Contrato de eventos Socket.io
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  "room:join": (
    payload: { code: string; name?: string; characterId?: string },
    ack: (res: { ok: true; playerId: string; code: string } | { ok: false; error: string }) => void
  ) => void;
  "room:create": (
    payload: { name?: string; roomName: string; characterId?: string; mapId?: string },
    ack: (res: { ok: true; playerId: string; code: string } | { ok: false; error: string }) => void
  ) => void;
  /** El jugador abandona la sala voluntariamente. */
  "room:leave": () => void;
  "game:start": () => void;
  "turn:roll": () => void;
  "turn:next": () => void;
  "minigame:action": (payload: unknown) => void;
  "minigame:result": (payload: { score: number; payload: unknown; outcome?: "win" | "loss" }) => void;
  "cosmetic:buy": (
    payload: { cosmeticId: string },
    ack: (res: { ok: true } | { ok: false; error: string }) => void
  ) => void;
  "cosmetic:equip": (
    payload: { cosmeticId: string; equipped: boolean },
    ack: (res: { ok: true } | { ok: false; error: string }) => void
  ) => void;
  "artifact:rollShop": (
    payload: Record<string, never>,
    ack: (res: { ok: true; offers: ArtifactOffer[] } | { ok: false; error: string }) => void
  ) => void;
  "artifact:buy": (
    payload: { offerId: string },
    ack: (res: { ok: true; artifactId: string; requiresTarget: boolean } | { ok: false; error: string }) => void
  ) => void;
  "artifact:use": (
    payload: { targetPlayerId?: string },
    ack: (res: { ok: true } | { ok: false; error: string }) => void
  ) => void;
  "artifact:skipShop": (
    payload: Record<string, never>,
    ack: (res: { ok: true } | { ok: false; error: string }) => void
  ) => void;
  /** host fuerza el cierre del minijuego si alguien se colgó */
  "minigame:force": () => void;
  /** Development-only host tool: attach a catalog effect to a player for simulation/debugging. */
  "debug:applyEffect": (payload: { playerId: string; effectId: string; effect?: EffectDef }) => void;
  "reveal:next": () => void;
}

export interface ServerToClientEvents {
  state: (state: GameState) => void;
  "room:closed": (payload: { message: string }) => void;
  "effect:ended": (payload: { effectInstance: EffectInstance; reason: "expired" | "triggered" }) => void;
  "minigame:start": (payload: {
    id: string;
    type: EventActivityType;
    skin?: string;
    content: unknown;
    participants: string[];
  }) => void;
  "minigame:action": (payload: { playerId: string; data: unknown }) => void;
  "minigame:reveal": (payload: RevealPayload) => void;
  error: (payload: { message: string }) => void;
}
