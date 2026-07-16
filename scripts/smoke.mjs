import { io } from "socket.io-client";
import { rankPlayersForFinishedGame } from "@essence/shared/ranking";

const URL = process.env.URL || "http://localhost:3055";
const names = ["Javi", "Nico", "FranG"];
const clients = [];
let code = null;
let started = false;
let turns = 0;
const MAX_TURNS = 80;
const reveals = [];

function log(...a) {
  console.log(...a);
}

function makeClient(name, isCreator) {
  const socket = io(URL, { transports: ["websocket"] });
  const self = { socket, name, id: null };

  socket.on("connect", () => {
    if (isCreator) {
      socket.emit("room:create", { name, roomName: "Smoke" }, (res) => {
        if (!res.ok) return log("create failed", res.error);
        code = res.code;
        self.id = res.playerId;
        log(`[create] sala ${code} como ${name} (${self.id})`);
        // los demás se unen
        clients.slice(1).forEach((c) => c.join());
      });
    }
  });

  self.join = () => {
    socket.emit("room:join", { code, name }, (res) => {
      if (!res.ok) return log(`[join] ${name} falló: ${res.error}`);
      self.id = res.playerId;
      log(`[join] ${name} entró (${self.id})`);
      if (clients.every((c) => c.id) && !started) {
        started = true;
        setTimeout(() => clients[0].socket.emit("game:start", (res) => {
          if (!res.ok) { log("start failed", res.error); process.exit(1); }
        }), 200);
      }
    });
  };

  socket.on("minigame:start", (mg) => {
    // cada cliente juega local y reporta
    if (mg.type === "cardVote") return;
    let score = Math.random() * 1000;
    let payload = {};
    if (mg.type === "vote") {
      const others = mg.participants.filter((id) => id !== self.id);
      payload = { votedFor: others[0] ?? mg.participants[0] };
      score = 0;
    } else if (mg.type === "judge") {
      payload = { message: `Hola, soy ${name}, ¿un helado?` };
      score = 0;
    } else if (mg.type === "buzzer") {
      payload = { answerIndex: 0, timeMs: Math.random() * 2000, correct: Math.random() > 0.5 };
    } else {
      payload = { value: score };
    }
    setTimeout(() => socket.emit("minigame:result", { score, payload }), 50 + Math.random() * 100);
  });

  socket.on("state", (state) => handleState(socket, self, state));

  socket.on("minigame:reveal", (r) => {
    if (isCreator) {
      reveals.push(r);
      log(`  [reveal ${r.type}/${r.skin ?? "-"}] 1ro: ${r.entries[0]?.name}`);
    }
  });

  return self;
}

function handleState(socket, self, state) {
  const me = state.players.find((player) => player.id === self.id);
  if (!me) return;
  handleTurn(socket, state, me);
  handleShop(socket, state, me);
  handleAdvance(socket, state, me);
  handleMultiStageMinigame(socket, state, me);
  handleFinished(state, me);
}

function handleTurn(socket, state, me) {
  if (state.phase !== "turn" || me.id !== state.turnOrder[state.activeIndex]) return;
  turns++;
  if (turns > MAX_TURNS) return;
  setTimeout(() => socket.emit("turn:roll"), 60);
}

function handleShop(socket, state, me) {
  if (state.phase !== "shop" || me.id !== state.turnOrder[state.activeIndex]) return;
  setTimeout(() => socket.emit("artifact:skipShop", {}, (res) => {
    if (!res.ok) { log("skip shop failed", res.error); process.exit(1); }
  }), 60);
}

function handleAdvance(socket, state, me) {
  if (!["reveal", "event"].includes(state.phase) || !me.isHost) return;
  setTimeout(() => socket.emit("turn:next"), 120);
}

function handleMultiStageMinigame(socket, state, me) {
  if (state.phase !== "minigame") return;
  if (!me.isHost) return;
  if (["cardVote", "judge"].includes(state.activeMinigame.type)) socket.emit("minigame:force");
}

function handleFinished(state, me) {
  if (state.phase !== "finished" || !me.isHost) return;
  const ranked = rankPlayersForFinishedGame(state.players, state.winnerId);
  log("\n=== FIN ===");
  ranked.forEach((player, index) => log(`${index + 1}. ${player.name}  cell ${player.position} 🪙${player.coins}`));
  log(`\nReveals jugados: ${reveals.length}`);
  const bostezoRanks = reveals.filter((reveal) => reveal.skin === "bostezo");
  const lujanRanks = reveals.filter((reveal) => reveal.skin === "lujan");
  const nicoNeverFirstBostezo = bostezoRanks.every((reveal) => reveal.ranking[0] !== "nico");
  const frangNeverFirstLujan = lujanRanks.every((reveal) => reveal.ranking[0] !== "frang");
  log(`\nRIG bostezo (${bostezoRanks.length} jugados): Nico nunca 1ro = ${nicoNeverFirstBostezo}`);
  log(`RIG lujan (${lujanRanks.length} jugados): FranG nunca 1ro = ${frangNeverFirstLujan}`);
  setTimeout(() => process.exit(0), 200);
}

names.forEach((n, i) => clients.push(makeClient(n, i === 0)));

setTimeout(() => {
  log("\n⏰ timeout — no terminó en tiempo");
  process.exit(1);
}, 60000);
