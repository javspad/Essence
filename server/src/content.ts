import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { GameContent } from "@essence/shared";
import { assertValidGameContent } from "@essence/shared/contentValidation";

const __dirname = dirname(fileURLToPath(import.meta.url));

// content.json vive en /shared y lo edita Javi + amigos sin tocar código.
const CONTENT_PATH = resolve(__dirname, "../../shared/content.json");

export function loadContent(): GameContent {
  const raw = readFileSync(CONTENT_PATH, "utf-8");
  return assertValidGameContent(JSON.parse(raw), "content.json");
}

export const content = loadContent();
