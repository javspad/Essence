import type { CoinTransaction, ContentMediaAssetDef, GameState, RevealPayload } from "@essence/shared";
import { Button } from "@/components/ui/8bit/button";
import { cn } from "@/lib/utils";
import { revealEntryDetail, revealEntryResult } from "../revealDisplay";
import ActivityMediaStrip, { mediaForPlacement } from "./ActivityMedia";

interface Props {
  state: GameState;
  canAdvance: boolean;
  onNext: () => void;
}

const MEDAL = ["🥇", "🥈", "🥉"];

export default function Reveal({ state, canAdvance, onNext }: Props) {
  const r = state.reveal;
  if (!r) return null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center p-6">
      <RevealPanel reveal={r} mediaAssets={state.mediaAssets} players={state.players} canAdvance={canAdvance} onNext={onNext} />
    </div>
  );
}

export function RevealPanel({
  reveal: r,
  mediaAssets,
  players,
  canAdvance,
  onNext,
}: {
  reveal: RevealPayload;
  mediaAssets?: Record<string, ContentMediaAssetDef>;
  players?: GameState["players"];
  canAdvance: boolean;
  onNext: () => void;
}) {
  const isPrompt = r.type === "prompt";
  const hasMedia = mediaForPlacement(r.media, "reveal").length > 0;

  return (
    <section
      aria-label={isPrompt ? "Resultado del evento" : "Resultados"}
      className={cn(
        "reveal-panel grid max-h-[calc(100dvh-1.5rem)] w-[min(48rem,calc(100vw-1.5rem))] grid-rows-[auto_minmax(0,1fr)] overflow-y-auto border-y-[6px] border-[#fff4bf] bg-[#171120]/96 text-[#fff8d6] shadow-[0_0_0_6px_#171120,0_0_0_8px_rgba(255,244,191,0.38),0_28px_90px_rgb(0_0_0/0.65)]",
        hasMedia && "lg:w-[min(68rem,calc(100vw-3rem))]"
      )}
    >
      <header className="border-b border-[#fff4bf]/20 bg-[#100b1a]/80 px-5 py-4 text-center sm:px-7">
        <p className="retro text-[10px] uppercase text-[#c7bddc]">{isPrompt ? "Evento" : "Resultados"}</p>
        <h2 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">{r.title}</h2>
        {r.story?.reveal && <p className="mx-auto mt-2 max-w-3xl text-sm font-black leading-5 text-[#c7bddc]">{r.story.reveal}</p>}
      </header>

      <div className={cn("reveal-panel-body grid min-h-0", hasMedia && "reveal-panel-body--media")}>
        {hasMedia && (
          <div className="reveal-panel-media border-b border-[#fff4bf]/20 bg-[radial-gradient(circle_at_50%_12%,rgba(56,189,248,0.12),transparent_46%),#0b0812] p-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#a89fc5]">
              <span>Archivo de la noche</span>
              <span aria-hidden="true">● REC</span>
            </div>
            <ActivityMediaStrip assets={mediaAssets} media={r.media} placement="reveal" presentation="spotlight" />
          </div>
        )}

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
          <div className="flex w-full flex-col gap-2">
            {r.entries.map((e, idx) => {
              const detail = revealEntryDetail(e);
              return (
                <div
                  key={e.playerId}
                  className={`animate-pop border-2 p-3 ${
                    idx === 0 ? "border-[#f5d547] bg-[#f5d547]/18" : "border-[#fff4bf]/20 bg-[#0d1829]"
                  }`}
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2">
                    <span className="text-center text-xl">{MEDAL[idx] ?? `${e.rank}.`}</span>
                    <span className="min-w-0 truncate font-bold">{e.name}</span>
                    <span className="text-right text-sm font-black text-[#7dd3fc]">{revealEntryResult(e)}</span>
                  </div>
                  <div className="mt-1 flex items-start justify-between gap-3 pl-9">
                    {detail && <p className="min-w-0 text-sm font-bold text-[#c7bddc]">{detail}</p>}
                    {e.coins !== 0 && (
                      <span className={`shrink-0 font-bold ${e.coins > 0 ? "text-[#f5d547]" : "text-[#fb7185]"}`}>
                        {e.coins > 0 ? "+" : "-"}🪙{Math.abs(e.coins)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        {r.coinTransactions?.length ? (
          <div className="grid gap-2">
            {r.coinTransactions.map((transaction, index) => (
              <p
                key={`${transaction.id}-${index}`}
                className="rounded-sm border border-[#7dd3fc]/25 bg-[#0ea5e9]/10 px-3 py-2 text-center text-xs font-black leading-5 text-[#bae6fd]"
              >
                {coinTransactionText(transaction, players)}
              </p>
            ))}
          </div>
        ) : null}

        <div className="grid gap-2">
          {r.actions?.length ? (
            r.actions.map((action, index) => (
              <p key={`${action.text}-${index}`} className="rounded-sm border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-center text-sm font-black text-amber-100">
                {action.text}
              </p>
            ))
          ) : (
            <p className="rounded-sm border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-sm font-bold text-[#c7bddc]">No consequences triggered.</p>
          )}
        </div>

        {canAdvance ? (
          <Button
            type="button"
            onClick={onNext}
            className="h-12 w-full bg-[#f5d547] text-sm uppercase text-[#201507]"
          >
            Siguiente turno
          </Button>
        ) : (
          <p className="animate-pulse text-center text-sm font-black text-[#c7bddc]">Esperando al host / jugador activo...</p>
        )}
        </div>
      </div>
    </section>
  );
}

function coinTransactionText(transaction: CoinTransaction, players: GameState["players"] = []): string {
  const playerName = players.find((player) => player.id === transaction.playerId)?.name ?? transaction.playerId;
  const amount = Math.abs(transaction.delta);
  const verb = transaction.delta >= 0 ? "gained" : "spent";
  const clamp = transaction.clamped ? `, clamped from ${Math.abs(transaction.requestedDelta)}` : "";
  return `${playerName} ${verb} ${amount} coin${amount === 1 ? "" : "s"} · ${transaction.source.label}${clamp}`;
}
