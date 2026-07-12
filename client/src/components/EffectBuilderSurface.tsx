import { Copy, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import type {
  EffectCondition,
  EffectDef,
  EffectDuration,
  EffectDurationState,
  EffectLifecycleHook,
  EffectModifier,
  EventActivityType,
  EventAction,
  EventActionTarget,
  GameContent,
  ImmediateConsequenceDef,
  Phase,
} from "@essence/shared";
import { consequenceLabel, defaultHookForConsequence, effectConsequencesFor, effectHooksFor, effectRemainingLabel } from "@essence/shared/consequences";
import { EVENT_ACTIVITY_TYPES } from "@essence/shared/events";

const DEFAULT_EFFECT_ID = "half-roll-2-rounds";
const LEGACY_SHOT_EFFECT_ID = "half-roll-shot-on-six";

type TargetKind =
  | "landing"
  | "acting"
  | "target"
  | "winner"
  | "loser"
  | "everyone"
  | "player"
  | "rank"
  | "rankRange"
  | "coinRichest"
  | "coinPoorest"
  | "coinRank"
  | "coinRankRange"
  | "nearestAhead"
  | "nearestBehind";
type TargetOverrideKind = "effectTarget" | TargetKind;

const hookOptions: { value: EffectLifecycleHook; label: string }[] = [
  { value: "onTurnStart", label: "Turn start" },
  { value: "onTurnEnd", label: "Turn end" },
  { value: "beforeRoll", label: "Before roll" },
  { value: "afterRoll", label: "After roll" },
  { value: "beforeMovement", label: "Before movement" },
  { value: "afterMovement", label: "After movement" },
  { value: "onCellEnter", label: "Cell enter" },
  { value: "onActivityResult", label: "Activity result" },
];

const phaseOptions: { value: Phase; label: string }[] = [
  { value: "turn", label: "Turn" },
  { value: "moving", label: "Moving" },
  { value: "shop", label: "Shop" },
  { value: "event", label: "Event" },
  { value: "minigame", label: "Minigame" },
  { value: "reveal", label: "Reveal" },
  { value: "lobby", label: "Lobby" },
  { value: "finished", label: "Finished" },
];

export function effectBuilderHref(effectId?: string, from?: string): string {
  const params = new URLSearchParams();
  if (effectId) params.set("effectId", effectId);
  if (from) params.set("from", from);
  const query = params.toString();
  return `/effect-builder${query ? `?${query}` : ""}`;
}

export function nextEffectId(effects: Record<string, EffectDef>): string {
  let index = Object.keys(effects).length + 1;
  let id = `effect-custom-${index}`;
  while (effects[id]) {
    index += 1;
    id = `effect-custom-${index}`;
  }
  return id;
}

export function defaultComposedEffect(id = DEFAULT_EFFECT_ID): EffectDef {
  return {
    id,
    name: "Half movement",
    description: "For 2 rounds, move half of the die roll.",
    icon: "1/2",
    duration: { mode: "rounds", value: 2 },
    consequences: [{ type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", text: "Move half of the die roll.", icon: "1/2" }],
  };
}

export function defaultCustomEffect(id: string): EffectDef {
  return {
    id,
    name: "New effect",
    description: "Custom reusable effect.",
    icon: "FX",
    duration: { mode: "uses", value: 1 },
    consequences: [{ type: "coins", hook: "onTurnEnd", value: 1, text: "Gain 1 coin.", icon: "+" }],
  };
}

export function migrateEffectDraft(content: GameContent): GameContent {
  if (!content.effects?.[LEGACY_SHOT_EFFECT_ID]) return content;
  const { [LEGACY_SHOT_EFFECT_ID]: _legacy, ...restEffects } = content.effects;
  return {
    ...content,
    effects: {
      ...restEffects,
      [DEFAULT_EFFECT_ID]: restEffects[DEFAULT_EFFECT_ID] ?? defaultComposedEffect(),
    },
    events: mapEvents(content.events, rewriteLegacyEffectAction),
    artifacts: content.artifacts
      ? Object.fromEntries(
          Object.entries(content.artifacts).map(([id, artifact]) => [
            id,
            {
              ...artifact,
              consequences: artifact.consequences?.map(rewriteLegacyEffectAction),
              effects: artifact.effects?.map((effectId) => (effectId === LEGACY_SHOT_EFFECT_ID ? DEFAULT_EFFECT_ID : effectId)),
            },
          ])
        )
      : content.artifacts,
    characterTraits: content.characterTraits
      ? Object.fromEntries(
          Object.entries(content.characterTraits).map(([id, trait]) => [
            id,
            {
              ...trait,
              effectId: trait.effectId === LEGACY_SHOT_EFFECT_ID ? DEFAULT_EFFECT_ID : trait.effectId,
            },
          ])
        )
      : content.characterTraits,
  };
}

export function removeEffectFromContent(content: GameContent, effectId: string): GameContent {
  const deletedTraitIds = new Set(
    Object.values(content.characterTraits ?? {})
      .filter((trait) => trait.effectId === effectId)
      .map((trait) => trait.id)
  );
  const { [effectId]: _deleted, ...rawEffects } = content.effects ?? {};
  const effects = Object.fromEntries(Object.entries(rawEffects).map(([id, effect]) => [id, rewriteEffectReferences(effect, effectId)]));
  const characterTraits = content.characterTraits
    ? Object.fromEntries(Object.entries(content.characterTraits).filter(([, trait]) => trait.effectId !== effectId))
    : content.characterTraits;
  return {
    ...content,
    effects,
    events: mapEvents(content.events, (action) => rewriteDeletedEffectAction(action, effectId)),
    artifacts: content.artifacts
      ? Object.fromEntries(
          Object.entries(content.artifacts).map(([id, artifact]) => [
            id,
            {
              ...artifact,
              consequences: artifact.consequences?.map((action) => rewriteDeletedEffectAction(action, effectId)),
              effects: artifact.effects?.filter((id) => id !== effectId),
            },
          ])
        )
      : content.artifacts,
    characterTraits,
    characters: deletedTraitIds.size
      ? Object.fromEntries(
          Object.entries(content.characters ?? {}).map(([id, character]) => [
            id,
            {
              ...character,
              defaultTraits: character.defaultTraits?.filter((traitId) => !deletedTraitIds.has(traitId)),
            },
          ])
        )
      : content.characters,
  };
}

export function EffectBuilderPanel({
  effects,
  selectedEffect,
  selectedEffectId,
  players,
  editorHref,
  onSelect,
  onCreate,
  onDelete,
  onUpdate,
}: {
  effects: Record<string, EffectDef>;
  selectedEffect?: EffectDef;
  selectedEffectId: string;
  players: GameContent["players"];
  editorHref?: string;
  onSelect: (effectId: string) => void;
  onCreate: () => void;
  onDelete: (effectId: string) => void;
  onUpdate: (effectId: string, updater: (effect: EffectDef) => EffectDef) => void;
}) {
  const effectOptions = Object.values(effects).map((effect) => ({ value: effect.id, label: effect.name }));
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.035] p-3" data-effect-builder-panel="true">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-black text-white">Effect builder</h2>
          <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-slate-400">{effectOptions.length} types</p>
        </div>
        {editorHref && (
          <a href={editorHref} className="builder-button compact preview gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Full page
          </a>
        )}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <SelectInput
          label="Effect type"
          value={selectedEffectId}
          disabled={!effectOptions.length}
          options={effectOptions.length ? effectOptions : [{ value: "", label: "No effects yet" }]}
          onChange={onSelect}
        />
        <button type="button" onClick={onCreate} className="mb-0.5 h-9 rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15">
          New
        </button>
      </div>
      {selectedEffect ? (
        <>
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => onDelete(selectedEffect.id)} className="rounded-md border border-rose-200/20 bg-rose-500/10 px-2.5 py-1.5 text-xs font-black text-rose-100 transition hover:bg-rose-500/15">
              Delete effect
            </button>
          </div>
          <EffectCompositionEditor effect={selectedEffect} effects={effects} players={players} compact onChange={(updater) => onUpdate(selectedEffect.id, updater)} />
        </>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-white/10 p-3 text-sm text-slate-400">Create an effect type to use it from consequence actions.</p>
      )}
    </section>
  );
}

