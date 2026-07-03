import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3055";
const names = ["Javi", "Nico", "FranG"];
const clients = [];
let code = null;
let started = false;
let turns = 0;
const MAX_TURNS = 40;
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
        setTimeout(() => clients[0].socket.emit("game:start"), 200);
      }
    });
  };

  socket.on("minigame:start", (mg) => {
    // cada cliente juega local y reporta
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

  socket.on("state", (state) => {
    const me = state.players.find((p) => p.id === self.id);
    const activeId = state.turnOrder[state.activeIndex];
    const amActive = me && me.id === activeId;
    const amHost = me?.isHost;

    if (state.phase === "turn" && amActive) {
      turns++;
      if (turns > MAX_TURNS) return;
      setTimeout(() => socket.emit("turn:roll"), 60);
    }
    // host avanza desde reveal / event
    if ((state.phase === "reveal" || state.phase === "event") && amHost) {
      setTimeout(() => socket.emit("turn:next"), 120);
    }
    if (state.phase === "finished" && amHost) {
      const ranked = [...state.players].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
      log("\n=== FIN ===");
      ranked.forEach((p, i) =>
        log(`${i + 1}. ${p.name}  ⭐${p.stars} 🪙${p.coins}`)
      );
      log(`\nReveals jugados: ${reveals.length}`);
      // chequeo de rig
      const bostezoRanks = reveals.filter((r) => r.skin === "bostezo");
      const lujanRanks = reveals.filter((r) => r.skin === "lujan");
      const nicoNeverFirstBostezo = bostezoRanks.every((r) => r.ranking[0] !== "nico");
      const frangNeverFirstLujan = lujanRanks.every((r) => r.ranking[0] !== "frang");
      log(`\nRIG bostezo (${bostezoRanks.length} jugados): Nico nunca 1ro = ${nicoNeverFirstBostezo}`);
      log(`RIG lujan (${lujanRanks.length} jugados): FranG nunca 1ro = ${frangNeverFirstLujan}`);
      setTimeout(() => process.exit(0), 200);
    }
  });

  socket.on("minigame:reveal", (r) => {
    if (isCreator) {
      reveals.push(r);
      log(`  [reveal ${r.type}/${r.skin ?? "-"}] 1ro: ${r.entries[0]?.name}`);
    }
  });

  return self;
}

names.forEach((n, i) => clients.push(makeClient(n, i === 0)));

setTimeout(() => {
  log("\n⏰ timeout — no terminó en tiempo");
  process.exit(1);
}, 25000);
