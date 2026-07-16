import { io } from "socket.io-client";

const URL = "http://localhost:3001";
const socket = io(URL, { transports: ["websocket"] });

socket.on("connect", () => {
  socket.emit("room:create", { name: "ZoneCheck", roomName: "ZoneCheck" }, (res) => {
    if (!res.ok) { console.log("create failed", res.error); process.exit(1); }
    const code = res.code;
    // Join a second client to receive the broadcast state
    const b = io(URL, { transports: ["websocket"] });
    b.on("state", (state) => {
      console.log("GameState.terrainZones:", state.terrainZones?.length ?? "MISSING");
      console.log("biomes:", state.terrainZones?.map((z) => z.biome) ?? "MISSING");
      console.log("theme:", state.theme ?? "MISSING");
      console.log("mapId:", state.mapId);
      b.close();
      socket.close();
      process.exit(0);
    });
    b.emit("room:join", { code, name: "Checker" }, () => {
      // start the game so a state broadcast fires with the active map
      socket.emit("game:start", (start) => {
        if (!start.ok) { console.log("start failed", start.error); process.exit(1); }
      });
    });
  });
});

setTimeout(() => { console.log("timeout"); process.exit(1); }, 8000);
