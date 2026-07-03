import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { Textarea } from "@/components/ui/8bit/textarea";
import { ArcadeShell } from "./ArcadeShell";
import type { MinigameProps } from "./types";

export default function Judge({ content, onFinish }: MinigameProps) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  const submit = () => {
    if (sent) return;
    setSent(true);
    // El score lo pone el juez IA en el server. Acá sólo mandamos el mensaje.
    onFinish(0, { message: text.trim() });
  };

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
        {sent ? "Esperando el veredicto..." : "Enviar 💌"}
      </Button>
    </ArcadeShell>
  );
}
