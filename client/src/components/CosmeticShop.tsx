import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { ArtifactDef, ArtifactOffer, ArtifactRarityDef, AudioTriggerId, CosmeticDef, GameState, Player } from "@essence/shared";
import type { AudioTriggerContext } from "@essence/shared/audio";
import { artifactActionsForUse, artifactPrice } from "@essence/shared/artifacts";
import { consequenceLabel } from "@essence/shared/consequences";
import { cosmeticAnchorRefs, cosmeticAssetKind, cosmeticPrice, isCosmeticCompatibleWithCharacter } from "@essence/shared/cosmetics";
import { Check, Coins, Package, Palette, Route, ShoppingBag, Sparkles, Target, X } from "lucide-react";
import { Button } from "@/components/ui/8bit/button";
import { cn } from "@/lib/utils";

type CosmeticActionResult = { ok: true } | { ok: false; error: string };
type ArtifactRollResult = { ok: true; offers: ArtifactOffer[] } | { ok: false; error: string };
type ArtifactBuyResult = { ok: true; artifactId: string; requiresTarget: boolean } | { ok: false; error: string };
type ArtifactUseResult = { ok: true } | { ok: false; error: string };

interface CosmeticShopProps {
  state: GameState;
  me: Player;
  sharedArtifactShop?: boolean;
  onClose: () => void;
  onBuyCosmetic: (cosmeticId: string, onResult?: (res: CosmeticActionResult) => void) => void;
  onEquipCosmetic: (cosmeticId: string, equipped: boolean, onResult?: (res: CosmeticActionResult) => void) => void;
  onRollArtifacts: (onResult?: (res: ArtifactRollResult) => void) => void;
  onBuyArtifact: (offerId: string, onResult?: (res: ArtifactBuyResult) => void) => void;
  onUseArtifact: (targetPlayerId: string | undefined, onResult?: (res: ArtifactUseResult) => void) => void;
  onSkipArtifactShop: (onResult?: (res: ArtifactUseResult) => void) => void;
  onTargetPreview: (playerId: string | null) => void;
  onAudioTrigger?: (trigger: AudioTriggerId, context?: Omit<AudioTriggerContext, "trigger">) => void;
  onAudioTriggerFirst?: (triggers: AudioTriggerId[], context?: Omit<AudioTriggerContext, "trigger">) => void;
}