export function EffectBuilderSurface({
  effects,
  artifacts = {},
  selectedEffectId,
  players,
  onSelectEffect,
  onCreateEffect,
  onDuplicateEffect,
  onDeleteEffect,
  onUpdateEffect,
}: {
  effects: Record<string, EffectDef>;
  artifacts?: NonNullable<GameContent["artifacts"]>;
  selectedEffectId: string;
  players: GameContent["players"];
  onSelectEffect: (effectId: string) => void;
  onCreateEffect: () => void;
  onDuplicateEffect: (effectId: string) => void;
  onDeleteEffect: (effectId: string) => void;
  onUpdateEffect: (effectId: string, updater: (effect: EffectDef) => EffectDef) => void;
}) {
  const effectList = Object.values(effects).sort((a, b) => a.name.localeCompare(b.name));
  const selectedEffect = selectedEffectId ? effects[selectedEffectId] : undefined;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)_21rem]" data-effect-builder-surface="true">
      <aside className="flex min-h-0 flex-col border-b border-white/10 bg-[#101722] p-3 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-cyan-200">{effectList.length} effects</p>
            <h2 className="truncate text-base font-black text-white">Catalog</h2>
          </div>
          <button type="button" onClick={onCreateEffect} className="builder-button preview h-9 w-9 p-0" aria-label="Create effect">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1 lg:min-h-0 lg:max-h-none lg:flex-1">
          {effectList.map((effect) => {
            const active = effect.id === selectedEffectId;
            return (
              <button
                key={effect.id}
                type="button"
                data-effect-id={effect.id}
                onClick={() => onSelectEffect(effect.id)}
                className={`grid grid-cols-[2rem_minmax(0,1fr)] gap-2 rounded-md border p-2 text-left transition ${
                  active ? "border-cyan-200/70 bg-cyan-300/12" : "border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.06]"
                }`}
              >
                <span className="grid size-8 place-items-center rounded-sm border border-white/10 bg-cyan-300/15 text-[0.62rem] font-black text-cyan-100">
                  {effectIcon(effect)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-white">{effect.name}</span>
                  <span className="mt-1 block truncate text-[0.58rem] font-black uppercase tracking-[0.08em] text-slate-500">
                    {effectRemainingLabel(durationPreview(effect.duration))}
                  </span>
                </span>
              </button>
            );
          })}
          {!effectList.length && <p className="rounded-md border border-dashed border-white/10 p-3 text-sm font-bold text-slate-400">No effects yet.</p>}
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto bg-[#141d29] p-3">
        {selectedEffect ? (
          <EffectCompositionEditor
            effect={selectedEffect}
            effects={effects}
            artifacts={artifacts}
            players={players}
            onChange={(updater) => onUpdateEffect(selectedEffect.id, updater)}
            onDuplicate={() => onDuplicateEffect(selectedEffect.id)}
            onDelete={() => onDeleteEffect(selectedEffect.id)}
          />
        ) : (
          <div className="grid min-h-64 place-items-center rounded-md border border-dashed border-white/10 bg-black/15 p-6 text-center">
            <div>
              <p className="text-sm font-black text-white">Create an effect to start editing.</p>
              <button type="button" onClick={onCreateEffect} className="builder-button preview mt-3 gap-2">
                <Plus className="h-4 w-4" />
                New effect
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#101722] p-3 lg:border-l lg:border-t-0">
        <EffectOverview effect={selectedEffect} effects={effects} />
      </aside>
    </div>
  );
}

function EffectCompositionEditor({
  effect,
  effects,
  artifacts = {},
  players,
  compact,
  onChange,
  onDuplicate,
  onDelete,
}: {
  effect: EffectDef;
  effects: Record<string, EffectDef>;
  artifacts?: NonNullable<GameContent["artifacts"]>;
  players: GameContent["players"];
  compact?: boolean;
  onChange: (updater: (effect: EffectDef) => EffectDef) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const consequences = effectConsequencesFor(effect);
  return (
    <div className={compact ? "mt-3 rounded-md border border-cyan-200/20 bg-cyan-300/10 p-2" : "mx-auto grid max-w-5xl gap-3"}>
      <section className={compact ? "" : "rounded-md border border-white/10 bg-white/[0.035] p-3"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-cyan-200">Effect</p>
            <h2 className="mt-1 truncate text-lg font-black text-white">{effect.name}</h2>
            <p className="mt-1 font-mono text-[0.68rem] font-black text-slate-500">{effect.id}</p>
          </div>
          {!compact && (
            <div className="flex flex-wrap gap-2">
              {onDuplicate && (
                <button type="button" onClick={onDuplicate} className="builder-button gap-2">
                  <Copy className="h-4 w-4" />
                  Duplicate
                </button>
              )}
              {onDelete && (
                <button type="button" onClick={onDelete} className="builder-button danger gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_5rem]">
          <TextInput label="Effect name" value={effect.name} onChange={(name) => onChange((current) => ({ ...current, name: name || current.name }))} />
          <TextInput label="Icon" value={effect.icon ?? ""} onChange={(icon) => onChange((current) => ({ ...current, icon: icon || undefined }))} />
        </div>
        <TextArea label="Description" value={effect.description ?? ""} onChange={(description) => onChange((current) => ({ ...current, description: description || undefined }))} />
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <DurationEditor duration={effect.duration} onChange={(duration) => onChange((current) => ({ ...current, duration }))} />
          <VisualAssetSelect
            artifacts={artifacts}
            value={effect.visualAssetId ?? ""}
            onChange={(visualAssetId) => onChange((current) => ({ ...current, visualAssetId: visualAssetId || undefined }))}
          />
        </div>
      </section>

      <section className={compact ? "mt-3" : "rounded-md border border-white/10 bg-white/[0.035] p-3"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-cyan-200">{consequences.length} actions</p>
            <h3 className="text-base font-black text-white">Consequences</h3>
          </div>
          <button
            type="button"
            onClick={() =>
              onChange((current) => ({
                ...current,
                consequences: [...effectConsequencesFor(current), { type: "movementMultiplier", hook: "beforeMovement", multiplier: 0.5, rounding: "ceil" }],
                actions: undefined,
                modifiers: undefined,
              }))
            }
            className="builder-button preview gap-2"
          >
            <Plus className="h-4 w-4" />
            Add consequence
          </button>
        </div>
        <div className="mt-3 grid gap-2">
          {consequences.map((consequence, index) => (
            <EffectConsequenceRow
              key={`${consequence.type}-${index}`}
              action={consequence}
              effects={effects}
              players={players}
              onChange={(next) =>
                onChange((current) => ({
                  ...current,
                  consequences: effectConsequencesFor(current).map((item, i) => (i === index ? next : item)),
                  actions: undefined,
                  modifiers: undefined,
                }))
              }
              onRemove={() =>
                onChange((current) => {
                  const next = effectConsequencesFor(current).filter((_, i) => i !== index);
                  return {
                    ...current,
                    consequences: next.length ? next : [{ type: "coins", hook: "onTurnEnd", value: 1 }],
                    actions: undefined,
                    modifiers: undefined,
                  };
                })
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function EffectConsequenceRow({
  action,
  effects,
  players,
  onChange,
  onRemove,
}: {
  action: EventAction;
  effects: Record<string, EffectDef>;
  players: GameContent["players"];
  onChange: (action: EventAction) => void;
  onRemove: () => void;
}) {
  const editable = effectEditableAction(action, firstEffectId(effects));
  const selectedEffect = editable.type === "applyEffect" ? effects[editable.effectId] : undefined;
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">{actionSummary(editable, effects)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MetaPill>{hookLabel(hookValueForAction(editable))}</MetaPill>
            <MetaPill>{conditionSummary(editable.when)}</MetaPill>
            {editable.expiresOnTrigger && <MetaPill>Ends on match</MetaPill>}
          </div>
        </div>
        <button type="button" onClick={onRemove} className="builder-button danger compact gap-1.5">
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_5.5rem]">
        <SelectInput
          label="Action"
          value={editable.type}
          options={effectActionTypeOptions(effects)}
          onChange={(type) => onChange(convertActionType(editable, type as Exclude<EventAction["type"], "text">, firstEffectId(effects)))}
        />
        {(editable.type === "coins" || editable.type === "move" || editable.type === "coinTransfer" || editable.type === "coinRedistribute") && (
          <NumberInput
            label={editable.type === "move" ? "Cells" : "Coins"}
            value={editable.type === "coins" ? editable.value : editable.type === "move" ? editable.delta : editable.amount}
            onChange={(value) => onChange(updateActionAmount(editable, value))}
          />
        )}
        {editable.type === "moveTo" && <NumberInput label="Cell" value={editable.tileId} onChange={(tileId) => onChange({ ...editable, tileId })} />}
        {editable.type === "movementMultiplier" && <NumberInput label="x" value={editable.multiplier} onChange={(multiplier) => onChange({ ...editable, multiplier: Math.max(0, multiplier) })} />}
        {editable.type === "diceBias" && <NumberInput label="Face" value={editable.face} onChange={(face) => onChange({ ...editable, face: clampInt(face, 1, 6) })} />}
        {(editable.type === "skipTurn" ||
          editable.type === "extraTurn" ||
          editable.type === "swapPositions" ||
          editable.type === "moveToNearest" ||
          editable.type === "offlineAction" ||
          editable.type === "applyEffect") && <div />}
      </div>

      {(editable.type === "coinTransfer" || editable.type === "coinRedistribute") && (
        <TargetPicker label={editable.type === "coinTransfer" ? "Take from" : "Collect from"} target={editable.from} players={players} onChange={(from) => onChange({ ...editable, from })} />
      )}
      {editable.type === "movementMultiplier" && <RoundingSelect value={editable.rounding ?? "round"} onChange={(rounding) => onChange({ ...editable, rounding })} />}
      {editable.type === "halfMovement" && <RoundingSelect value={editable.rounding ?? "ceil"} onChange={(rounding) => onChange({ ...editable, rounding })} />}
      {editable.type === "diceBias" && <NumberInput label="Chance change percent" value={editable.chanceDeltaPercent} onChange={(chanceDeltaPercent) => onChange({ ...editable, chanceDeltaPercent })} />}
      {editable.type === "swapPositions" && <TargetPicker label="Swap with" target={editable.withTarget} players={players} onChange={(withTarget) => onChange({ ...editable, withTarget })} />}
      {editable.type === "moveToNearest" && (
        <SelectInput
          label="Direction"
          value={editable.direction}
          options={[
            { value: "ahead", label: "Ahead" },
            { value: "behind", label: "Behind" },
          ]}
          onChange={(direction) => onChange({ ...editable, direction: direction as "ahead" | "behind" })}
        />
      )}
      {editable.type === "offlineAction" && (
        <SelectInput
          label="Offline action"
          value={editable.action}
          options={[
            { value: "takeShot", label: "Take shot" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(offlineAction) => onChange({ ...editable, action: offlineAction as "takeShot" | "custom" })}
        />
      )}
      {editable.type === "applyEffect" && (
        <SelectInput
          label="Effect to apply"
          value={editable.effectId}
          options={effectSelectOptions(effects, editable.effectId)}
          onChange={(effectId) => onChange({ ...editable, effectId })}
        />
      )}
      {editable.type === "applyEffect" && selectedEffect && <EffectMiniSummary effect={selectedEffect} />}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SelectInput
          label="Runs"
          value={hookValueForAction(editable)}
          disabled={isModifierEffectAction(editable)}
          options={hookOptionsForAction(editable)}
          onChange={(hook) => onChange({ ...editable, hook: hook as EffectLifecycleHook })}
        />
        <TargetOverrideEditor action={editable} players={players} onChange={onChange} />
      </div>

      <ConditionEditor
        condition={editable.when}
        expiresOnTrigger={editable.expiresOnTrigger}
        onConditionChange={(when) => onChange({ ...editable, when })}
        onExpiresOnTriggerChange={(expiresOnTrigger) => onChange({ ...editable, expiresOnTrigger: expiresOnTrigger || undefined })}
      />
      <TextInput label="Display text" value={editable.text ?? ""} onChange={(text) => onChange(updateActionText(editable, text))} />
      <details className="mt-3 rounded-md border border-white/10 bg-black/20 p-2">
        <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-300">JSON</summary>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/25 p-2 text-[0.65rem] text-slate-300">{JSON.stringify(editable, null, 2)}</pre>
      </details>
    </div>
  );
}

function TargetOverrideEditor({
  action,
  players,
  onChange,
}: {
  action: EventAction;
  players: GameContent["players"];
  onChange: (action: EventAction) => void;
}) {
  const target = "target" in action ? action.target : undefined;
  const kind = target ? targetKind(target) : "effectTarget";
  return (
    <div>
      <SelectInput
        label="Target"
        value={kind}
        options={[
          { value: "effectTarget", label: "Effect holder" },
          { value: "landing", label: "Triggering player" },
          { value: "acting", label: "Acting player" },
          { value: "target", label: "Selected target" },
          { value: "winner", label: "Winner" },
          { value: "loser", label: "Loser" },
          { value: "coinRichest", label: "Richest player" },
          { value: "coinPoorest", label: "Poorest player" },
          { value: "coinRank", label: "Coin rank" },
          { value: "coinRankRange", label: "Coin rank range" },
          { value: "nearestAhead", label: "Nearest ahead" },
          { value: "nearestBehind", label: "Nearest behind" },
          { value: "everyone", label: "Everyone" },
          { value: "player", label: "Specific player" },
          { value: "rank", label: "Rank" },
          { value: "rankRange", label: "Rank range" },
        ]}
        onChange={(value) => {
          if (value === "effectTarget") {
            const { target: _target, ...rest } = action as EventAction & { target?: EventActionTarget };
            onChange(rest as EventAction);
            return;
          }
          onChange({ ...action, target: targetForKind(value as TargetKind, players, target ?? "target") } as EventAction);
        }}
      />
      <p className="mt-2 text-[0.68rem] font-bold leading-4 text-slate-500">{targetHelp(kind)}</p>
      {target && <TargetDetails target={target} players={players} onChange={(nextTarget) => onChange({ ...action, target: nextTarget } as EventAction)} />}
    </div>
  );
}

function TargetPicker({
  label,
  target,
  players,
  onChange,
}: {
  label: string;
  target: EventActionTarget;
  players: GameContent["players"];
  onChange: (target: EventActionTarget) => void;
}) {
  const kind = targetKind(target);
  return (
    <div className="mt-3 rounded-md border border-white/10 bg-black/15 p-2">
      <SelectInput
        label={label}
        value={kind}
        options={[
          { value: "winner", label: "Winner" },
          { value: "loser", label: "Loser" },
          { value: "landing", label: "Triggering player" },
          { value: "acting", label: "Acting player" },
          { value: "target", label: "Selected target" },
          { value: "coinRichest", label: "Richest player" },
          { value: "coinPoorest", label: "Poorest player" },
          { value: "coinRank", label: "Coin rank" },
          { value: "coinRankRange", label: "Coin rank range" },
          { value: "nearestAhead", label: "Nearest ahead" },
          { value: "nearestBehind", label: "Nearest behind" },
          { value: "everyone", label: "Everyone" },
          { value: "player", label: "Specific player" },
          { value: "rank", label: "Rank" },
          { value: "rankRange", label: "Rank range" },
        ]}
        onChange={(value) => onChange(targetForKind(value as TargetKind, players, target))}
      />
      <TargetDetails target={target} players={players} onChange={onChange} />
    </div>
  );
}

function TargetDetails({ target, players, onChange }: { target: EventActionTarget; players: GameContent["players"]; onChange: (target: EventActionTarget) => void }) {
  const kind = targetKind(target);
  if (kind === "player") {
    return (
      <SelectInput
        label="Player"
        value={playerIdForTarget(target, players)}
        options={players.map((player) => ({ value: player.id, label: player.name }))}
        onChange={(playerId) => onChange({ playerId })}
      />
    );
  }
  if (kind === "rank") {
    return <NumberInput label="Rank" value={rankFromFor(target)} onChange={(rank) => onChange({ rank: Math.max(1, Math.round(rank)) })} />;
  }
  if (kind === "coinRank") {
    return <NumberInput label="Coin rank" value={rankFromFor(target)} onChange={(coinRank) => onChange({ coinRank: Math.max(1, Math.round(coinRank)) })} />;
  }
  if (kind === "rankRange") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="From rank" value={rankFromFor(target)} onChange={(rankFrom) => onChange({ rankFrom: Math.max(1, Math.round(rankFrom)), rankTo: rankToFor(target) })} />
        <NumberInput label="To rank" value={rankToFor(target)} onChange={(rankTo) => onChange({ rankFrom: rankFromFor(target), rankTo: Math.max(1, Math.round(rankTo)) })} />
      </div>
    );
  }
  if (kind === "coinRankRange") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="From coin rank" value={rankFromFor(target)} onChange={(coinRankFrom) => onChange({ coinRankFrom: Math.max(1, Math.round(coinRankFrom)), coinRankTo: rankToFor(target) })} />
        <NumberInput label="To coin rank" value={rankToFor(target)} onChange={(coinRankTo) => onChange({ coinRankFrom: rankFromFor(target), coinRankTo: Math.max(1, Math.round(coinRankTo)) })} />
      </div>
    );
  }
  return null;
}

function ConditionEditor({
  condition,
  expiresOnTrigger,
  onConditionChange,
  onExpiresOnTriggerChange,
}: {
  condition?: EffectCondition;
  expiresOnTrigger?: boolean;
  onConditionChange: (condition: EffectCondition | undefined) => void;
  onExpiresOnTriggerChange: (expiresOnTrigger: boolean) => void;
}) {
  const enabled = Boolean(condition);
  const update = (patch: Partial<EffectCondition>) => onConditionChange(cleanCondition({ ...(condition ?? {}), ...patch }));
  return (
    <details className="mt-3 rounded-md border border-white/10 bg-black/15 p-2" open={enabled}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-300">Conditions</span>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onConditionChange(enabled ? undefined : {});
          }}
          className="builder-button compact"
        >
          {enabled ? "Clear" : "Add"}
        </button>
      </summary>
      {enabled && (
        <div className="mt-3 grid gap-3">
          <p className="rounded-md border border-cyan-200/15 bg-cyan-300/10 p-2 text-[0.68rem] font-bold leading-4 text-cyan-50/80">
            Conditions are gates. The action only runs when every filled value matches the current hook; empty fields are ignored.
          </p>
          <div className="rounded-md border border-white/10 bg-black/15 p-2">
            <p className="text-xs font-black text-slate-200">Current roll or movement</p>
            <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-500">Use these for effects that react to the die roll or the movement amount from the current turn.</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <OptionalNumberInput label="Roll equals" value={condition?.rollEquals} onChange={(rollEquals) => update({ rollEquals })} />
              <OptionalNumberInput label="Roll at least" value={condition?.rollGte} onChange={(rollGte) => update({ rollGte })} />
              <OptionalNumberInput label="Roll at most" value={condition?.rollLte} onChange={(rollLte) => update({ rollLte })} />
            </div>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <OptionalNumberInput label="Move at least" value={condition?.movementGte} onChange={(movementGte) => update({ movementGte })} />
              <OptionalNumberInput label="Move at most" value={condition?.movementLte} onChange={(movementLte) => update({ movementLte })} />
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-black/15 p-2">
            <p className="text-xs font-black text-slate-200">Board context</p>
            <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-500">Phase limits the board moment; cell tags match tags on the cell being entered.</p>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <TextInput
                label="Cell tags"
                value={condition?.cellTagsAny?.join(", ") ?? ""}
                onChange={(value) => update({ cellTagsAny: splitTags(value) })}
              />
            <OptionalSelectInput
              label="Phase"
              value={condition?.phase}
              options={phaseOptions}
              onChange={(phase) => update({ phase: phase as Phase | undefined })}
            />
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-black/15 p-2">
            <p className="text-xs font-black text-slate-200">Activity result</p>
            <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-500">Match the effect owner's resolved rank and optionally include or exclude activity types.</p>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <OptionalNumberInput label="Rank at least" value={condition?.rankingPositionGte} onChange={(rankingPositionGte) => update({ rankingPositionGte })} />
              <OptionalNumberInput label="Rank at most" value={condition?.rankingPositionLte} onChange={(rankingPositionLte) => update({ rankingPositionLte })} />
              <TextInput
                label="Include activity types"
                value={condition?.activityTypesAny?.join(", ") ?? ""}
                onChange={(value) => update({ activityTypesAny: splitActivityTypes(value) })}
              />
              <TextInput
                label="Exclude activity types"
                value={condition?.activityTypesNone?.join(", ") ?? ""}
                onChange={(value) => update({ activityTypesNone: splitActivityTypes(value) })}
              />
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-black/15 p-2">
            <p className="text-xs font-black text-slate-200">Recent roll streak</p>
            <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-500">Checks the target player's last rolls. Count is how many recent rolls must all satisfy the limits.</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <OptionalNumberInput label="Consecutive count" value={condition?.consecutiveRolls?.count} onChange={(count) => update({ consecutiveRolls: cleanConsecutiveRolls({ ...(condition?.consecutiveRolls ?? {}), count }) })} />
              <OptionalNumberInput label="Each at least" value={condition?.consecutiveRolls?.atLeast} onChange={(atLeast) => update({ consecutiveRolls: cleanConsecutiveRolls({ ...(condition?.consecutiveRolls ?? {}), atLeast }) })} />
              <OptionalNumberInput label="Each at most" value={condition?.consecutiveRolls?.atMost} onChange={(atMost) => update({ consecutiveRolls: cleanConsecutiveRolls({ ...(condition?.consecutiveRolls ?? {}), atMost }) })} />
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-black/15 p-2">
            <p className="text-xs font-black text-slate-200">Recent movement total</p>
            <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-500">Adds the target player's last movements across the chosen number of turns.</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <OptionalNumberInput label="Total turns" value={condition?.movementTotal?.turns} onChange={(turns) => update({ movementTotal: cleanMovementTotal({ ...(condition?.movementTotal ?? {}), turns }) })} />
              <OptionalNumberInput label="Total at least" value={condition?.movementTotal?.gte} onChange={(gte) => update({ movementTotal: cleanMovementTotal({ ...(condition?.movementTotal ?? {}), gte }) })} />
              <OptionalNumberInput label="Total at most" value={condition?.movementTotal?.lte} onChange={(lte) => update({ movementTotal: cleanMovementTotal({ ...(condition?.movementTotal ?? {}), lte }) })} />
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-black/15 p-2">
            <p className="text-xs font-black text-slate-200">Recent roll total</p>
            <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-500">Adds the target player's last die results across the chosen number of turns.</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <OptionalNumberInput label="Total turns" value={condition?.rollTotal?.turns} onChange={(turns) => update({ rollTotal: cleanRollTotal({ ...(condition?.rollTotal ?? {}), turns }) })} />
              <OptionalNumberInput label="Total at least" value={condition?.rollTotal?.gte} onChange={(gte) => update({ rollTotal: cleanRollTotal({ ...(condition?.rollTotal ?? {}), gte }) })} />
              <OptionalNumberInput label="Total at most" value={condition?.rollTotal?.lte} onChange={(lte) => update({ rollTotal: cleanRollTotal({ ...(condition?.rollTotal ?? {}), lte }) })} />
            </div>
          </div>
          <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-cyan-200/15 bg-cyan-300/10 px-3 py-2">
            <input type="checkbox" checked={Boolean(expiresOnTrigger)} onChange={(event) => onExpiresOnTriggerChange(event.target.checked)} className="mt-0.5 size-4 accent-cyan-300" />
            <span>
              <span className="block text-xs font-black uppercase tracking-[0.1em] text-cyan-50">End effect when this action matches</span>
              <span className="mt-1 block text-[0.68rem] font-bold normal-case leading-4 tracking-normal text-cyan-50/70">
                When this consequence runs, the whole effect is removed even if its duration still has time left. If the effect uses Uses 1, this has the same end result.
              </span>
            </span>
          </label>
        </div>
      )}
    </details>
  );
}

function EffectOverview({ effect, effects }: { effect?: EffectDef; effects: Record<string, EffectDef> }) {
  if (!effect) {
    return (
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <h2 className="text-sm font-black text-white">Overview</h2>
        <p className="mt-2 text-xs font-bold leading-5 text-slate-400">Select an effect to inspect hooks, conditions, and JSON.</p>
      </section>
    );
  }
  const consequences = effectConsequencesFor(effect);
  const hooks = effectHooksFor(effect);
  return (
    <div className="grid gap-3">
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-md border border-cyan-200/20 bg-cyan-300/10 text-xs font-black text-cyan-100">{effectIcon(effect)}</span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black text-white">{effect.name}</h2>
            <p className="mt-1 text-xs font-bold leading-5 text-slate-400">{effect.description ?? "No description."}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <MetaPill>{effectRemainingLabel(durationPreview(effect.duration))}</MetaPill>
          {hooks.map((hook) => (
            <MetaPill key={hook}>{hookLabel(hook)}</MetaPill>
          ))}
        </div>
      </section>
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <h2 className="text-sm font-black text-white">Action map</h2>
        <div className="mt-3 grid gap-2">
          {consequences.map((action, index) => (
            <div key={`${action.type}-${index}`} className="rounded-sm border border-cyan-200/15 bg-cyan-300/10 p-2">
              <p className="text-xs font-black text-white">{actionSummary(action, effects)}</p>
              <p className="mt-1 text-[0.6rem] font-black uppercase tracking-[0.08em] text-cyan-100">
                {hookLabel(hookValueForAction(action))} · {conditionSummary(action.when)}
              </p>
            </div>
          ))}
          {!consequences.length && <p className="rounded-sm border border-dashed border-white/10 p-2 text-xs font-bold text-slate-500">No consequences.</p>}
        </div>
      </section>
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <h2 className="text-sm font-black text-white">JSON</h2>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/25 p-2 text-[0.65rem] leading-4 text-slate-300">{JSON.stringify(effect, null, 2)}</pre>
      </section>
    </div>
  );
}

function EffectMiniSummary({ effect }: { effect: EffectDef }) {
  return (
    <div className="mt-3 rounded-md border border-cyan-200/20 bg-cyan-300/10 p-2">
      <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-cyan-100">{effect.name}</p>
      <p className="mt-1 text-[0.68rem] font-bold leading-4 text-slate-400">{effect.description ?? "Reusable effect."}</p>
    </div>
  );
}

function VisualAssetSelect({
  artifacts,
  value,
  onChange,
}: {
  artifacts: NonNullable<GameContent["artifacts"]>;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = artifactVisualOptions(artifacts, value);
  return (
    <div>
      <SelectInput label="Visual artifact" value={value} options={options} onChange={onChange} />
      <p className="mt-2 text-[0.68rem] font-bold leading-4 text-slate-500">
        Optional visual cue shown while this effect is active. This references the artifact's visual only; it does not buy, apply, or re-trigger that artifact.
      </p>
    </div>
  );
}

function RoundingSelect({ value, onChange }: { value: "floor" | "ceil" | "round"; onChange: (value: "floor" | "ceil" | "round") => void }) {
  return (
    <SelectInput
      label="Rounding"
      value={value}
      options={[
        { value: "round", label: "Round" },
        { value: "ceil", label: "Ceil" },
        { value: "floor", label: "Floor" },
      ]}
      onChange={(rounding) => onChange(rounding as "floor" | "ceil" | "round")}
    />
  );
}

function DurationEditor({ duration, onChange }: { duration: EffectDuration; onChange: (duration: EffectDuration) => void }) {
  const needsCount = duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses";
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_5.5rem]">
        <SelectInput
          label="Duration"
          value={duration.mode}
          options={[
            { value: "uses", label: "Uses" },
            { value: "rounds", label: "Rounds" },
            { value: "turns", label: "Turns" },
            { value: "game", label: "Whole game" },
          ]}
          onChange={(mode) => onChange(durationForMode(mode as EffectDuration["mode"], duration))}
        />
        {needsCount ? <NumberInput label="Count" value={duration.value} onChange={(value) => onChange({ ...duration, value: Math.max(1, Math.round(value)) } as EffectDuration)} /> : <div />}
      </div>
      <div className="mt-2 rounded-md border border-white/10 bg-black/15 p-2 text-[0.68rem] font-bold leading-4 text-slate-400">
        <p className="text-xs font-black text-slate-200">{durationModeLabel(duration.mode)}</p>
        <p className="mt-1">{durationHelp(duration.mode)}</p>
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-cyan-300/60" />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-20 w-full resize-y rounded-md border border-white/10 bg-[#0b1118] px-3 py-2 text-sm font-bold normal-case leading-6 text-slate-100 outline-none focus:border-cyan-300/60" />
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <input type="number" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-cyan-300/60" />
    </label>
  );
}

function OptionalNumberInput({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void }) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <input
        type="number"
        value={value ?? ""}
        placeholder="Any"
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-cyan-300/60"
      />
    </label>
  );
}

function OptionalSelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-cyan-300/60"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#0b1118] text-slate-100">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[0.62rem] font-black uppercase tracking-wider text-slate-400">
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#0b1118] px-3 text-sm font-bold normal-case text-slate-100 outline-none focus:border-cyan-300/60 disabled:opacity-45"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#0b1118] text-slate-100">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetaPill({ children }: { children: string }) {
  return <span className="max-w-full truncate rounded-sm border border-cyan-200/20 bg-cyan-300/10 px-2 py-1 text-[0.62rem] font-black uppercase text-cyan-100">{children}</span>;
}

function mapEvents(
  events: GameContent["events"],
  mapAction: (action: ImmediateConsequenceDef) => ImmediateConsequenceDef
): GameContent["events"] {
  if (!events) return events;
  return Object.fromEntries(
    Object.entries(events).map(([id, event]) => [
      id,
      {
        ...event,
        consequences: event.consequences?.map((rule) => ({
          ...rule,
          actions: rule.actions.map(mapAction),
        })),
        activity: event.activity
          ? {
              ...event.activity,
              rankingPayout: event.activity.rankingPayout
                ? {
                    ...event.activity.rankingPayout,
                    consequences: event.activity.rankingPayout.consequences?.map((rule) => ({
                      ...rule,
                      actions: rule.actions.map(mapAction),
                    })),
                  }
                : undefined,
            }
          : undefined,
      },
    ])
  );
}

function rewriteLegacyEffectAction<T extends EventAction>(action: T): T {
  if (action.type !== "applyEffect" || action.effectId !== LEGACY_SHOT_EFFECT_ID) return action;
  return { ...action, effectId: DEFAULT_EFFECT_ID } as T;
}

function rewriteEffectReferences(effect: EffectDef, deletedEffectId: string): EffectDef {
  return {
    ...effect,
    consequences: effect.consequences?.map((action) => rewriteDeletedEffectAction(action, deletedEffectId)),
    actions: effect.actions?.map((action) => rewriteDeletedEffectAction(action, deletedEffectId)),
    modifiers: effect.modifiers?.map((modifier) => rewriteDeletedEffectModifier(modifier, deletedEffectId)),
  };
}

function rewriteDeletedEffectModifier(modifier: EffectModifier, deletedEffectId: string): EffectModifier {
  if (modifier.type !== "conditionalConsequences") return modifier;
  return {
    ...modifier,
    consequences: modifier.consequences.map((action) => rewriteDeletedEffectAction(action, deletedEffectId)),
  };
}

function rewriteDeletedEffectAction<T extends EventAction>(action: T, deletedEffectId: string): T {
  if (action.type !== "applyEffect" || action.effectId !== deletedEffectId) return action;
  return {
    type: "coins",
    value: 1,
    text: action.text,
    ...("target" in action && action.target ? { target: action.target } : {}),
  } as T;
}

function firstEffectId(effects: Record<string, EffectDef>): string {
  return Object.keys(effects)[0] ?? DEFAULT_EFFECT_ID;
}

function effectIcon(effect: EffectDef): string {
  return (effect.icon ?? effect.name.slice(0, 2) ?? "FX").slice(0, 4).toUpperCase();
}

function effectSelectOptions(effects: Record<string, EffectDef>, selectedEffectId: string): { value: string; label: string }[] {
  const options = Object.values(effects).map((effect) => ({ value: effect.id, label: effect.name }));
  if (selectedEffectId && !effects[selectedEffectId]) options.push({ value: selectedEffectId, label: `Missing: ${selectedEffectId}` });
  return options.length ? options : [{ value: DEFAULT_EFFECT_ID, label: "No effects" }];
}

function effectActionTypeOptions(effects: Record<string, EffectDef>): { value: string; label: string }[] {
  return [
    { value: "coins", label: "Coins" },
    { value: "coinTransfer", label: "Coin transfer" },
    { value: "coinRedistribute", label: "Coin redistribution" },
    { value: "move", label: "Move" },
    { value: "moveTo", label: "Move to cell" },
    { value: "skipTurn", label: "Skip turn" },
    { value: "extraTurn", label: "Extra turn" },
    { value: "halfMovement", label: "Half movement" },
    { value: "movementMultiplier", label: "Movement multiplier" },
    { value: "diceBias", label: "Dice bias" },
    { value: "swapPositions", label: "Swap positions" },
    { value: "moveToNearest", label: "Move to nearest" },
    { value: "offlineAction", label: "Offline action" },
    ...(Object.keys(effects).length ? [{ value: "applyEffect", label: "Apply another effect" }] : []),
  ];
}

function actionSummary(action: EventAction, effects: Record<string, EffectDef>): string {
  return consequenceLabel(action, (effectId) => effects[effectId]?.name ?? effectId);
}

function durationPreview(duration: EffectDef["duration"]): EffectDurationState {
  if (duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses") return { mode: duration.mode, remaining: duration.value };
  return { mode: duration.mode };
}

function durationValue(duration: EffectDef["duration"]): number {
  return duration.mode === "turns" || duration.mode === "rounds" || duration.mode === "uses" ? duration.value : 1;
}

function durationModeLabel(mode: EffectDuration["mode"]): string {
  if (mode === "uses") return "Uses";
  if (mode === "rounds") return "Rounds";
  if (mode === "turns") return "Turns";
  return "Whole game";
}

function durationHelp(mode: EffectDuration["mode"]): string {
  if (mode === "uses") return "Decrements each time one of this effect's consequences actually triggers. Use 1 for a next-trigger one-shot.";
  if (mode === "rounds") return "Ticks down only when the game advances to a later round.";
  if (mode === "turns") return "Ticks down at the target player's turn end, skipping the turn where it was first attached.";
  return "Stays active until the game ends or the effect is removed by another rule.";
}

function artifactVisualOptions(artifacts: NonNullable<GameContent["artifacts"]>, selectedValue: string): { value: string; label: string }[] {
  const options = Object.values(artifacts).flatMap((artifact) => {
    const values = new Map<string, string>();
    values.set(artifact.id, artifact.name);
    if (artifact.visual?.assetId) values.set(artifact.visual.assetId, `${artifact.name} visual`);
    if (artifact.visualAssetId) values.set(artifact.visualAssetId, `${artifact.name} legacy visual`);
    return [...values].map(([value, label]) => ({ value, label }));
  });
  if (selectedValue && !options.some((option) => option.value === selectedValue)) {
    options.push({ value: selectedValue, label: `Missing: ${selectedValue}` });
  }
  return [{ value: "", label: "No visual artifact" }, ...options.sort((a, b) => a.label.localeCompare(b.label))];
}

function durationForMode(mode: EffectDuration["mode"], previous: EffectDuration): EffectDuration {
  if (mode === "turns" || mode === "rounds" || mode === "uses") return { mode, value: durationValue(previous) };
  return { mode };
}

function effectEditableAction(action: EventAction, fallbackEffectId: string): EventAction {
  if (action.type === "text") return { type: "coins", hook: "onTurnEnd", value: 1, text: action.text };
  if (action.type === "applyEffect" && !action.effectId) return { ...action, effectId: fallbackEffectId };
  return isModifierEffectAction(action) ? ensureModifierTiming(action) : action;
}

function convertActionType(action: EventAction, type: Exclude<EventAction["type"], "text">, fallbackEffectId: string): EventAction {
  const text = "text" in action ? action.text : undefined;
  const target = "target" in action ? action.target : undefined;
  const icon = action.icon;
  const amount = action.type === "coins" ? action.value : action.type === "move" ? action.delta : action.type === "coinTransfer" || action.type === "coinRedistribute" ? action.amount : 1;
  const from = "from" in action ? action.from : target ?? "target";
  const base = { ...(target ? { target } : {}), ...(text ? { text } : {}), ...(icon ? { icon } : {}), ...timingPatch(action) };
  if (type === "coins") return withCanonicalEditableAction({ type, value: amount, ...base });
  if (type === "coinTransfer") return withCanonicalEditableAction({ type, amount: Math.max(0, amount), from, ...base });
  if (type === "coinRedistribute") return withCanonicalEditableAction({ type, amount: Math.max(0, amount), from, ...base });
  if (type === "move") return withCanonicalEditableAction({ type, delta: amount, ...base });
  if (type === "moveTo") return withCanonicalEditableAction({ type, tileId: 1, ...base });
  if (type === "skipTurn") return withCanonicalEditableAction({ type, ...base });
  if (type === "extraTurn") return withCanonicalEditableAction({ type, ...base });
  if (type === "offlineAction") return withCanonicalEditableAction({ type, action: "custom", ...base });
  if (type === "halfMovement") return ensureModifierTiming({ type, hook: "beforeMovement", rounding: "ceil", ...base });
  if (type === "movementMultiplier") return ensureModifierTiming({ type, hook: "beforeMovement", multiplier: 0.5, rounding: "ceil", ...base });
  if (type === "diceBias") return ensureModifierTiming({ type, hook: "beforeRoll", face: 5, chanceDeltaPercent: 10, ...base });
  if (type === "swapPositions") return withCanonicalEditableAction({ type, withTarget: "winner", ...base });
  if (type === "moveToNearest") return withCanonicalEditableAction({ type, direction: "ahead", ...base });
  if (type === "moveToPlayerPosition") return withCanonicalEditableAction({ type, withTarget: "winner", ...base });
  return { type: "applyEffect", effectId: fallbackEffectId, ...(target ? { target } : {}), ...(text ? { text } : {}), ...(icon ? { icon } : {}), ...timingPatch(action) };
}

function withCanonicalEditableAction(action: EventAction): EventAction {
  return isModifierEffectAction(action) ? ensureModifierTiming(action) : action;
}

function updateActionAmount(action: Extract<EventAction, { type: "coins" | "move" | "coinTransfer" | "coinRedistribute" }>, amount: number): EventAction {
  if (action.type === "coins") return { ...action, value: amount };
  if (action.type === "coinTransfer" || action.type === "coinRedistribute") return { ...action, amount: Math.max(0, amount) };
  return { ...action, delta: amount };
}

function updateActionText(action: EventAction, text: string): EventAction {
  if (action.type === "text") return { ...action, text };
  return { ...action, text: text || undefined };
}

function isModifierEffectAction(action: EventAction): boolean {
  return action.type === "halfMovement" || action.type === "movementMultiplier" || action.type === "diceBias";
}

function ensureModifierTiming(action: EventAction): EventAction {
  if (!isModifierEffectAction(action)) return action;
  return {
    ...action,
    hook: defaultHookForConsequence(action.type),
  } as EventAction;
}

function timingPatch(action: EventAction): {
  hook?: EventAction["hook"];
  when?: EventAction["when"];
  expiresOnTrigger?: boolean;
} {
  return {
    ...(action.hook ? { hook: action.hook } : {}),
    ...(action.when ? { when: action.when } : {}),
    ...(action.expiresOnTrigger !== undefined ? { expiresOnTrigger: action.expiresOnTrigger } : {}),
  };
}

function hookValueForAction(action: EventAction): NonNullable<EventAction["hook"]> {
  return isModifierEffectAction(action) ? defaultHookForConsequence(action.type) : action.hook ?? defaultHookForConsequence(action.type);
}

function hookOptionsForAction(action: EventAction): { value: EffectLifecycleHook; label: string }[] {
  if (!isModifierEffectAction(action)) return hookOptions;
  const hook = defaultHookForConsequence(action.type);
  return hookOptions.filter((option) => option.value === hook);
}

function hookLabel(hook: EffectLifecycleHook): string {
  return hookOptions.find((option) => option.value === hook)?.label ?? hook;
}

function targetHelp(kind: TargetOverrideKind): string {
  if (kind === "effectTarget") return "The action affects the player who currently has this effect.";
  if (kind === "landing") return "The player who triggered the current board cell or event.";
  if (kind === "acting") return "The player whose action is currently being resolved.";
  if (kind === "target") return "The selected target from an artifact or event, when one exists.";
  if (kind === "winner") return "The first player in the resolved activity ranking.";
  if (kind === "loser") return "The last player in the resolved activity ranking.";
  if (kind === "everyone") return "Every connected player in the room.";
  if (kind === "coinRichest") return "The connected player with the most coins.";
  if (kind === "coinPoorest") return "The connected player with the fewest coins.";
  if (kind === "coinRank") return "One position in the current coin ranking.";
  if (kind === "coinRankRange") return "A range of positions in the current coin ranking.";
  if (kind === "player") return "One authored player/character slot.";
  if (kind === "rank") return "One position in the resolved activity ranking.";
  if (kind === "rankRange") return "A range of positions in the resolved activity ranking.";
  if (kind === "nearestAhead") return "The closest player ahead of the acting player on the board.";
  return "The closest player behind the acting player on the board.";
}

function conditionSummary(condition: EffectCondition | undefined): string {
  if (!condition || Object.keys(condition).length === 0) return "Always";
  const parts = [
    condition.rollEquals !== undefined ? `roll = ${condition.rollEquals}` : undefined,
    condition.rollGte !== undefined ? `roll >= ${condition.rollGte}` : undefined,
    condition.rollLte !== undefined ? `roll <= ${condition.rollLte}` : undefined,
    condition.movementGte !== undefined ? `move >= ${condition.movementGte}` : undefined,
    condition.movementLte !== undefined ? `move <= ${condition.movementLte}` : undefined,
    condition.cellTagsAny?.length ? `tags: ${condition.cellTagsAny.join(", ")}` : undefined,
    condition.activityTypesAny?.length ? `activity: ${condition.activityTypesAny.join(", ")}` : undefined,
    condition.activityTypesNone?.length ? `not activity: ${condition.activityTypesNone.join(", ")}` : undefined,
    condition.rankingPositionGte !== undefined ? `rank >= ${condition.rankingPositionGte}` : undefined,
    condition.rankingPositionLte !== undefined ? `rank <= ${condition.rankingPositionLte}` : undefined,
    condition.phase ? `phase: ${condition.phase}` : undefined,
    condition.consecutiveRolls ? `roll streak ${condition.consecutiveRolls.count}` : undefined,
    condition.movementTotal ? `move total ${condition.movementTotal.turns}` : undefined,
    condition.rollTotal ? `roll total ${condition.rollTotal.turns}` : undefined,
  ].filter(Boolean);
  return parts.join(", ");
}

function targetKind(target: EventActionTarget): TargetKind {
  if (target === "landing" || target === "acting" || target === "target" || target === "winner" || target === "loser" || target === "everyone") return target;
  if ("playerId" in target) return "player";
  if ("rank" in target) return "rank";
  if ("coinSelector" in target) return target.coinSelector === "richest" ? "coinRichest" : "coinPoorest";
  if ("coinRank" in target) return "coinRank";
  if ("coinRankFrom" in target) return "coinRankRange";
  if ("nearest" in target) return target.nearest === "ahead" ? "nearestAhead" : "nearestBehind";
  return "rankRange";
}

function targetForKind(kind: TargetKind, players: GameContent["players"], previous: EventActionTarget): EventActionTarget {
  if (kind === "landing" || kind === "acting" || kind === "target" || kind === "winner" || kind === "loser" || kind === "everyone") return kind;
  if (kind === "nearestAhead") return { nearest: "ahead", from: "acting" };
  if (kind === "nearestBehind") return { nearest: "behind", from: "acting" };
  if (kind === "coinRichest") return { coinSelector: "richest" };
  if (kind === "coinPoorest") return { coinSelector: "poorest" };
  if (kind === "player") return { playerId: playerIdForTarget(previous, players) };
  if (kind === "rank") return { rank: rankFromFor(previous) };
  if (kind === "coinRank") return { coinRank: rankFromFor(previous) };
  if (kind === "coinRankRange") return { coinRankFrom: rankFromFor(previous), coinRankTo: rankToFor(previous) };
  return { rankFrom: rankFromFor(previous), rankTo: rankToFor(previous) };
}

function playerIdForTarget(target: EventActionTarget, players: GameContent["players"]): string {
  return typeof target !== "string" && "playerId" in target ? target.playerId : players[0]?.id ?? "";
}

function rankFromFor(target: EventActionTarget): number {
  if (typeof target !== "string" && "rankFrom" in target) return target.rankFrom;
  if (typeof target !== "string" && "rank" in target) return target.rank;
  if (typeof target !== "string" && "coinRankFrom" in target) return target.coinRankFrom;
  if (typeof target !== "string" && "coinRank" in target) return target.coinRank;
  return 1;
}

function rankToFor(target: EventActionTarget): number {
  if (typeof target !== "string" && "rankFrom" in target) return target.rankTo;
  if (typeof target !== "string" && "rank" in target) return target.rank;
  if (typeof target !== "string" && "coinRankFrom" in target) return target.coinRankTo;
  if (typeof target !== "string" && "coinRank" in target) return target.coinRank;
  return 2;
}

function cleanCondition(condition: EffectCondition): EffectCondition | undefined {
  const next: EffectCondition = {};
  if (condition.rollEquals !== undefined) next.rollEquals = condition.rollEquals;
  if (condition.rollGte !== undefined) next.rollGte = condition.rollGte;
  if (condition.rollLte !== undefined) next.rollLte = condition.rollLte;
  if (condition.movementGte !== undefined) next.movementGte = condition.movementGte;
  if (condition.movementLte !== undefined) next.movementLte = condition.movementLte;
  if (condition.cellTagsAny?.length) next.cellTagsAny = condition.cellTagsAny;
  if (condition.activityTypesAny?.length) next.activityTypesAny = condition.activityTypesAny;
  if (condition.activityTypesNone?.length) next.activityTypesNone = condition.activityTypesNone;
  if (condition.rankingPositionGte !== undefined) next.rankingPositionGte = Math.max(1, Math.round(condition.rankingPositionGte));
  if (condition.rankingPositionLte !== undefined) next.rankingPositionLte = Math.max(1, Math.round(condition.rankingPositionLte));
  if (condition.phase) next.phase = condition.phase;
  if (condition.consecutiveRolls) next.consecutiveRolls = condition.consecutiveRolls;
  if (condition.movementTotal) next.movementTotal = condition.movementTotal;
  if (condition.rollTotal) next.rollTotal = condition.rollTotal;
  return Object.keys(next).length ? next : {};
}

function cleanConsecutiveRolls(condition: Partial<NonNullable<EffectCondition["consecutiveRolls"]>>): EffectCondition["consecutiveRolls"] | undefined {
  if (condition.count === undefined && condition.atLeast === undefined && condition.atMost === undefined) return undefined;
  return {
    count: Math.max(1, Math.round(condition.count ?? 1)),
    ...(condition.atLeast !== undefined ? { atLeast: condition.atLeast } : {}),
    ...(condition.atMost !== undefined ? { atMost: condition.atMost } : {}),
  };
}

function cleanMovementTotal(condition: Partial<NonNullable<EffectCondition["movementTotal"]>>): EffectCondition["movementTotal"] | undefined {
  if (condition.turns === undefined && condition.gte === undefined && condition.lte === undefined) return undefined;
  return {
    turns: Math.max(1, Math.round(condition.turns ?? 1)),
    ...(condition.gte !== undefined ? { gte: condition.gte } : {}),
    ...(condition.lte !== undefined ? { lte: condition.lte } : {}),
  };
}

function cleanRollTotal(condition: Partial<NonNullable<EffectCondition["rollTotal"]>>): EffectCondition["rollTotal"] | undefined {
  if (condition.turns === undefined && condition.gte === undefined && condition.lte === undefined) return undefined;
  return {
    turns: Math.max(1, Math.round(condition.turns ?? 1)),
    ...(condition.gte !== undefined ? { gte: condition.gte } : {}),
    ...(condition.lte !== undefined ? { lte: condition.lte } : {}),
  };
}

function splitActivityTypes(value: string): EventActivityType[] | undefined {
  const activityTypes = value
    .split(",")
    .map((type) => type.trim())
    .filter((type): type is EventActivityType => EVENT_ACTIVITY_TYPES.includes(type as EventActivityType));
  return activityTypes.length ? [...new Set(activityTypes)] : undefined;
}

function splitTags(value: string): string[] | undefined {
  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length ? tags : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
