// ============================================================================
// Contrato compartido entre server y clientes.
// El server es la fuente de verdad; los clientes espejan el GameState.
// ============================================================================

// ---------------------------------------------------------------------------
// Tablero / contenido
// ---------------------------------------------------------------------------

export type TileType =
  | "start"
  | "finish"
  | "minigame"
  | "trivia"
  | "vote"
  | "judge"
  | "dare"
  | "fate"
  | "groom"
  | "star"
  | "reaction"
  | "estimate";

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
  /** id dentro del catálogo de minijuegos (para minigame/trivia/vote/judge/groom/star) */
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
}

export type MapTerrain =
  | "stone"
  | "grass"
  | "sand"
  | "water"
  | "asphalt"
  | "magic";

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

export type MapArtifactKind =
  | "tree"
  | "house"
  | "court"
  | "vehicle"
  | "mountain"
  | "water"
  | "sign"
  | "plaza"
  | "custom";

export interface MapAssetDef {
  id: string;
  name: string;
  kind: MapArtifactKind;
  defaultScale?: number;
  color?: string;
  tags?: string[];
}

export interface MapArtifact {
  id: string;
  assetId: string;
  label?: string;
  position: TileLayout;
  scale?: number;
  visible?: boolean;
  tint?: string;
  data?: Record<string, unknown>;
}

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
  artifacts: MapArtifact[];
  theme?: MapTheme;
}

export interface RiggedConfig {
  /** jamás pueden salir primeros (van al fondo del ranking) */
  losers?: string[];
  /** siempre salen arriba */
  winners?: string[];
}

/** Motor de minijuego: define cómo se juega y cómo se resuelve. */
export type MinigameType =
  | "vote"
  | "buzzer"
  | "judge"
  | "timing"
  | "reaction"
  | "masher"
  | "estimate"
  | "memory"
  | "order"
  | "whack"
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

export interface PlayerDef {
  id: string;
  name: string;
  /** marca al novio para casilleros `groom` y guiños */
  groom?: boolean;
  color?: string;
}

export interface GameContent {
  board: Tile[];
  activeMapId?: string;
  maps?: MapDefinition[];
  assetCatalog?: MapAssetDef[];
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
  name: string;
  socketId: string | null; // null = desconectado
  connected: boolean;
  position: number;
  coins: number;
  stars: number;
  isHost: boolean;
  groom: boolean;
  color: string;
}

export type Phase =
  | "lobby"
  | "turn" // esperando que el jugador activo tire
  | "moving" // animación de movimiento
  | "event" // resolviendo un casillero no-minijuego (dare/fate)
  | "minigame" // minijuego en curso (clientes jugando local)
  | "reveal" // mostrando resultados
  | "finished";

export interface ActiveMinigame {
  /** id del catálogo */
  id: string;
  type: MinigameType;
  skin?: string;
  content: unknown;
  /** jugadores que deben participar (ids) */
  participants: string[];
  /** ids que ya enviaron resultado */
  submitted: string[];
}

export interface ActiveEvent {
  kind: "dare" | "fate";
  text: string;
  playerId: string;
}

export interface GameState {
  code: string;
  phase: Phase;
  mapId?: string;
  /** layout del tablero (tipos/labels); el contenido sensible no viaja */
  board: Tile[];
  routes?: MapRoute[];
  artifacts?: MapArtifact[];
  players: Player[];
  /** orden de turnos por id */
  turnOrder: string[];
  /** índice dentro de turnOrder del jugador activo */
  activeIndex: number;
  round: number;
  boardLength: number;
  lastRoll: number | null;
  activeMinigame: ActiveMinigame | null;
  activeEvent: ActiveEvent | null;
  reveal: RevealPayload | null;
  winnerId: string | null;
}

// ---------------------------------------------------------------------------
// Resultados de minijuego
// ---------------------------------------------------------------------------

export interface MinigameResult {
  playerId: string;
  score: number;
  /** "qué hizo": mensaje, tiempo, secuencia, aciertos, etc. */
  payload: unknown;
}

export interface RevealEntry {
  playerId: string;
  name: string;
  rank: number; // 1 = primero
  score: number;
  coins: number;
  payload: unknown;
  /** texto extra para la pantalla de reveal (ej. respuesta de Luján) */
  flavor?: string;
}

export interface RevealPayload {
  minigameId: string;
  type: MinigameType;
  skin?: string;
  title: string;
  ranking: string[]; // ids de 1ro a último (rig ya aplicado)
  entries: RevealEntry[];
  coins: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Contrato de eventos Socket.io
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  "room:join": (
    payload: { code: string; name: string },
    ack: (res: { ok: true; playerId: string; code: string } | { ok: false; error: string }) => void
  ) => void;
  "room:create": (
    payload: { name: string },
    ack: (res: { ok: true; playerId: string; code: string } | { ok: false; error: string }) => void
  ) => void;
  "game:start": () => void;
  "turn:roll": () => void;
  "turn:next": () => void;
  "minigame:action": (payload: unknown) => void;
  "minigame:result": (payload: { score: number; payload: unknown }) => void;
  /** host fuerza el cierre del minijuego si alguien se colgó */
  "minigame:force": () => void;
  "reveal:next": () => void;
}

export interface ServerToClientEvents {
  state: (state: GameState) => void;
  "minigame:start": (payload: {
    id: string;
    type: MinigameType;
    skin?: string;
    content: unknown;
    participants: string[];
  }) => void;
  "minigame:action": (payload: { playerId: string; data: unknown }) => void;
  "minigame:reveal": (payload: RevealPayload) => void;
  error: (payload: { message: string }) => void;
}
