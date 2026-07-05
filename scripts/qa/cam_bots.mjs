/** Dos bots juegan por socket para que un viewer de Playwright filme la cámara. */
import { createRequire } from "module";
import { writeFileSync } from "fs";
const require = createRequire("/Users/javi/Code/Essence/scripts/smoke.mjs");
const { io } = require("socket.io-client");

const URL = "http://localhost:3001";
const CODE_FILE = "/private/tmp/claude-501/-Users-javi-Code-Essence/77c70f6d-9268-4897-adb8-b00316fd9de6/scratchpad/room_code.txt";
let code = null;
let started = false;

setTimeout(() => process.exit(0), 45000);

function bot(name, isCreator) {
  const socket = io(URL, { transports: ["websocket"] });
  const self = { socket, name, id: null, isHost: isCreator };

  socket.on("connect", () => {
    if (isCreator) {
      socket.emit("room:create", { name, roomName: "CamTest" }, (res) => {
        if (!res.ok) { console.error("create fail", res.error); process.exit(1); }
        code = res.code;
        self.id = res.playerId;
        writeFileSync(CODE_FILE, code);
        console.log("code:", code);
        setTimeout(() => bot("Nico", false), 400);
      });
    } else {
      socket.emit("room:join", { code, name }, (res) => {
        if (res.ok) self.id = res.playerId;
      });
    }
  });

  socket.on("minigame:start", () => {
    setTimeout(() => socket.emit("minigame:result", { score: Math.random() * 100, payload: {} }), 900);
  });

  socket.on("state", (state) => {
    const me = state.players.find((p) => p.id === self.id);
    if (!me) return;
    // Arranca cuando el viewer (3er jugador) entró
    if (isCreator && !started && state.phase === "lobby" && state.players.length >= 3) {
      started = true;
      setTimeout(() => socket.emit("game:start"), 1200);
    }
    const activeId = state.turnOrder[state.activeIndex];
    if (state.phase === "turn" && me.id === activeId) {
      setTimeout(() => socket.emit("turn:roll"), 2600); // deja respirar la toma general
    }
    if ((state.phase === "reveal" || state.phase === "event") && me.isHost) {
      setTimeout(() => socket.emit("turn:next"), 2400);
    }
    // El viewer no juega minijuegos: el host cierra a la fuerza para que sigan los turnos
    if (state.phase === "minigame" && me.isHost) {
      setTimeout(() => socket.emit("minigame:force"), 2600);
    }
  });
}

bot("Javi", true);
