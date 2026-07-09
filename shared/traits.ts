import type { CharacterDef, CharacterTraitDef, CharacterTraitSummary, EffectDef, GameContent } from "./types";

export interface ResolvedCharacterTrait {
  trait: CharacterTraitDef;
  effect: EffectDef;
}

export function characterTraitForContent(content: GameContent, traitId: string): CharacterTraitDef | undefined {
  return content.characterTraits?.[traitId];
}

export function resolveCharacterTrait(content: GameContent, traitId: string): ResolvedCharacterTrait | undefined {
  const trait = characterTraitForContent(content, traitId);
  const effect = trait ? content.effects?.[trait.effectId] : undefined;
  return trait && effect ? { trait, effect } : undefined;
}

export function characterTraitSummariesForIds(content: GameContent, traitIds: string[] | undefined): CharacterTraitSummary[] | undefined {
  const summaries = uniqueTraitIds(traitIds).flatMap((traitId) => {
    const resolved = resolveCharacterTrait(content, traitId);
    return resolved ? [characterTraitSummary(resolved.trait, resolved.effect)] : [];
  });
  return summaries.length ? summaries : undefined;
}

export function characterDefaultTraitSummaries(content: GameContent, character: CharacterDef): CharacterTraitSummary[] | undefined {
  return characterTraitSummariesForIds(content, character.defaultTraits);
}

export function characterTraitSummary(trait: CharacterTraitDef, effect: EffectDef): CharacterTraitSummary {
  return {
    id: trait.id,
    name: trait.name || effect.name,
    description: trait.description ?? effect.description,
    effectId: trait.effectId,
    effectName: effect.name,
    duration: { ...effect.duration },
    icon: trait.icon ?? effect.icon,
  };
}

function uniqueTraitIds(traitIds: string[] | undefined): string[] {
  return [...new Set((traitIds ?? []).map((traitId) => traitId.trim()).filter(Boolean))];
}
