import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { CharacterDef, CosmeticDef } from "@essence/shared";
import { characterDisplayName } from "@essence/shared/characters";
import { cosmeticAnchorRefs } from "@essence/shared/cosmetics";
import { TOKEN_PREVIEW_GROUP_POSITION, TOKEN_PREVIEW_GROUP_SCALE } from "../characterTokenRig";
import { FreeOrbitCamera, PlayerTokenPawn } from "./Board3DShell";

const COSMETIC_PREVIEW_SHOT = {
  position: [0, 0.2, 4.4] as [number, number, number],
  look: [0, -0.1, 0] as [number, number, number],
};

const FALLBACK_CHARACTER_COLOR = "#c9a24a";
const FALLBACK_CHARACTER: CharacterDef = {
  id: "cosmetic-preview",
  displayName: "Vos",
  color: FALLBACK_CHARACTER_COLOR,
  groom: false,
};

interface CosmeticGalleryOverlayProps {
  cosmetics: CosmeticDef[];
  characters?: Record<string, CharacterDef>;
  selectedCosmeticId?: string;
  selectedCharacterId?: string;
  onSelectCosmetic?: (id: string) => void;
  onSelectCharacter?: (id: string) => void;
  onClose: () => void;
}

export default function CosmeticGalleryOverlay({
  cosmetics,
  characters,
  selectedCosmeticId,
  selectedCharacterId,
  onSelectCosmetic,
  onSelectCharacter,
  onClose,
}: CosmeticGalleryOverlayProps) {
  const [localCosmeticId, setLocalCosmeticId] = useState(selectedCosmeticId ?? cosmetics[0]?.id ?? "");
  const [localCharacterId, setLocalCharacterId] = useState(selectedCharacterId ?? "");
  const [catalogOpen, setCatalogOpen] = useState(true);
  const cosmeticCatalog = useMemo<Record<string, CosmeticDef>>(
    () => Object.fromEntries(cosmetics.map((cosmetic) => [cosmetic.id, cosmetic])),
    [cosmetics]
  );
  const characterList = useMemo(() => {
    const authored = Object.values(characters ?? {});
    return authored.length ? authored : [FALLBACK_CHARACTER];
  }, [characters]);

  const activeCosmeticId = selectedCosmeticId ?? localCosmeticId;
  const activeCharacterId = selectedCharacterId ?? localCharacterId;
  const index = Math.max(0, cosmetics.findIndex((cosmetic) => cosmetic.id === activeCosmeticId));
  const current = cosmetics[index];
  const previewCharacter = characterList.find((character) => character.id === activeCharacterId) ?? characterList[0] ?? FALLBACK_CHARACTER;
  const tokenCharacter = {
    id: previewCharacter.id,
    name: characterDisplayName(previewCharacter),
    color: previewCharacter.color ?? FALLBACK_CHARACTER_COLOR,
    groom: Boolean(previewCharacter.groom),
  };

  useEffect(() => {
    if (!cosmetics.length) return;
    if (activeCosmeticId && cosmetics.some((cosmetic) => cosmetic.id === activeCosmeticId)) return;
    const nextId = cosmetics[0]?.id ?? "";
    setLocalCosmeticId(nextId);
    if (nextId) onSelectCosmetic?.(nextId);
  }, [activeCosmeticId, cosmetics, onSelectCosmetic]);

  useEffect(() => {
    if (!characterList.length) return;
    if (activeCharacterId && characterList.some((character) => character.id === activeCharacterId)) return;
    const nextId = characterList[0]?.id ?? "";
    setLocalCharacterId(nextId);
    if (nextId) onSelectCharacter?.(nextId);
  }, [activeCharacterId, characterList, onSelectCharacter]);

  const chooseCosmetic = (id: string) => {
    setLocalCosmeticId(id);
    onSelectCosmetic?.(id);
  };

  const chooseCharacter = (id: string) => {
    setLocalCharacterId(id);
    onSelectCharacter?.(id);
  };

  const step = (delta: number) => {
    if (!cosmetics.length) return;
    chooseCosmetic(cosmetics[(index + delta + cosmetics.length) % cosmetics.length].id);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[radial-gradient(ellipse_at_50%_-10%,#2a3550_0%,#141b2b_55%,#0a0e17_100%)]">
      <Canvas camera={{ position: [0, 0.5, 3], fov: 34, near: 0.1, far: 40 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} className="absolute inset-0">
        <FreeOrbitCamera overview={COSMETIC_PREVIEW_SHOT} />
        <ambientLight intensity={0.74} color="#fff8e1" />
        <directionalLight position={[3, 5, 4]} intensity={2.4} />
        <directionalLight position={[-3, 2, -3]} intensity={0.6} color="#b3d4ff" />
        <group position={TOKEN_PREVIEW_GROUP_POSITION} scale={TOKEN_PREVIEW_GROUP_SCALE}>
          <PlayerTokenPawn
            character={tokenCharacter}
            facePhoto={previewCharacter.facePhoto}
            facePhotoAlignment={previewCharacter.facePhotoAlignment}
            faceAnchors={previewCharacter.faceAnchors}
            bodyAnchors={previewCharacter.bodyAnchors}
            cosmeticIds={current ? [current.id] : []}
            cosmeticCatalog={cosmeticCatalog}
          />
        </group>
        <mesh position={[0, -0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.5, 40]} />
          <meshStandardMaterial color="#101728" roughness={0.9} transparent opacity={0.7} />
        </mesh>
      </Canvas>

      <div className="pointer-events-none absolute inset-0 z-10 flex min-h-0 flex-col justify-between p-3 sm:p-5">
        <header className="pointer-events-auto flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-lg border border-white/15 bg-slate-950/60 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-md">
            <p className="text-[0.65rem] font-black uppercase tracking-[0.24em] text-fuchsia-200">Galería de cosméticos</p>
            <h2 className="mt-1 text-2xl font-black text-white">{current ? current.name : "Sin cosméticos"}</h2>
            <p className="mt-2 text-xs font-bold text-fuchsia-100/80">Arrastrá para orbitar · rueda para zoom · click derecho o Shift+arrastrar para desplazar</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-white/20 bg-slate-950/60 px-4 py-3 text-sm font-black text-white shadow-2xl backdrop-blur-md transition hover:bg-white/10">
            Close
          </button>
        </header>

        <section className="pointer-events-auto w-full rounded-lg border border-white/15 bg-slate-950/65 p-3 shadow-2xl shadow-black/35 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => step(-1)} className="builder-button compact" aria-label="Anterior">◀</button>
              <span className="min-w-[4rem] text-center text-xs font-bold text-slate-300">{cosmetics.length ? index + 1 : 0} / {cosmetics.length}</span>
              <button type="button" onClick={() => step(1)} className="builder-button compact" aria-label="Siguiente">▶</button>
              <button type="button" onClick={() => setCatalogOpen((open) => !open)} className="builder-button compact" aria-expanded={catalogOpen}>
                {catalogOpen ? "Catálogo ▾" : "Catálogo ▸"}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="flex items-center gap-2 text-[0.58rem] font-black uppercase tracking-[0.1em] text-slate-400">
                Player
                <select
                  aria-label="Preview character"
                  value={previewCharacter.id}
                  onChange={(event) => chooseCharacter(event.target.value)}
                  className="rounded-md border border-white/10 bg-[#111827] px-2 py-1.5 text-xs font-black text-white outline-none focus:border-fuchsia-300"
                >
                  {characterList.map((character) => (
                    <option key={character.id} value={character.id}>
                      {characterDisplayName(character)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{current ? cosmeticAnchorLabel(current) : ""}</span>
            </div>
          </div>
          {catalogOpen && (
            <div className="mt-3 grid max-h-[30vh] grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 overflow-y-auto overscroll-contain pr-1">
              {cosmetics.map((cosmetic) => (
                <button
                  key={cosmetic.id}
                  type="button"
                  onClick={() => chooseCosmetic(cosmetic.id)}
                  aria-pressed={cosmetic.id === current?.id}
                  className={`rounded-md border px-2 py-2 text-left text-xs font-bold transition ${
                    cosmetic.id === current?.id
                      ? "border-fuchsia-300/70 bg-fuchsia-400/20 text-fuchsia-100"
                      : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <span className="block truncate">{cosmetic.name}</span>
                  <span className="mt-0.5 block truncate text-[0.56rem] uppercase tracking-[0.08em] text-slate-500">{cosmeticAnchorLabel(cosmetic)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function cosmeticAnchorLabel(cosmetic: CosmeticDef): string {
  return cosmeticAnchorRefs(cosmetic)
    .map((anchor) => anchor.anchorId)
    .join(" + ")
    .toUpperCase();
}
