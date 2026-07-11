import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { GameContent, GameState, Tile } from "@essence/shared";
import { ChevronDown, Dice5, LogOut, MapPin, RotateCcw, Users } from "lucide-react";
import { useGame } from "../useGame";
import ConnectedGame from "./ConnectedGame";

interface MapPlaytestProps {
  content: GameContent;
  mapId: string;
  onClose: () => void;
}

type DirectorAction = "player" | "roll" | "land" | "restart" | null;

export default function MapPlaytest({ content, mapId, onClose }: MapPlaytestProps) {
  const {
    connected,
    state,
    me,
    activeId,
    isHost,
    error,
    effectNotices,
    dismissEffectNotice,
    actions,
  } = useGame({ autoReconnect: false });
  const {
    startPlaytest,
    selectPlaytestPlayer,
    rollPlaytest,
    landPlaytest,
    stopPlaytest,
  } = actions;
  const contentRef = useRef(content);
  const mapIdRef = useRef(mapId);
  const closingRef = useRef(false);
  const [directorAction, setDirectorAction] = useState<DirectorAction>("restart");
  const [directorMessage, setDirectorMessage] = useState("Loading authored players…");

  const launch = useCallback(() => {
    setDirectorAction("restart");
    setDirectorMessage("Loading authored players…");
    startPlaytest(contentRef.current, mapIdRef.current, (result) => {
      setDirectorAction(null);
      setDirectorMessage(result.ok ? "Playtest ready. Choose a player or a test action." : result.error);
    });
  }, [startPlaytest]);

  useEffect(() => {
    launch();
    return () => {
      if (!closingRef.current) stopPlaytest();
    };
  }, [launch, stopPlaytest]);

  const closePlaytest = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    stopPlaytest(onClose);
  }, [onClose, stopPlaytest]);

  if (!state || !me) {
    return (
      <main className="fixed inset-0 z-50 flex items-center justify-center bg-[#0e0a1a] p-4 text-[#fff8d6]">
        <section className="w-[min(32rem,100%)] overflow-hidden rounded-sm border border-[#f5d547]/40 bg-[#161126] shadow-[0_24px_80px_rgb(0_0_0/0.65)]">
          <div className="h-2 bg-[repeating-linear-gradient(135deg,#f5d547_0_12px,#201507_12px_24px)]" />
          <div className="p-5">
            <p className="retro text-[9px] uppercase tracking-[0.22em] text-[#67e8f9]">Map playtest</p>
            <h1 className="mt-2 text-2xl font-black">Preparing the real game…</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-[#d4cfea]">{error ?? directorMessage}</p>
            <div className="mt-5 flex gap-2">
              {error && (
                <button type="button" onClick={launch} className="director-primary-button">
                  <RotateCcw className="size-4" /> Retry
                </button>
              )}
              <button type="button" onClick={closePlaytest} className="director-secondary-button">
                <LogOut className="size-4" /> Back to builder
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const playtestActions = { ...actions, leave: closePlaytest };

  return (
    <div className="fixed inset-0 z-50 min-h-dvh overflow-hidden bg-[#08060f]">
      <ConnectedGame
        connected={connected}
        state={state}
        me={me}
        activeId={activeId}
        isHost={isHost}
        effectNotices={effectNotices}
        onDismissEffectNotice={dismissEffectNotice}
        actions={playtestActions}
        overlay={
          <PlaytestDirector
          state={state}
          meId={me.id}
          error={error}
          busy={directorAction}
          message={directorMessage}
          onSelectPlayer={(playerId) => {
            setDirectorAction("player");
            selectPlaytestPlayer(playerId, (result) => {
              setDirectorAction(null);
              setDirectorMessage(result.ok ? `Now controlling ${state.players.find((player) => player.id === result.playerId)?.name ?? result.playerId}.` : result.error);
            });
          }}
          onRoll={(value) => {
            setDirectorAction("roll");
            rollPlaytest(value, (result) => {
              setDirectorAction(null);
              setDirectorMessage(result.ok ? `Forced a ${value}. Real movement and landing rules are running.` : result.error);
            });
          }}
          onLand={(tileId) => {
            setDirectorAction("land");
            landPlaytest(tileId, (result) => {
              setDirectorAction(null);
              setDirectorMessage(result.ok ? `Landed directly on cell ${tileId}.` : result.error);
            });
          }}
          onRestart={launch}
          onClose={closePlaytest}
          />
        }
      />
    </div>
  );
}

function PlaytestDirector({
  state,
  meId,
  error,
  busy,
  message,
  onSelectPlayer,
  onRoll,
  onLand,
  onRestart,
  onClose,
}: {
  state: GameState;
  meId: string;
  error: string | null;
  busy: DirectorAction;
  message: string;
  onSelectPlayer: (playerId: string) => void;
  onRoll: (value: number) => void;
  onLand: (tileId: number) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [rollValue, setRollValue] = useState("10");
  const [cellId, setCellId] = useState(() => state.board[0]?.id ?? 0);
  const selectedPlayer = state.players.find((player) => player.id === meId);
  const activePlayerId = state.turnOrder[state.activeIndex];
  const activePlayer = state.players.find((player) => player.id === activePlayerId);
  const selectedCell = state.board.find((tile) => tile.id === cellId);
  const phaseLabel = state.phase === "minigame" ? "activity" : state.phase;

  useEffect(() => {
    if (state.board.some((tile) => tile.id === cellId)) return;
    setCellId(state.board[0]?.id ?? 0);
  }, [cellId, state.board]);

  const submitRoll = (event: FormEvent) => {
    event.preventDefault();
    const value = Math.round(Number(rollValue));
    if (!Number.isFinite(value) || value < 1) return;
    onRoll(value);
  };

  const submitLanding = (event: FormEvent) => {
    event.preventDefault();
    if (selectedCell) onLand(selectedCell.id);
  };

  return (
    <aside className="pointer-events-none fixed inset-x-2 bottom-2 z-[70] sm:inset-x-auto sm:bottom-5 sm:left-5 sm:w-[25rem]">
      <section
        data-testid="playtest-director"
        className="pointer-events-auto overflow-hidden rounded-sm border border-[#fff4bf]/45 bg-[#0e0a1a]/96 text-[#fff8d6] shadow-[0_0_0_1px_rgba(245,213,71,0.1),0_24px_70px_rgb(0_0_0/0.68)] backdrop-blur-xl"
      >
        <div className="h-2 bg-[repeating-linear-gradient(135deg,#f5d547_0_12px,#201507_12px_24px)]" />
        <header className="flex items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="playtest-director-controls"
            onClick={() => setOpen((current) => !current)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#67e8f9]"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-[#67e8f9]/35 bg-[#67e8f9]/12 text-[#a5f3fc]">
              <Users className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="retro block text-[8px] uppercase tracking-[0.2em] text-[#67e8f9]">Playtest director</span>
              <span className="mt-1 block truncate text-xs font-black text-[#fff4bf]">
                {selectedPlayer?.name ?? "Player"} · {phaseLabel} · active: {activePlayer?.name ?? "—"}
              </span>
            </span>
            <ChevronDown className={`ml-auto size-4 shrink-0 text-[#d4cfea] transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          <button type="button" onClick={onClose} aria-label="Exit playtest" title="Exit playtest" className="director-icon-button">
            <LogOut className="size-4" />
          </button>
        </header>

        {open && (
          <div id="playtest-director-controls" className="border-t border-white/10 px-3 pb-3 pt-2.5">
            <label className="director-field-label">
              Play as
              <select
                value={meId}
                disabled={busy !== null}
                onChange={(event) => onSelectPlayer(event.target.value)}
                data-testid="playtest-player-select"
                className="director-input mt-1"
              >
                {state.players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} · cell {player.position} · {player.coins} coins
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-2 grid grid-cols-[minmax(0,0.8fr)_auto] gap-2">
              <form onSubmit={submitRoll} className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                <label className="director-field-label">
                  Force die
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={rollValue}
                    disabled={busy !== null}
                    onChange={(event) => setRollValue(event.target.value)}
                    data-testid="playtest-roll-input"
                    className="director-input mt-1 tabular-nums"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy !== null || !validRollValue(rollValue)}
                  className="director-primary-button mt-[1.1rem]"
                  data-testid="playtest-roll-button"
                >
                  <Dice5 className="size-4" /> {busy === "roll" ? "Rolling…" : "Roll"}
                </button>
              </form>
              <button type="button" onClick={onRestart} disabled={busy !== null} title="Restart playtest" className="director-icon-button mt-[1.1rem] size-10">
                <RotateCcw className={`size-4 ${busy === "restart" ? "animate-spin" : ""}`} />
              </button>
            </div>
            <p className="mt-1 text-[9px] font-bold leading-4 text-[#a89fc5]">The die can show any positive number. Authored effects can still modify movement.</p>

            <form onSubmit={submitLanding} className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
              <label className="director-field-label">
                Land directly on
                <select
                  value={cellId}
                  disabled={busy !== null}
                  onChange={(event) => setCellId(Number(event.target.value))}
                  data-testid="playtest-cell-select"
                  className="director-input mt-1"
                >
                  {state.board.map((tile) => (
                    <option key={tile.id} value={tile.id}>
                      {tileOptionLabel(tile)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy !== null || !selectedCell} className="director-primary-button mt-[1.1rem]" data-testid="playtest-land-button">
                <MapPin className="size-4" /> {busy === "land" ? "Landing…" : "Land"}
              </button>
            </form>

            <p aria-live="polite" className={`mt-2 min-h-8 rounded-sm border px-2 py-1.5 text-[10px] font-bold leading-4 ${error ? "border-rose-300/30 bg-rose-500/12 text-rose-100" : "border-[#67e8f9]/20 bg-[#67e8f9]/8 text-[#cffafe]"}`}>
              {error ?? message}
            </p>
          </div>
        )}
      </section>
    </aside>
  );
}

function validRollValue(value: string): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1;
}

function tileOptionLabel(tile: Tile): string {
  const name = tile.label?.trim() || tile.type;
  const eventCount = tile.eventIds?.length ?? (tile.eventId ? 1 : 0);
  return `#${tile.id} · ${name}${eventCount ? ` · ${eventCount} event${eventCount === 1 ? "" : "s"}` : ""}`;
}
