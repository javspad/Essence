import { lazy, Suspense } from "react";
import { useGame } from "./useGame";
import JoinScreen from "./components/JoinScreen";
import ConnectedGame from "./components/ConnectedGame";
import { Badge } from "@/components/ui/8bit/badge";
import { developerToolsEnabled } from "./featureFlags";

const MapBuilder = lazy(() => import("./components/MapBuilder"));
const EventBuilder = lazy(() => import("./components/EventBuilder"));
const MediaAssetLibrary = lazy(() => import("./components/MediaAssetLibrary"));
const CharacterBuilder = lazy(() => import("./components/CharacterBuilder"));
const CosmeticBuilder = lazy(() => import("./components/CosmeticBuilder"));
const ArtifactBuilder = lazy(() => import("./components/ArtifactBuilder"));
const EffectBuilder = lazy(() => import("./components/EffectBuilder"));
const SoundBuilder = lazy(() => import("./components/SoundBuilder"));
const ToolsHub = lazy(() => import("./components/ToolsHub"));

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const developerFeaturesEnabled = developerToolsEnabled();
  const builderMode =
    developerFeaturesEnabled && (path === "/map-builder" || search.has("mapBuilder"));
  const eventBuilderMode = developerFeaturesEnabled && (path === "/event-builder" || search.has("eventBuilder"));
  const mediaAssetLibraryMode = developerFeaturesEnabled && (path === "/asset-library" || search.has("assetLibrary"));
  const characterBuilderMode = developerFeaturesEnabled && (path === "/character-builder" || search.has("characterBuilder"));
  const cosmeticBuilderMode = developerFeaturesEnabled && (path === "/cosmetic-builder" || search.has("cosmeticBuilder"));
  const artifactBuilderMode = developerFeaturesEnabled && (path === "/artifact-builder" || search.has("artifactBuilder"));
  const effectBuilderMode = developerFeaturesEnabled && (path === "/effect-builder" || search.has("effectBuilder"));
  const soundBuilderMode = developerFeaturesEnabled && (path === "/sound-builder" || path === "/audio-tool" || search.has("soundBuilder") || search.has("audioTool"));
  const toolsMode = developerFeaturesEnabled && path === "/tools";

  if (toolsMode) {
    return (
      <Suspense fallback={<SceneLoading code="TOOLS" />}>
        <ToolsHub />
      </Suspense>
    );
  }

  if (builderMode) {
    return (
      <Suspense fallback={<SceneLoading code="MAP" />}>
        <MapBuilder />
      </Suspense>
    );
  }

  if (eventBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="EVNT" />}>
        <EventBuilder />
      </Suspense>
    );
  }

  if (mediaAssetLibraryMode) {
    return (
      <Suspense fallback={<SceneLoading code="ASST" />}>
        <MediaAssetLibrary />
      </Suspense>
    );
  }

  if (characterBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="CHAR" />}>
        <CharacterBuilder />
      </Suspense>
    );
  }

  if (cosmeticBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="COSM" />}>
        <CosmeticBuilder />
      </Suspense>
    );
  }

  if (artifactBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="ARTF" />}>
        <ArtifactBuilder />
      </Suspense>
    );
  }

  if (effectBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="FX" />}>
        <EffectBuilder />
      </Suspense>
    );
  }

  if (soundBuilderMode) {
    return (
      <Suspense fallback={<SceneLoading code="SND" />}>
        <SoundBuilder />
      </Suspense>
    );
  }

  return <GameApp showDeveloperTools={developerFeaturesEnabled} />;
}

function GameApp({ showDeveloperTools }: { showDeveloperTools: boolean }) {
  const { connected, state, me, activeId, isHost, error, effectNotices, dismissEffectNotice, actions } = useGame();

  // Sin identidad todavía → pantalla de ingreso.
  if (!state || !me) {
    return (
      <>
        {!connected && <ConnBadge connected={connected} />}
        <JoinScreen error={error} showDeveloperTools={showDeveloperTools} onCreate={actions.create} onJoin={actions.join} />
      </>
    );
  }

  return (
    <ConnectedGame
      connected={connected}
      state={state}
      me={me}
      activeId={activeId}
      isHost={isHost}
      error={error}
      effectNotices={effectNotices}
      onDismissEffectNotice={dismissEffectNotice}
      actions={actions}
    />
  );
}

function SceneLoading({ code }: { code: string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-950 text-sm font-bold tracking-[0.3em] text-amber-300">
      SALA {code} · CARGANDO 3D
    </div>
  );
}

function ConnBadge({ connected, code, roomName }: { connected: boolean; code?: string; roomName?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-white/60">
      <span>{code ? `${roomName ?? "Sala"} · ${code}` : "Despedida de Javi"}</span>
      <Badge className={connected ? "border-[#a7f3d0] bg-[#34d399] px-2 py-1 text-[9px] text-[#062116]" : "border-[#fecaca] bg-[#fb7185] px-2 py-1 text-[9px] text-[#2a070b]"}>
        {connected ? "● en línea" : "● reconectando..."}
      </Badge>
    </div>
  );
}
