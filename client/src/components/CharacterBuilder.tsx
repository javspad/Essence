import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Home, Palette, RefreshCw, Save, Sparkles } from "lucide-react";
import type { CharacterCosmeticSlot, GameContent, Player, PlayerCharacter, PlayerDef, Tile } from "@essence/shared";
import {
  DEFAULT_CHARACTER_COSMETICS,
  characterForPlayerDef,
  normalizePlayerCharacter,
} from "@essence/shared/character";
import seedContent from "@shared/content.json";
import Board3DShell from "./Board3DShell";

const STORAGE_KEY = "essence:character-builder:draft:v1";
const BASE_CONTENT = ensureCharacterContent(seedContent as GameContent);

const PREVIEW_TILES: Tile[] = [
  { id: 0, type: "start", label: "SET", layout: { x: 0, y: 0 } },
  { id: 1, type: "finish", label: "GO", layout: { x: 1, y: 0 } },
];

const COLOR_SWATCHES = ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#ec4899", "#14b8a6", "#fef3c7"];
const SLOT_LABELS: Record<CharacterCosmeticSlot, string> = {
  hat: "Sombreros",
  mustache: "Bigotes",
  nipplePiercing: "Piercings",
  tattoo: "Tatuajes",
  shirt: "Camisetas",
  shoes: "Zapatillas",
};