export default function CosmeticShop({
  state,
  me,
  sharedArtifactShop = false,
  onClose,
  onBuyCosmetic,
  onEquipCosmetic,
  onRollArtifacts,
  onBuyArtifact,
  onUseArtifact,
  onSkipArtifactShop,
  onTargetPreview,
  onAudioTrigger,
  onAudioTriggerFirst,
}: CosmeticShopProps) {
  const [tab, setTab] = useState<"cosmetics" | "artifacts">(state.phase === "shop" ? "artifacts" : "cosmetics");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const shopActor = state.artifactShop ? state.players.find((player) => player.id === state.artifactShop?.playerId) : undefined;
  const sharedShopActive = sharedArtifactShop && state.phase === "shop" && Boolean(state.artifactShop);
  const isShopActor = sharedShopActive && shopActor?.id === me.id;
  const coinPlayer = sharedShopActive ? shopActor ?? me : me;
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
      if (res.ok) {
        onAudioTrigger?.("cosmetic.bought", { playerId: me.id, cosmeticId: cosmetic.id, purchaseId: cosmetic.id });
        onAudioTrigger?.("purchase.completed", { playerId: me.id, cosmeticId: cosmetic.id, purchaseId: cosmetic.id });
      }
    });
  };

  const equip = (cosmetic: CosmeticDef, nextEquipped: boolean) => {
    setBusyId(cosmetic.id);
    setStatus("");
    onEquipCosmetic(cosmetic.id, nextEquipped, (res) => {
      setBusyId(null);
      setStatus(res.ok ? (nextEquipped ? "Equipado" : "Guardado") : res.error);
      if (res.ok && nextEquipped) onAudioTrigger?.("cosmetic.equipped", { playerId: me.id, cosmeticId: cosmetic.id });
    });
  };

  useEffect(() => {
    if (sharedShopActive) setTab("artifacts");
  }, [sharedShopActive]);

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cosmetic-shop-title"
        className="flex max-h-[calc(100dvh-1.5rem)] w-[min(62rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-md border border-[#fff4bf]/35 bg-[#0e0a1a]/96 text-[#fff8d6] shadow-[0_0_0_1px_rgba(255,244,191,0.08),0_24px_70px_rgb(0_0_0/0.6)]"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="retro text-[8px] uppercase tracking-widest text-[#a89fc5]">
              {sharedShopActive ? (isShopActor ? "Your shop visit" : "Shared shop view") : "Shop"}
            </p>
            <h2 id="cosmetic-shop-title" className="truncate text-xl font-black text-[#fff4bf]">
              {tab === "artifacts" ? "Artifact shop" : "Visual loadout"}
            </h2>
            {sharedShopActive && (
              <p className="mt-1 truncate text-xs font-black text-[#d4cfea]">
                Viewing {shopActor?.name ?? "the active player"} at SHOP cell #{state.artifactShop?.tileId}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-[#fde68a]/40 bg-[#f5d547]/12 px-3 text-xs font-black text-[#fde68a]">
              <Coins className="size-3.5" />
              {coinPlayer.name} · {coinPlayer.coins}
            </span>
            {sharedShopActive ? (
              <span className="rounded-sm border border-[#67e8f9]/35 bg-[#0891b2]/18 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-[#cffafe]">
                {isShopActor ? "You control" : "Watching"}
              </span>
            ) : (
              <button
                type="button"
                aria-label="Cerrar shop"
                onClick={() => {
                  onTargetPreview(null);
                  onClose();
                }}
                className="grid size-9 place-items-center rounded-sm border border-white/15 bg-white/5 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#67e8f9]"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </header>

        {sharedShopActive ? (
          <div className="flex items-center gap-2 border-b border-white/10 bg-black/20 px-4 py-3 text-xs font-black text-[#d4cfea]">
            <Package className="size-4 text-[#6ee7b7]" />
            Everyone is watching the same artifact shop state. Only {shopActor?.name ?? "the shop player"} can roll, buy, or choose a target.
          </div>
        ) : (
          <div className="flex border-b border-white/10 bg-black/20 px-3 pt-3">
            <button type="button" aria-pressed={tab === "cosmetics"} onClick={() => setTab("cosmetics")} className={tabClass(tab === "cosmetics")}>
              <Palette className="size-4" />
              Cosmetics
            </button>
            <button type="button" aria-pressed={tab === "artifacts"} onClick={() => setTab("artifacts")} className={tabClass(tab === "artifacts")}>
              <Package className="size-4" />
              Artifacts
            </button>
          </div>
        )}

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
                      <span className="rounded-sm border border-white/10 bg-black/20 px-2 py-1">{cosmeticAnchorSummary(cosmetic)}</span>
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
          <ArtifactShopPanel
            state={state}
            me={me}
            busyId={busyId}
            setBusyId={setBusyId}
            setStatus={setStatus}
            onClose={onClose}
            onRollArtifacts={onRollArtifacts}
            onBuyArtifact={onBuyArtifact}
            onUseArtifact={onUseArtifact}
            onSkipArtifactShop={onSkipArtifactShop}
            onTargetPreview={onTargetPreview}
            sharedArtifactShop={sharedShopActive}
            onAudioTrigger={onAudioTrigger}
            onAudioTriggerFirst={onAudioTriggerFirst}
          />
        )}

        <footer className="flex min-h-11 items-center justify-between gap-3 border-t border-white/10 px-4 py-2">
          <p className="min-w-0 truncate text-xs font-black text-[#a89fc5]">{status}</p>
          <p className="shrink-0 text-[9px] font-black uppercase tracking-wider text-[#6ee7b7]">{tab === "artifacts" ? "Gameplay" : "Visual only"}</p>
        </footer>
      </section>
    </div>
  );
}

