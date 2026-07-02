import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { GameContent } from "@essence/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

// content.json vive en /shared y lo edita Javi + amigos sin tocar código.
const CONTENT_PATH = resolve(__dirname, "../../shared/content.json");

export function loadContent(): GameContent {
  const raw = readFileSync(CONTENT_PATH, "utf-8");
  const content = JSON.parse(raw) as GameContent;
  if (!content.board?.length) throw new Error("content.json: board vacío");
  if (content.maps?.length) {
    const activeMap =
      content.maps.find((map) => map.id === content.activeMapId) ??
      content.maps[0];
    if (!activeMap?.board.length) throw new Error("content.json: mapa activo sin board");
    const nodeIds = new Set(activeMap.board.map((tile) => tile.id));
    const brokenRoute = activeMap.routes.find((route) => !nodeIds.has(route.from) || !nodeIds.has(route.to));
    if (brokenRoute) throw new Error(`content.json: ruta ${brokenRoute.id} apunta a un casillero inexistente`);
  }
  if (!content.players?.length) throw new Error("content.json: players vacío");
  return content;
}

export const content = loadContent();
