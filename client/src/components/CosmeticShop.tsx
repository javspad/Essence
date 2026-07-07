import { useMemo, useState } from "react";
import type { CosmeticDef, GameState, Player } from "@essence/shared";
import { cosmeticAnchorId, cosmeticAssetKind, cosmeticPrice, isCosmeticCompatibleWithCharacter } from "@essence/shared/cosmetics";
import { Check, Coins, Palette, Package, ShoppingBag, X } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { cn } from "@/lib/utils";

type CosmeticActionResult = { ok: true } | { ok: false; error: string };

interface CosmeticShopProps {
  state: GameState;
  me: Player;
  onClose: () => void;
  onBuyCosmetic: (cosmeticId: string, onResult?: (res: CosmeticActionResult) => void) => void;
  onEquipCosmetic: (cosmeticId: string, equipped: boolean, onResult?: (res: CosmeticActionResult) => void) => void;
}

export default function CosmeticShop({
  state,
  me,
  onClose,
  onBuyCosmetic,
  onEquipCosmetic,
}: CosmeticShopProps) {
  const [tab, setTab] = useState<"cosmetics" | "artifacts">("cosmetics");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const owned = useMemo(() => new Set(me.ownedCosmeticIds ?? []), [me.ownedCosmeticIds]);
  const equipped = useMemo(() => new Set(me.cosmeticIds ?? []), [me.cosmeticIds]);
  const cosmetics = useMemo(
    () =>
      Object.values(state.cosmetics ?? {}).sort(
        (a, b) => (a.preview?.order ?? 0) - (b.preview?.order ?? 0) || a.name.localeCompare(b.name)
      ),
    [state.cosmetics]
  );

  const buy = (cosmetic: CosmeticDef) => {
    setBusyId(cosmetic.id);
    setStatus("");
    onBuyCosmetic(cosmetic.id, (res) => {
      setBusyId(null);
      setStatus(res.ok ? "Comprado" : res.error);
    });
  };

  const equip = (cosmetic: CosmeticDef, nextEquipped: boolean) => {
    setBusyId(cosmetic.id);
    setStatus("");
    onEquipCosmetic(cosmetic.id, nextEquipped, (res) => {
      setBusyId(null);
      setStatus(res.ok ? (nextEquipped ? "Equipado" : "Guardado") : res.error);
    });
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cosmetic-shop-title"
        className="flex max-h-[calc(100dvh-1.5rem)] w-[min(58rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-md border border-[#fff4bf]/35 bg-[#0e0a1a]/96 text-[#fff8d6] shadow-[0_0_0_1px_rgba(255,244,191,0.08),0_24px_70px_rgb(0_0_0/0.6)]"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="retro text-[8px] uppercase tracking-widest text-[#a89fc5]">Shop</p>
            <h2 id="cosmetic-shop-title" className="truncate text-xl font-black text-[#fff4bf]">
              Visual loadout
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-[#fde68a]/40 bg-[#f5d547]/12 px-3 text-xs font-black text-[#fde68a]">
              <Coins className="size-3.5" />
              {me.coins}
            </span>
            <button
              type="button"
              aria-label="Cerrar shop"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-sm border border-white/15 bg-white/5 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#67e8f9]"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex border-b border-white/10 bg-black/20 px-3 pt-3">
          <button
            type="button"
            aria-pressed={tab === "cosmetics"}
            onClick={() => setTab("cosmetics")}
            className={tabClass(tab === "cosmetics")}
          >
            <Palette className="size-4" />
            Cosmetics
          </button>
          <button
            type="button"
            aria-pressed={tab === "artifacts"}
            onClick={() => setTab("artifacts")}
            className={tabClass(tab === "artifacts")}
          >
            <Package className="size-4" />
            Artifacts
          </button>
        </div>

        {tab === "cosmetics" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-3 md:grid-cols-2">
              {cosmetics.map((cosmetic) => {
                const price = cosmeticPrice(cosmetic);
                const isOwned = owned.has(cosmetic.id);
                const isEquipped = equipped.has(cosmetic.id);
                const compatible = isCosmeticCompatibleWithCharacter(cosmetic, me.characterId ?? me.id);
                const affordable = me.coins >= price;
                const busy = busyId === cosmetic.id;
                const canBuy = !isOwned && compatible && affordable && !busy;
                return (
                  <article
                    key={cosmetic.id}
                    data-cosmetic-shop-item={cosmetic.id}
                    className={cn(
                      "rounded-md border bg-white/[0.04] p-3 transition",
                      isEquipped ? "border-[#67e8f9]/70 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]" : "border-white/10"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{cosmetic.name}</p>
                        <p className="mt-1 line-clamp-2 min-h-8 text-xs font-bold leading-4 text-[#d4cfea]">{cosmetic.description ?? cosmetic.id}</p>
                      </div>
                      <CosmeticSwatch cosmetic={cosmetic} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-[#a89fc5]">
                      <span className="rounded-sm border border-white/10 bg-black/20 px-2 py-1">{cosmeticAssetKind(cosmetic)}</span>
                      <span className="rounded-sm border border-white/10 bg-black/20 px-2 py-1">{cosmetic.anchorType}:{cosmeticAnchorId(cosmetic)}</span>
                      {isOwned && <span className="rounded-sm border border-[#6ee7b7]/40 bg-[#10b981]/15 px-2 py-1 text-[#6ee7b7]">Owned</span>}
                      {isEquipped && <span className="rounded-sm border border-[#67e8f9]/50 bg-[#0891b2]/20 px-2 py-1 text-[#a5f3fc]">Equipped</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-black text-[#fde68a]">
                        <Coins className="size-3.5" />
                        {price}
                      </span>
                      {isOwned ? (
                        <Button
                          type="button"
                          disabled={busy || !compatible}
                          onClick={() => equip(cosmetic, !isEquipped)}
                          className={cn(
                            "min-h-9 px-3 text-[10px] uppercase",
                            isEquipped ? "border border-[#67e8f9]/45 bg-[#062d38] text-[#a5f3fc]" : "bg-[#f5d547] text-[#201507]"
                          )}
                        >
                          {isEquipped ? <Check data-icon="inline-start" /> : <ShoppingBag data-icon="inline-start" />}
                          {isEquipped ? "Unequip" : "Equip"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          disabled={!canBuy}
                          onClick={() => buy(cosmetic)}
                          className="min-h-9 bg-[#f5d547] px-3 text-[10px] uppercase text-[#201507] disabled:bg-white/15 disabled:text-white/45"
                        >
                          <ShoppingBag data-icon="inline-start" />
                          {compatible ? (affordable ? "Buy" : "Locked") : "Blocked"}
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center p-6 text-center">
            <div className="max-w-sm">
              <Package className="mx-auto size-10 text-[#a89fc5]" />
              <p className="mt-3 text-lg font-black text-white">Artifacts arrive in S4</p>
              <p className="mt-2 text-sm font-bold leading-6 text-[#d4cfea]">
                This tab stays separate so gameplay items do not mix with visual-only cosmetics.
              </p>
            </div>
          </div>
        )}

        <footer className="flex min-h-11 items-center justify-between gap-3 border-t border-white/10 px-4 py-2">
          <p className="min-w-0 truncate text-xs font-black text-[#a89fc5]">{status}</p>
          <p className="shrink-0 text-[9px] font-black uppercase tracking-wider text-[#6ee7b7]">Visual only</p>
        </footer>
      </section>
    </div>
  );
}

function tabClass(active: boolean): string {
  return cn(
    "mb-[-1px] inline-flex min-h-10 items-center gap-2 rounded-t-sm border px-3 text-xs font-black uppercase tracking-wider transition",
    active
      ? "border-white/15 border-b-[#0e0a1a] bg-[#0e0a1a] text-white"
      : "border-transparent text-[#a89fc5] hover:bg-white/5 hover:text-white"
  );
}

function CosmeticSwatch({ cosmetic }: { cosmetic: CosmeticDef }) {
  const asset = cosmetic.asset;
  const primary = cosmetic.preview?.color ?? (typeof asset === "string" ? "#f5d547" : asset.color) ?? "#f5d547";
  const secondary = cosmetic.preview?.secondaryColor ?? (typeof asset === "string" ? "#67e8f9" : asset.secondaryColor) ?? "#67e8f9";
  return (
    <span
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-sm border border-white/15 text-[10px] font-black uppercase text-[#0e0a1a]"
      style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
    >
      {cosmetic.preview?.label ?? cosmeticAssetKind(cosmetic).slice(0, 2)}
    </span>
  );
}