function ArtifactShopPanel({
  state,
  me,
  busyId,
  setBusyId,
  setStatus,
  onClose,
  onRollArtifacts,
  onBuyArtifact,
  onUseArtifact,
  onSkipArtifactShop,
  onTargetPreview,
  sharedArtifactShop,
  onAudioTrigger,
  onAudioTriggerFirst,
}: {
  state: GameState;
  me: Player;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  setStatus: (status: string) => void;
  onClose: () => void;
  onRollArtifacts: (onResult?: (res: ArtifactRollResult) => void) => void;
  onBuyArtifact: (offerId: string, onResult?: (res: ArtifactBuyResult) => void) => void;
  onUseArtifact: (targetPlayerId: string | undefined, onResult?: (res: ArtifactUseResult) => void) => void;
  onSkipArtifactShop: (onResult?: (res: ArtifactUseResult) => void) => void;
  onTargetPreview: (playerId: string | null) => void;
  sharedArtifactShop: boolean;
  onAudioTrigger?: (trigger: AudioTriggerId, context?: Omit<AudioTriggerContext, "trigger">) => void;
  onAudioTriggerFirst?: (triggers: AudioTriggerId[], context?: Omit<AudioTriggerContext, "trigger">) => void;
}) {
  const shop = state.artifactShop;
  const pending = state.pendingArtifactUse;
  const catalog = state.artifactCatalog ?? {};
  const shopActor = shop ? state.players.find((player) => player.id === shop.playerId) : undefined;
  const isActor = shop?.playerId === me.id;
  const pendingArtifact = pending ? catalog[pending.artifactId] : undefined;
  const actorCoins = shopActor?.coins ?? 0;

  if (pending && pendingArtifact) {
    return (
      <TargetSelector
        state={state}
        me={me}
        actor={shopActor}
        artifact={pendingArtifact}
        pendingTargetIds={pending.validTargetIds}
        busy={busyId === `use:${pending.artifactId}`}
        onUse={(targetPlayerId) => {
          setBusyId(`use:${pending.artifactId}`);
          setStatus("");
          onUseArtifact(targetPlayerId, (res) => {
            setBusyId(null);
            setStatus(res.ok ? "Artifact used" : res.error);
            if (res.ok) {
              playArtifactUseAudio({
                actorId: pending.playerId,
                targetId: targetPlayerId,
                artifactId: pending.artifactId,
                onAudioTrigger,
                onAudioTriggerFirst,
              });
              onTargetPreview(null);
              onClose();
            }
          });
        }}
        onTargetPreview={onTargetPreview}
      />
    );
  }

  if (!shop) {
    const artifacts = Object.values(catalog).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 rounded-sm border border-[#6ee7b7]/25 bg-[#10b981]/10 p-3">
          <p className="text-[9px] font-black uppercase tracking-wider text-[#6ee7b7]">Artifact catalog</p>
          <p className="mt-1 text-sm font-bold leading-5 text-[#d4cfea]">
            Inspect the gameplay items here. Purchases unlock only when the active player lands on a SHOP cell.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {artifacts.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} effects={state.effects} rarities={state.artifactRarities}>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-black text-[#fde68a]">
                  <Coins className="size-3.5" />
                  {artifactPrice(artifact)}
                </span>
                <Button
                  type="button"
                  disabled
                  title="Land on a SHOP cell to roll offers and buy artifacts."
                  className="min-h-9 bg-white/15 px-3 text-[10px] uppercase text-white/45"
                >
                  <ShoppingBag data-icon="inline-start" />
                  SHOP cell
                </Button>
              </div>
            </ArtifactCard>
          ))}
        </div>
      </div>
    );
  }

  if (!shop.offers.length) {
    return (
      <div className="grid min-h-72 flex-1 place-items-center p-6 text-center">
        <div className="max-w-md">
          <Sparkles className="mx-auto size-10 text-[#6ee7b7]" />
          <p className="mt-3 text-lg font-black text-white">{shopActor?.name ?? "Player"} landed on the shop</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#d4cfea]">
            {isActor ? "Roll four artifact offers for this visit." : `Waiting for ${shopActor?.name ?? "the shop player"} to roll artifact offers.`}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-[10px] font-black uppercase tracking-wider">
            <span className="rounded-sm border border-[#fde68a]/30 bg-[#f5d547]/10 px-2 py-1 text-[#fde68a]">
              {shopActor?.name ?? "Player"} coins: {actorCoins}
            </span>
            <span className="rounded-sm border border-white/10 bg-black/25 px-2 py-1 text-[#a89fc5]">
              Cell #{shop.tileId}
            </span>
          </div>
          {isActor ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                disabled={busyId === "roll-artifacts"}
                data-testid="artifact-roll-offers"
                onClick={() => {
                  setBusyId("roll-artifacts");
                  setStatus("");
                  onRollArtifacts((res) => {
                    setBusyId(null);
                    setStatus(res.ok ? "Offers rolled" : res.error);
                    if (res.ok) onAudioTrigger?.("shop.roll", { playerId: shop.playerId });
                  });
                }}
                className="min-h-11 bg-[#34d399] px-4 text-xs font-black uppercase tracking-wider text-[#052e1a] disabled:bg-white/15 disabled:text-white/45"
              >
                <Sparkles data-icon="inline-start" />
                Roll offers
              </Button>
              <Button
                type="button"
                disabled={busyId === "skip-artifacts"}
                onClick={() => {
                  setBusyId("skip-artifacts");
                  setStatus("");
                  onSkipArtifactShop((res) => {
                    setBusyId(null);
                    setStatus(res.ok ? "Skipped" : res.error);
                    if (res.ok) onClose();
                  });
                }}
                className="min-h-11 bg-white/10 px-4 text-xs font-black uppercase tracking-wider text-[#d4cfea] hover:bg-white/15 disabled:opacity-45"
              >
                Skip
              </Button>
            </div>
          ) : (
            <p className="mt-5 rounded-sm border border-[#67e8f9]/25 bg-[#0891b2]/12 px-3 py-2 text-xs font-black text-[#cffafe]">
              You are watching {shopActor?.name ?? "the shop player"}'s screen. Your controls are locked for this visit.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wider text-[#a89fc5]">
            {isActor ? "You can buy one artifact this visit" : `${shopActor?.name ?? "Player"} can buy one artifact this visit`}
          </p>
          <p className="mt-1 text-[10px] font-bold text-[#d4cfea]/80">
            {sharedArtifactShop ? "This is the same offer list every player is viewing." : "Coins are deducted immediately. Purchase then moves to artifact use."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5 text-[9px] font-black uppercase">
            <span className="rounded-sm border border-[#fde68a]/30 bg-[#f5d547]/10 px-2 py-1 text-[#fde68a]">
              {shopActor?.name ?? "Player"} coins: {actorCoins}
            </span>
            <span className="rounded-sm border border-[#6ee7b7]/40 bg-[#10b981]/15 px-2 py-1 text-[#6ee7b7]">
              {shop.purchasedOfferId ? "Purchase used" : "1 purchase / visit"}
            </span>
          </div>
          {isActor && !shop.purchasedOfferId && (
            <Button
              type="button"
              disabled={busyId === "skip-artifacts"}
              onClick={() => {
                setBusyId("skip-artifacts");
                setStatus("");
                onSkipArtifactShop((res) => {
                  setBusyId(null);
                  setStatus(res.ok ? "Skipped" : res.error);
                  if (res.ok) {
                    onTargetPreview(null);
                    onClose();
                  }
                });
              }}
              className="min-h-9 bg-white/10 px-3 text-[10px] uppercase tracking-wider text-[#d4cfea] hover:bg-white/15 disabled:opacity-45"
            >
              Skip shop
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {shop.offers.map((offer) => {
          const artifact = catalog[offer.artifactId];
          if (!artifact) return null;
          const busy = busyId === offer.id;
          const purchased = shop.purchasedOfferId === offer.id;
          const affordable = actorCoins >= offer.price;
          const buyLabel = purchased
            ? "Bought"
            : shop.purchasedOfferId
              ? "Visit used"
              : affordable
                ? "Buy"
                : "No coins";
          return (
            <ArtifactCard key={offer.id} artifact={artifact} offer={offer} effects={state.effects} rarities={state.artifactRarities}>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-black text-[#fde68a]">
                  <Coins className="size-3.5" />
                  {offer.price}
                </span>
                {isActor && (
                  <Button
                    type="button"
                    disabled={!affordable || Boolean(shop.purchasedOfferId) || busy}
                    data-testid={`artifact-buy-${artifact.id}`}
                    onClick={() => {
                      setBusyId(offer.id);
                      setStatus("");
                      onBuyArtifact(offer.id, (res) => {
                        setBusyId(null);
                        setStatus(res.ok ? (res.requiresTarget ? "Choose target" : "Artifact used") : res.error);
                        if (res.ok) {
                          onAudioTrigger?.("purchase.completed", { playerId: shop.playerId, artifactId: artifact.id, purchaseId: offer.id });
                          if (!res.requiresTarget) {
                            playArtifactUseAudio({
                              actorId: shop.playerId,
                              targetId: artifact.targetMode === "self" ? shop.playerId : undefined,
                              artifactId: artifact.id,
                              onAudioTrigger,
                              onAudioTriggerFirst,
                            });
                            onClose();
                          }
                        }
                      });
                    }}
                    className="min-h-9 bg-[#f5d547] px-3 text-[10px] uppercase text-[#201507] disabled:bg-white/15 disabled:text-white/45"
                  >
                    <ShoppingBag data-icon="inline-start" />
                    {buyLabel}
                  </Button>
                )}
              </div>
            </ArtifactCard>
          );
        })}
      </div>
    </div>
  );
}

function TargetSelector({
  state,
  me,
  actor,
  artifact,
  pendingTargetIds,
  busy,
  onUse,
  onTargetPreview,
}: {
  state: GameState;
  me: Player;
  actor?: Player;
  artifact: ArtifactDef;
  pendingTargetIds: string[];
  busy: boolean;
  onUse: (targetPlayerId: string | undefined) => void;
  onTargetPreview: (playerId: string | null) => void;
}) {
  const targets = pendingTargetIds.flatMap((id) => state.players.find((player) => player.id === id) ?? []);
  const effectsFor = (playerId: string) => state.activeEffects.filter((effect) => effect.targetPlayerId === playerId);
  const isActor = me.id === state.pendingArtifactUse?.playerId;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 rounded-sm border border-[#67e8f9]/25 bg-[#0891b2]/12 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-wider text-[#a5f3fc]">Target selection</p>
            <h3 className="mt-1 truncate text-lg font-black text-white">{artifact.name}</h3>
          </div>
          <Route className="size-5 shrink-0 text-[#67e8f9]" />
        </div>
        <p className="mt-2 text-sm font-bold leading-5 text-[#d4cfea]">{artifact.description}</p>
        <p className="mt-2 rounded-sm border border-white/10 bg-black/20 px-3 py-2 text-xs font-black leading-5 text-[#cffafe]">
          {isActor
            ? "Choose the player who receives this artifact. Everyone else is watching this same target list."
            : `${actor?.name ?? "The shop player"} is choosing who receives this artifact. You are viewing, not controlling, this step.`}
        </p>
      </div>
      <div className="grid gap-2">
        {targets.map((player) => {
          const activeEffects = effectsFor(player.id);
          return (
            <button
              key={player.id}
              type="button"
              disabled={busy || !isActor}
              data-testid={`artifact-target-${player.id}`}
              onMouseEnter={() => onTargetPreview(player.id)}
              onFocus={() => onTargetPreview(player.id)}
              onMouseLeave={() => onTargetPreview(null)}
              onBlur={() => onTargetPreview(null)}
              onClick={() => onUse(player.id)}
              className="grid grid-cols-[0.85rem_minmax(0,1fr)_auto] items-center gap-3 rounded-sm border border-white/10 bg-white/[0.04] p-3 text-left transition hover:border-[#67e8f9]/50 hover:bg-[#67e8f9]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#67e8f9] disabled:opacity-45"
            >
              <span className="size-3 rounded-[2px]" style={{ backgroundColor: player.color }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-white">{player.name}</span>
                <span className="mt-1 flex flex-wrap gap-1 text-[9px] font-black uppercase tracking-wider text-[#a89fc5]">
                  <span className="rounded-sm border border-white/10 bg-black/20 px-2 py-0.5">Cell #{player.position}</span>
                  {activeEffects.map((effect) => (
                    <span key={effect.id} className="rounded-sm border border-cyan-200/25 bg-cyan-300/10 px-2 py-0.5 text-cyan-100">
                      {effect.name}
                    </span>
                  ))}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-[#67e8f9]">
                <Target className="size-3.5" />
                {isActor ? "Use" : "Watching"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ArtifactCard({
  artifact,
  offer,
  effects,
  rarities,
  children,
}: {
  artifact: ArtifactDef;
  offer?: ArtifactOffer;
  effects?: GameState["effects"];
  rarities?: Record<string, ArtifactRarityDef>;
  children?: ReactNode;
}) {
  const rarity = offer?.rarity ?? artifact.rarity;
  const rarityDef = rarities?.[rarity];
  return (
    <article
      data-artifact-shop-item={artifact.id}
      aria-label={`${artifact.name}, ${rarityDef?.name ?? rarity} artifact`}
      className={cn(
        "rounded-md border bg-white/[0.04] p-3",
        rarityDef ? "shadow-[inset_4px_0_0_var(--artifact-rarity-color)]" : rarityCardClass(rarity)
      )}
      style={rarityDef ? artifactRarityCardStyle(rarityDef.color) : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">{artifact.name}</p>
          <p className="mt-1 line-clamp-2 min-h-8 text-xs font-bold leading-4 text-[#d4cfea]">{artifact.description ?? artifact.id}</p>
        </div>
        <ArtifactSwatch artifact={artifact} />
      </div>
      <ActionSummary artifact={artifact} effects={effects} />
      {children}
    </article>
  );
}

function ActionSummary({ artifact, effects }: { artifact: ArtifactDef; effects?: GameState["effects"] }) {
  const actions = artifactActionsForUse(artifact);
  if (!actions.length) return null;
  return (
    <div className="mt-3 grid gap-1">
      {actions.slice(0, 3).map((action, index) => (
        <p key={`${artifact.id}-${action.type}-${index}`} className="rounded-sm border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-bold leading-4 text-[#fff8d6]/85">
          {consequenceLabel(action, (effectId) => effects?.[effectId]?.name ?? effectId)}
        </p>
      ))}
    </div>
  );
}

function playArtifactUseAudio({
  actorId,
  targetId,
  artifactId,
  onAudioTrigger,
  onAudioTriggerFirst,
}: {
  actorId: string;
  targetId?: string;
  artifactId: string;
  onAudioTrigger?: (trigger: AudioTriggerId, context?: Omit<AudioTriggerContext, "trigger">) => void;
  onAudioTriggerFirst?: (triggers: AudioTriggerId[], context?: Omit<AudioTriggerContext, "trigger">) => void;
}) {
  const context = { playerId: actorId, artifactId };
  if (targetId && targetId !== actorId) {
    onAudioTriggerFirst?.(["artifact.sent", "artifact.used"], context);
    onAudioTrigger?.("artifact.received", { playerId: targetId, artifactId });
    return;
  }
  if (targetId === actorId) {
    onAudioTriggerFirst?.(["artifact.used.self", "artifact.used"], context);
    return;
  }
  onAudioTrigger?.("artifact.used", context);
}

function tabClass(active: boolean): string {
  return cn(
    "mb-[-1px] inline-flex min-h-10 items-center gap-2 rounded-t-sm border px-3 text-xs font-black uppercase tracking-wider transition",
    active
      ? "border-white/15 border-b-[#0e0a1a] bg-[#0e0a1a] text-white"
      : "border-transparent text-[#a89fc5] hover:bg-white/5 hover:text-white"
  );
}

function rarityCardClass(rarity: ArtifactOffer["rarity"]): string {
  return cn(
    "shadow-[inset_4px_0_0_rgba(255,255,255,0.12)]",
    rarity === "legendary"
      ? "border-amber-200/55 bg-amber-300/[0.06] shadow-[inset_4px_0_0_rgba(251,191,36,0.72)]"
      : rarity === "epic"
        ? "border-fuchsia-200/45 bg-fuchsia-300/[0.055] shadow-[inset_4px_0_0_rgba(217,70,239,0.68)]"
        : "border-emerald-200/35 bg-emerald-300/[0.045] shadow-[inset_4px_0_0_rgba(52,211,153,0.58)]"
  );
}

function artifactRarityCardStyle(color: string): CSSProperties {
  const stripeColor = hexToRgba(color, 0.72);
  return {
    borderColor: hexToRgba(color, 0.42),
    backgroundColor: hexToRgba(color, 0.06),
    "--artifact-rarity-color": stripeColor,
  } as CSSProperties;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : "34d399";
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function cosmeticAnchorSummary(cosmetic: CosmeticDef): string {
  return cosmeticAnchorRefs(cosmetic)
    .map((anchor) => `${anchor.anchorType}:${anchor.anchorId}`)
    .join(" + ");
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

function ArtifactSwatch({ artifact }: { artifact: ArtifactDef }) {
  const price = artifactPrice(artifact);
  return (
    <span
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-sm border border-white/15 bg-[linear-gradient(135deg,#34d399,#67e8f9)] text-[10px] font-black uppercase text-[#052e1a]"
    >
      {artifact.visual?.label?.slice(0, 2) ?? (price > 0 ? price : artifact.name.slice(0, 2))}
    </span>
  );
}
