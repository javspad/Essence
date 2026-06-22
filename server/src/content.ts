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
  if (!content.players?.length) throw new Error("content.json: players vacío");
  return content;
}

export const content = loadContent();
