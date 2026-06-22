import { useState } from "react";
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
    <div className="flex flex-col items-center gap-5 p-6 max-w-md mx-auto w-full">
      <h2 className="text-2xl font-bold text-center">{content?.prompt ?? "Escribí tu mensaje"}</h2>
      {content?.persona === "lujan" && (
        <p className="text-violet-300 text-sm text-center">
          🍦 Luján Eppens es exigente e irónica. Impresionala.
        </p>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={sent}
        rows={4}
        maxLength={280}
        placeholder={content?.placeholder ?? "Escribí acá..."}
        className="w-full rounded-2xl bg-white/10 border-2 border-white/20 focus:border-white/60 outline-none p-4 text-lg resize-none disabled:opacity-50"
      />
      <button
        onClick={submit}
        disabled={sent || !text.trim()}
        className="rounded-2xl py-4 px-8 font-bold text-lg bg-pink-500 active:scale-95 transition disabled:opacity-40 w-full"
      >
        {sent ? "Esperando el veredicto..." : "Enviar 💌"}
      </button>
    </div>
  );
}
