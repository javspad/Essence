import type { GameState } from "@essence/shared";
import { Button } from "@/components/ui/8bit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";

interface Props {
  state: GameState;
  canAdvance: boolean;
  onNext: () => void;
}

const MEDAL = ["🥇", "🥈", "🥉"];

export default function Reveal({ state, canAdvance, onNext }: Props) {
  const r = state.reveal;
  if (!r) return null;
  const isPrompt = r.type === "prompt";
  const confirmer = r.entries[0]?.name;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center p-6">
      <Card font="normal" className="w-full border-[#fff4bf] bg-[#171120]/92 text-[#fff8d6]">
        <CardHeader font="normal" className="text-center">
          <p className="retro text-[10px] uppercase text-[#c7bddc]">{isPrompt ? "Evento" : "Resultados"}</p>
          <CardTitle font="normal" className="text-2xl font-black">{r.title}</CardTitle>
          {r.story?.reveal && <p className="mt-2 text-sm font-black text-[#c7bddc]">{r.story.reveal}</p>}
        </CardHeader>

        <CardContent font="normal" className="flex flex-col gap-5">
          {isPrompt ? (
            <div className="rounded-sm border-2 border-[#fff4bf]/20 bg-[#0d1829] p-4 text-center font-black">
              {confirmer ? `${confirmer} confirmó la acción.` : "Acción confirmada."}
            </div>
          ) : (
            <div className="flex w-full flex-col gap-2">
              {r.entries.map((e, idx) => (
                <div
                  key={e.playerId}
                  className={`animate-pop border-2 p-3 ${
                    idx === 0 ? "border-[#f5d547] bg-[#f5d547]/18" : "border-[#fff4bf]/20 bg-[#0d1829]"
                  }`}
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-7 text-center text-xl">{MEDAL[idx] ?? `${e.rank}.`}</span>
                    <span className="flex-1 font-bold">{e.name}</span>
                    {e.coins > 0 && <span className="font-bold text-[#f5d547]">+🪙{e.coins}</span>}
                  </div>
                  {e.flavor && <p className="mt-1 pl-9 text-sm italic text-[#c7bddc]">"{e.flavor}"</p>}
                </div>
              ))}
            </div>
          )}

          {r.actions?.length ? (
            <div className="grid gap-2">
              {r.actions.map((action, index) => (
                <p key={`${action.text}-${index}`} className="rounded-sm border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-center text-sm font-black text-amber-100">
                  {action.text}
                </p>
              ))}
            </div>
          ) : null}

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
    </div>
  );
}
