import type { ContentMediaAssetDef, GameState, RevealPayload } from "@essence/shared";
import { Button } from "@/components/ui/8bit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { revealEntryDetail, revealEntryResult } from "../revealDisplay";
import ActivityMediaStrip from "./ActivityMedia";

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
      <RevealPanel reveal={r} mediaAssets={state.mediaAssets} canAdvance={canAdvance} onNext={onNext} />
    </div>
  );
}

export function RevealPanel({
  reveal: r,
  mediaAssets,
  canAdvance,
  onNext,
}: {
  reveal: RevealPayload;
  mediaAssets?: Record<string, ContentMediaAssetDef>;
  canAdvance: boolean;
  onNext: () => void;
}) {
  const isPrompt = r.type === "prompt";

  return (
    <Card font="normal" className="w-full border-[#fff4bf] bg-[#171120]/92 text-[#fff8d6]">
      <CardHeader font="normal" className="text-center">
        <p className="retro text-[10px] uppercase text-[#c7bddc]">{isPrompt ? "Evento" : "Resultados"}</p>
        <CardTitle font="normal" className="text-2xl font-black">{r.title}</CardTitle>
        {r.story?.reveal && <p className="mt-2 text-sm font-black text-[#c7bddc]">{r.story.reveal}</p>}
        <ActivityMediaStrip assets={mediaAssets} media={r.media} placement="reveal" compact />
      </CardHeader>

      <CardContent font="normal" className="flex flex-col gap-5">
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
                  {e.coins > 0 && <span className="shrink-0 font-bold text-[#f5d547]">+🪙{e.coins}</span>}
                </div>
              </div>
            );
          })}
        </div>

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
      </CardContent>
    </Card>
  );
}
