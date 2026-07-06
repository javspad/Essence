import { useState } from "react";
import { Send, Vote } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Textarea } from "@/components/ui/8bit/textarea";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function Judge({ content, onFinish, activeMinigame }: MinigameProps) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const judgeState = activeMinigame?.judge;
  const submissions = judgeState?.submissions ?? [];

  const submit = () => {
    if (sent) return;
    setSent(true);
    onFinish(0, { message: text.trim() });
  };

  const vote = (submissionId: string) => {
    if (picked) return;
    setPicked(submissionId);
    onFinish(0, { votedForSubmissionId: submissionId });
  };

  if (judgeState?.phase === "voting") {
    return (
      <ArcadeShell title={content?.prompt ?? "Votá el mejor texto"} kicker="Jurado" badge="voto">
        <p className="text-center text-sm font-black text-[#c7bddc]">
          Leé las respuestas anónimas y votá la mejor.
        </p>
        <div className="grid w-full gap-3">
          {submissions.map((submission, index) => (
            <Button
              key={submission.id}
              type="button"
              font="normal"
              onClick={() => vote(submission.id)}
              disabled={!!picked}
              className={`min-h-24 w-full flex-col items-start justify-center gap-2 bg-[#0d1829] px-4 py-3 text-left normal-case text-[#fff8d6] hover:bg-[#12253f] ${
                picked === submission.id ? "scale-[1.02] bg-[#f5d547] text-[#201507]" : picked ? "opacity-45" : ""
              }`}
            >
              <span className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">Respuesta {index + 1}</span>
              <span className="text-base font-black leading-6">{submission.text}</span>
            </Button>
          ))}
        </div>
        {picked ? (
          <p className="animate-pop text-center text-sm font-black text-emerald-300">¡Voto registrado!</p>
        ) : (
          <p className="text-center text-xs font-black uppercase tracking-[0.12em] text-[#c7bddc]">
            <Vote data-icon="inline-start" className="inline size-3" /> Sin nombres hasta el reveal.
          </p>
        )}
      </ArcadeShell>
    );
  }

  return (
    <ArcadeShell title={content?.prompt ?? "Escribí tu mensaje"} kicker="Jurado" badge="texto">
      {content?.persona === "lujan" && (
        <p className="text-center text-sm font-black text-[#c7bddc]">
          🍦 Luján Eppens es exigente e irónica. Impresionala.
        </p>
      )}
      <Textarea
        font="normal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={sent}
        rows={4}
        maxLength={280}
        placeholder={content?.placeholder ?? "Escribí acá..."}
        className="min-h-36 w-full resize-none bg-[#0d1829] p-4 text-lg text-[#fff8d6] disabled:opacity-50"
      />
      <Button
        type="button"
        onClick={submit}
        disabled={sent || !text.trim()}
        className="h-12 w-full bg-[#f472b6] text-sm uppercase text-[#2a0718]"
      >
        <Send data-icon="inline-start" />
        {sent ? "Esperando las respuestas..." : "Enviar"}
      </Button>
    </ArcadeShell>
  );
}
