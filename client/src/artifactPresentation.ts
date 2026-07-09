import type { ActiveEvent, EffectInstance, Player } from "@essence/shared";

export function artifactUseMessage(event: ActiveEvent, players: Player[], viewerId: string): string | null {
  const use = event.artifactUse;
  if (!use) return null;

  const source = players.find((player) => player.id === use.sourcePlayerId);
  const target = use.targetPlayerId ? players.find((player) => player.id === use.targetPlayerId) : undefined;
  const sourceName = source?.name ?? use.sourcePlayerId;
  const targetName = target?.name ?? use.targetPlayerId;

  if (use.targetPlayerId && use.targetPlayerId === viewerId && use.sourcePlayerId !== viewerId) {
    return `You received ${use.artifactName} from ${sourceName}.`;
  }
  if (use.sourcePlayerId === viewerId && use.targetPlayerId && use.targetPlayerId !== viewerId) {
    return `You applied ${use.artifactName} to ${targetName}.`;
  }
  if (use.sourcePlayerId === viewerId && use.targetPlayerId === viewerId) {
    return `You used ${use.artifactName} on yourself.`;
  }
  if (use.targetPlayerId && targetName && use.targetPlayerId !== use.sourcePlayerId) {
    return `${sourceName} applied ${use.artifactName} to ${targetName}.`;
  }
  return `${sourceName} used ${use.artifactName}.`;
}

export function effectEndedMessage(effect: EffectInstance, players: Player[], viewerId: string, reason: "expired" | "triggered"): string {
  const target = players.find((player) => player.id === effect.targetPlayerId);
  const targetName = target?.id === viewerId ? "You" : target?.name ?? effect.targetPlayerId;
  if (target?.id === viewerId) {
    return reason === "triggered" ? `Your ${effect.name} was used up.` : `Your ${effect.name} expired.`;
  }
  return reason === "triggered" ? `${effect.name} was used up for ${targetName}.` : `${effect.name} expired for ${targetName}.`;
}
