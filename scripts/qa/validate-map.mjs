// Valida invariantes del mapa farewell-loop en shared/content.json
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentPath = resolve(__dirname, "../../shared/content.json");
const json = JSON.parse(readFileSync(contentPath, "utf8"));
const map = json.maps.find((m) => m.id === "farewell-loop");
const mapProps = map?.mapProps ?? map?.artifacts ?? [];
const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

ok(json.activeMapId === "farewell-loop", "activeMapId cambió");
ok(map, "falta el mapa farewell-loop");
ok(Array.isArray(json.board) && Array.isArray(map?.board) && JSON.stringify(json.board) === JSON.stringify(map.board), "board raíz no coincide con el mapa activo");

// --- board ids secuenciales, start/finish ---
const board = map.board;
ok(board.length === 54, `cantidad de casilleros fuera de rango: ${board.length}`);
board.forEach((t, i) => ok(t.id === i, `id no secuencial en posición ${i}: ${t.id}`));
const starts = board.filter((t) => t.type === "start");
const finishes = board.filter((t) => t.type === "finish");
ok(starts.length === 1 && starts[0].id === 0, "start inválido");
ok(finishes.length === 1 && finishes[0].id === board.length - 1, "finish inválido");

// --- referencias a catálogos ---
const events = new Set(Object.keys(json.events ?? {}));
for (const t of board) {
  if (t.eventId) ok(events.has(t.eventId), `tile ${t.id}: eventId inexistente ${t.eventId}`);
  ok(t.layout && typeof t.layout.x === "number" && typeof t.layout.y === "number", `tile ${t.id}: layout inválido`);
}

// --- rutas ---
const tileIds = new Set(board.map((t) => t.id));
const routeIds = new Set();
for (const r of map.routes) {
  ok(!routeIds.has(r.id), `ruta duplicada ${r.id}`);
  routeIds.add(r.id);
  ok(tileIds.has(r.from), `ruta ${r.id}: from inexistente ${r.from}`);
  ok(tileIds.has(r.to), `ruta ${r.id}: to inexistente ${r.to}`);
}
for (let i = 0; i < board.length - 1; i++) {
  ok(map.routes.some((r) => r.from === i && r.to === i + 1), `falta ruta ${i}->${i + 1}`);
}

// --- map props ---
const assetIds = new Set(json.assetCatalog.map((a) => a.id));
const artIds = new Set();
for (const a of mapProps) {
  ok(!artIds.has(a.id), `map prop duplicado ${a.id}`);
  artIds.add(a.id);
  ok(assetIds.has(a.assetId), `map prop ${a.id}: assetId inexistente ${a.assetId}`);
}

// --- catálogo de assets: 13 nuevos + kinds válidos + sin duplicados ---
const required = ["fountain", "bench", "palm-tree", "flower-bed", "beach-set", "sailboat", "waterfall", "wedding-arch", "fence", "streetlamp", "rock", "billboard", "bus"];
for (const id of required) ok(assetIds.has(id), `falta asset ${id}`);
ok(assetIds.size === json.assetCatalog.length, "assetCatalog con ids duplicados");
const kinds = new Set(["tree", "house", "court", "vehicle", "mountain", "water", "sign", "plaza", "decor", "custom"]);
for (const a of json.assetCatalog) ok(kinds.has(a.kind), `asset ${a.id}: kind inválido ${a.kind}`);

// --- terrazas ---
const terrIds = new Set();
for (const t of map.terraces) {
  ok(!terrIds.has(t.id), `terraza duplicada ${t.id}`);
  terrIds.add(t.id);
  ok(t.minX <= t.maxX && t.minY <= t.maxY, `terraza ${t.id}: rect inválido`);
  ok(typeof t.elevation === "number", `terraza ${t.id}: sin elevation`);
}

// --- boardShape ---
const s = map.boardShape;
ok(s && s.minX <= s.maxX && s.minY <= s.maxY, "boardShape inválido");
for (const t of board) {
  ok(t.layout.x >= s.minX && t.layout.x <= s.maxX && t.layout.y >= s.minY && t.layout.y <= s.maxY,
    `tile ${t.id} fuera de boardShape (${t.layout.x},${t.layout.y})`);
}

// --- terrenos de rutas válidos ---
const terrains = new Set(["stone", "grass", "sand", "water", "asphalt", "magic"]);
for (const r of map.routes) ok(terrains.has(r.terrain), `ruta ${r.id}: terreno inválido ${r.terrain}`);

// --- resumen ---
const elevationAt = (x, y) => Math.max(0, ...map.terraces.filter((t) => x >= t.minX && x <= t.maxX && y >= t.minY && y <= t.maxY).map((t) => t.elevation));
const typeCount = {};
for (const t of board) typeCount[t.type] = (typeCount[t.type] ?? 0) + 1;
const artCount = {};
for (const a of mapProps) artCount[a.assetId] = (artCount[a.assetId] ?? 0) + 1;

if (errors.length) {
  console.error("ERRORES:\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log("VALIDACIÓN OK");
console.log("cells:", board.length, "| routes:", map.routes.length, "| map props:", mapProps.length, "| terraces:", map.terraces.length, "| assets:", json.assetCatalog.length);
console.log("tipos:", JSON.stringify(typeCount));
console.log("map props:", JSON.stringify(artCount));
console.log("terrazas:", map.terraces.map((t) => `${t.id}@${t.elevation}${t.surface ? "/" + t.surface : ""}${t.color ? "/" + t.color : ""}`).join(", "));
console.log("elevación por casillero:", board.map((t) => `${t.id}:${elevationAt(t.layout.x, t.layout.y)}`).join(" "));