export default function CharacterBuilder() {
  const [content, setContent] = useState<GameContent>(() => loadInitialContent());
  const [selectedId, setSelectedId] = useState(() => content.players[0]?.id ?? "");
  const [saveStatus, setSaveStatus] = useState("");
  const [importText, setImportText] = useState("");
  const [devCosmetics, setDevCosmetics] = useState(false);

  const selected = content.players.find((player) => player.id === selectedId) ?? content.players[0];
  const selectedCharacter = selected ? normalizePlayerCharacter(selected.character, selected.color) : normalizePlayerCharacter(undefined);
  const exportJson = useMemo(() => JSON.stringify(ensureCharacterContent(content), null, 2), [content]);
  const cosmeticCatalog = content.characterCosmetics?.length ? content.characterCosmetics : DEFAULT_CHARACTER_COSMETICS;
  const previewPlayer = useMemo(() => (selected ? toPreviewPlayer(selected) : null), [selected]);
  const previewNonce = selected
    ? [
        selected.id,
        selectedCharacter.base.color,
        selectedCharacter.base.height,
        selectedCharacter.base.weight,
        selectedCharacter.base.movement,
        selectedCharacter.base.limbs.arms,
        selectedCharacter.base.limbs.legs,
        Object.values(selectedCharacter.equippedCosmeticIds ?? {}).join(","),
      ].join(":")
    : "empty";

  useEffect(() => {
    if (selectedId && content.players.some((player) => player.id === selectedId)) return;
    setSelectedId(content.players[0]?.id ?? "");
  }, [content.players, selectedId]);

  useEffect(() => {
    if (!saveStatus) return;
    const timeout = window.setTimeout(() => setSaveStatus(""), 1800);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const updateSelected = (updater: (player: PlayerDef) => PlayerDef) => {
    if (!selected) return;
    setContent((current) => ({
      ...current,
      players: current.players.map((player) => (player.id === selected.id ? updater(player) : player)),
    }));
  };

  const updateCharacter = (updater: (character: PlayerCharacter) => PlayerCharacter) => {
    updateSelected((player) => {
      const current = normalizePlayerCharacter(player.character, player.color);
      const next = updater(current);
      return {
        ...player,
        color: next.base.color,
        character: next,
      };
    });
  };

  const setBase = <K extends keyof PlayerCharacter["base"]>(key: K, value: PlayerCharacter["base"][K]) => {
    updateCharacter((character) => ({
      ...character,
      base: {
        ...character.base,
        [key]: value,
      },
    }));
  };

  const setLimbs = (arms: boolean, legs: boolean) => {
    updateCharacter((character) => ({
      ...character,
      base: {
        ...character.base,
        limbs: { arms, legs },
      },
    }));
  };

  const toggleCosmetic = (slot: CharacterCosmeticSlot, cosmeticId: string) => {
    if (!devCosmetics) return;
    updateCharacter((character) => {
      const equipped = { ...(character.equippedCosmeticIds ?? {}) };
      equipped[slot] = equipped[slot] === cosmeticId ? null : cosmeticId;
      return {
        ...character,
        unlockedCosmeticIds: Array.from(new Set([...(character.unlockedCosmeticIds ?? []), cosmeticId])),
        equippedCosmeticIds: equipped,
      };
    });
  };

  const saveDraft = () => {
    localStorage.setItem(STORAGE_KEY, exportJson);
    setSaveStatus("Guardado");
  };

  const resetDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
    setContent(BASE_CONTENT);
    setImportText("");
    setSaveStatus("Reseteado");
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(exportJson);
    setSaveStatus("Copiado");
  };

  const downloadJson = () => {
    const blob = new Blob([exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "content.character-builder.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = () => {
    try {
      const parsed = ensureCharacterContent(JSON.parse(importText) as GameContent);
      setContent(parsed);
      setSelectedId(parsed.players[0]?.id ?? "");
      setImportText("");
      setSaveStatus("Importado");
    } catch {
      window.alert("JSON inválido");
    }
  };

  if (!selected || !previewPlayer) {
    return (
      <main className="flex min-h-full items-center justify-center bg-[#140f1f] p-6 text-[#fff8d6]">
        No hay jugadores predefinidos en el contenido.
      </main>
    );
  }

  return (
    <main className="character-builder-shell min-h-full bg-[#120d1a] text-[#fff8d6]">
      <header className="sticky top-0 z-30 border-b border-[#ffd166]/20 bg-[#120d1a]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#38bdf8]">Essence dev tool</p>
            <h1 className="truncate text-xl font-black text-white">Character builder</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {saveStatus && <span className="rounded-md border border-[#34d399]/35 bg-[#34d399]/12 px-2 py-1 text-xs font-black text-[#a7f3d0]">{saveStatus}</span>}
            <button type="button" onClick={saveDraft} className="builder-button compact">
              <Save className="size-3.5" /> Guardar
            </button>
            <button type="button" onClick={copyJson} className="builder-button compact">
              <Copy className="size-3.5" /> Copiar JSON
            </button>
            <button type="button" onClick={downloadJson} className="builder-button compact">
              <Download className="size-3.5" /> Descargar
            </button>
            <button type="button" onClick={resetDraft} className="builder-button danger compact">
              <RefreshCw className="size-3.5" /> Reset
            </button>
            <a href="/" className="builder-button compact">
              <Home className="size-3.5" /> Inicio
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <aside className="min-h-0 rounded-lg border border-[#ffd166]/20 bg-[#1b1328] p-3">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-[#fbbf24]">Personajes base</p>
          <div className="grid gap-2">
            {content.players.map((player) => {
              const character = normalizePlayerCharacter(player.character, player.color);
              const active = player.id === selected.id;
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => setSelectedId(player.id)}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left transition ${
                    active ? "border-[#38bdf8] bg-[#38bdf8]/14" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                >
                  <span className="size-5 rounded-full border border-black/35" style={{ background: character.base.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-white">{player.name}</span>
                    <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#c7bddc]">{player.id}</span>
                  </span>
                  {player.groom && <span className="rounded bg-[#facc15] px-1.5 py-0.5 text-[9px] font-black text-[#2a1a02]">NOVIO</span>}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="grid min-h-[38rem] overflow-hidden rounded-lg border border-[#ffd166]/20 bg-[#21162f] lg:grid-rows-[minmax(20rem,1fr)_auto]">
          <div className="relative min-h-[22rem] overflow-hidden bg-[#23151f]">
            <Board3DShell
              tiles={PREVIEW_TILES}
              players={[previewPlayer]}
              activeId={previewPlayer.id}
              boardLength={2}
              lastRoll={1}
              activeMotion={{ playerId: previewPlayer.id, path: [0, 1], kind: "walk", nonce: previewNonce }}
              interactive={false}
              className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_-15%,#f6d28a_0%,#c66b4c_42%,#432137_100%)]"
            />
            <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-white/15 bg-black/30 px-3 py-2 backdrop-blur">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#fbbf24]">Preview real del token</p>
              <p className="mt-1 text-sm font-black text-white">{selected.name}</p>
            </div>
          </div>

          <div className="grid gap-3 border-t border-white/10 p-4 md:grid-cols-3">
            <Metric label="Alto" value={`${Math.round(selectedCharacter.base.height * 100)}%`} />
            <Metric label="Cuerpo" value={`${Math.round(selectedCharacter.base.weight * 100)}%`} />
            <Metric label="Movimiento" value={selectedCharacter.base.movement === "hop" ? "Saltando" : "Caminando"} />
          </div>
        </section>

        <aside className="grid gap-4">
          <section className="rounded-lg border border-[#ffd166]/20 bg-[#1b1328] p-4">
            <div className="mb-4 flex items-center gap-2">
              <Palette className="size-4 text-[#38bdf8]" />
              <h2 className="font-black text-white">Base inicial</h2>
            </div>

            <label className="block text-xs font-black uppercase tracking-[0.14em] text-[#c7bddc]">Color</label>
            <div className="mt-2 grid grid-cols-8 gap-2">
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setBase("color", color)}
                  className={`aspect-square rounded-md border-2 ${selectedCharacter.base.color === color ? "border-white" : "border-black/35"}`}
                  style={{ background: color }}
                  aria-label={`Elegir color ${color}`}
                />
              ))}
            </div>
            <input
              type="color"
              value={selectedCharacter.base.color}
              onChange={(event) => setBase("color", event.target.value)}
              className="mt-3 h-10 w-full rounded-md border border-white/15 bg-[#100b1a]"
            />

            <RangeControl
              label="Qué tan alto"
              value={selectedCharacter.base.height}
              min={0.75}
              max={1.35}
              step={0.01}
              onChange={(value) => setBase("height", value)}
            />
            <RangeControl
              label="Qué tan gordo"
              value={selectedCharacter.base.weight}
              min={0.75}
              max={1.45}
              step={0.01}
              onChange={(value) => setBase("weight", value)}
            />

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBase("movement", "walk")}
                className={`builder-button ${selectedCharacter.base.movement === "walk" ? "active" : ""}`}
              >
                Caminando
              </button>
              <button
                type="button"
                onClick={() => setBase("movement", "hop")}
                className={`builder-button ${selectedCharacter.base.movement === "hop" ? "active" : ""}`}
              >
                Saltando
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setLimbs(false, false)} className={`builder-button ${!selectedCharacter.base.limbs.arms && !selectedCharacter.base.limbs.legs ? "active" : ""}`}>
                Solo pelota
              </button>
              <button type="button" onClick={() => setLimbs(true, true)} className={`builder-button ${selectedCharacter.base.limbs.arms && selectedCharacter.base.limbs.legs ? "active" : ""}`}>
                Brazos y piernas
              </button>
              <button type="button" onClick={() => setLimbs(true, false)} className={`builder-button ${selectedCharacter.base.limbs.arms && !selectedCharacter.base.limbs.legs ? "active" : ""}`}>
                Solo brazos
              </button>
              <button type="button" onClick={() => setLimbs(false, true)} className={`builder-button ${!selectedCharacter.base.limbs.arms && selectedCharacter.base.limbs.legs ? "active" : ""}`}>
                Solo piernas
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-[#ffd166]/20 bg-[#1b1328] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-[#f472b6]" />
                <h2 className="font-black text-white">Cosméticos</h2>
              </div>
              <button type="button" onClick={() => setDevCosmetics((value) => !value)} className={`builder-button compact ${devCosmetics ? "active" : ""}`}>
                Modo dev
              </button>
            </div>
            <p className="mb-3 text-xs font-bold text-[#c7bddc]">
              En la partida inicial quedan bloqueados. El catálogo ya sale en el JSON para comprarlos después en el mapa.
            </p>
            <div className="grid gap-2">
              {cosmeticCatalog.map((item) => {
                const equipped = selectedCharacter.equippedCosmeticIds?.[item.slot] === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!devCosmetics}
                    onClick={() => toggleCosmetic(item.slot, item.id)}
                    className={`rounded-md border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                      equipped ? "border-[#f472b6] bg-[#f472b6]/14" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-white">{item.name}</span>
                      <span className="rounded bg-[#facc15] px-1.5 py-0.5 text-[10px] font-black text-[#2a1a02]">{item.cost} monedas</span>
                    </span>
                    <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.12em] text-[#c7bddc]">{SLOT_LABELS[item.slot]}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-[#ffd166]/20 bg-[#1b1328] p-4">
            <h2 className="font-black text-white">Importar JSON</h2>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="Pegá content.json o un export del builder"
              className="mt-3 h-28 w-full resize-none rounded-md border border-white/15 bg-[#100b1a] p-3 text-xs font-bold text-[#fff8d6] outline-none focus:border-[#38bdf8]"
            />
            <button type="button" onClick={importJson} disabled={!importText.trim()} className="builder-button mt-2 w-full disabled:opacity-45">
              Importar
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-4 block">
      <span className="flex items-center justify-between text-xs font-black uppercase tracking-[0.14em] text-[#c7bddc]">
        {label}
        <span className="text-[#fff8d6]">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-[#38bdf8]"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/18 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#c7bddc]">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function loadInitialContent(): GameContent {
  if (typeof localStorage === "undefined") return BASE_CONTENT;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return BASE_CONTENT;
  try {
    return ensureCharacterContent(JSON.parse(saved) as GameContent);
  } catch {
    return BASE_CONTENT;
  }
}

function ensureCharacterContent(content: GameContent): GameContent {
  return {
    ...content,
    characterCosmetics: content.characterCosmetics?.length ? content.characterCosmetics : DEFAULT_CHARACTER_COSMETICS,
    players: content.players.map((player) => {
      const character = characterForPlayerDef(player);
      return {
        ...player,
        color: character.base.color,
        character,
      };
    }),
  };
}

function toPreviewPlayer(def: PlayerDef): Player {
  const character = characterForPlayerDef(def);
  return {
    id: def.id,
    name: def.name,
    socketId: "character-builder",
    connected: true,
    position: 1,
    coins: 0,
    stars: 0,
    isHost: false,
    groom: Boolean(def.groom),
    color: character.base.color,
    character,
  };
}
