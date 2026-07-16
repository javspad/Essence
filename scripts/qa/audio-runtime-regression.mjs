import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.ESSENCE_CLIENT_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const ReactModule = await import("/@id/react");
    const React = ReactModule.default ?? ReactModule;
    const ReactDOM = (await import("/@id/react-dom/client")).default;
    const { AudioTriggerProvider, useAudioRuntime } = await import("/src/audio.tsx");
    const voices = [];

    class FakeAudio extends EventTarget {
      constructor(src) {
        super();
        this.src = src;
        this.paused = true;
        this.currentTime = 0;
        this.duration = 60;
        this.readyState = 1;
        voices.push(this);
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }

      pause() {
        this.paused = true;
      }
    }

    window.Audio = FakeAudio;
    const host = document.getElementById("root");
    host.replaceChildren();
    const oneAsset = { one: { id: "one", name: "One", src: "/one.mp3" } };
    const oneBinding = {
      trigger: "minigame.music",
      category: "music",
      playback: "oneShot",
      variants: [{ assetId: "one" }],
    };
    let refreshBindings;

    function RefreshPlayer() {
      const audio = useAudioRuntime();
      React.useEffect(() => {
        audio.unlock();
        void audio.play("minigame.music", { minigameId: "event-1", playbackId: "event-1:1000" });
        return () => audio.stop("minigame.music");
      }, [audio.play, audio.stop, audio.unlock]);
      return null;
    }

    function RefreshHarness() {
      const [bindings, setBindings] = React.useState([oneBinding]);
      refreshBindings = () => setBindings([{ ...oneBinding, variants: [...oneBinding.variants] }]);
      return React.createElement(
        AudioTriggerProvider,
        { assets: { ...oneAsset }, bindings },
        React.createElement(RefreshPlayer)
      );
    }

    const refreshRoot = ReactDOM.createRoot(host);
    refreshRoot.render(React.createElement(RefreshHarness));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const beforeRefresh = voices.filter((voice) => !voice.paused).length;
    refreshBindings();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterRefresh = voices.filter((voice) => !voice.paused).length;
    refreshRoot.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterUnmount = voices.filter((voice) => !voice.paused).length;

    const results = [];
    const assets = Object.fromEntries(
      ["one", "two", "three"].map((id) => [id, { id, name: id, src: `/${id}.mp3` }])
    );
    const binding = {
      trigger: "minigame.music",
      category: "music",
      playback: "oneShot",
      variants: [
        { assetId: "one", weight: 1 },
        { assetId: "two", weight: 1 },
        { assetId: "three", weight: 1 },
      ],
    };

    function SyncedPlayer({ client }) {
      const audio = useAudioRuntime();
      React.useEffect(() => {
        audio.unlock();
        void audio.play("minigame.music", {
          minigameId: "event-050",
          playbackId: "event-050:authoritative-start",
        }).then((value) => results.push({ client, value }));
      }, [audio.play, audio.unlock, client]);
      return null;
    }

    const syncRoots = [1, 2].map((client) => {
      const node = document.createElement("div");
      host.append(node);
      const root = ReactDOM.createRoot(node);
      root.render(React.createElement(
        AudioTriggerProvider,
        { assets: { ...assets }, bindings: [{ ...binding, variants: [...binding.variants] }] },
        React.createElement(SyncedPlayer, { client })
      ));
      return root;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    syncRoots.forEach((root) => root.unmount());

    return {
      beforeRefresh,
      afterRefresh,
      afterUnmount,
      createdDuringRefresh: voices.length - 2,
      selectedAssets: results
        .sort((left, right) => left.client - right.client)
        .map((entry) => entry.value.assetId),
    };
  });

  assert.equal(result.beforeRefresh, 1, "one minigame music voice starts");
  assert.equal(result.afterRefresh, 1, "a fresh multiplayer state does not duplicate minigame music");
  assert.equal(result.afterUnmount, 0, "leaving the minigame stops one-shot music too");
  assert.equal(result.selectedAssets.length, 2, "both simulated clients played a cue");
  assert.equal(result.selectedAssets[0], result.selectedAssets[1], "both clients selected the same weighted variant");
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
