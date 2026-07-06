import type { ActiveMinigame, Player } from "@essence/shared";

export interface MinigameProps {
  content: any;
  players: Player[];
  participants?: Player[];
  subjects?: Player[];
  activeMinigame?: ActiveMinigame;
  me: Player;
  /** termina el minijuego local y reporta el resultado al server */
  onFinish: (score: number, payload: unknown, outcome?: "win" | "loss") => void;
  /** acción en vivo opcional (ej. buzzer apretado) */
  onAction?: (data: unknown) => void;
  /** ya envié mi resultado; los motores realtime muestran modo espectador */
  spectator?: boolean;
}
