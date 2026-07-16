import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { normalizeContentSchema, validateGameContent } from "../shared/contentValidation";
import { isDeveloperToolsEnabled } from "../shared/devTools";
import {
  ContentPayloadTooLargeError,
  isLoopbackAddress,
  readUtf8Body,
} from "./src/devContentSaveBoundary";

const CONTENT_FILE_PATH = resolve(__dirname, "../shared/content.json");
const MAX_SAVE_BYTES = 10_000_000;

const backendPort = process.env.API_PORT ?? process.env.SERVER_PORT ?? process.env.PORT ?? "3001";
const backendTarget = process.env.VITE_API_TARGET ?? `http://localhost:${backendPort}`;
const clientPort = Number(process.env.CLIENT_PORT ?? process.env.VITE_PORT ?? 5173);
const developerToolsEnabled = isDeveloperToolsEnabled(process.env.ENABLE_DEV_TOOLS);

export default defineConfig({
  define: {
    "import.meta.env.ESSENCE_DEV_TOOLS": JSON.stringify(developerToolsEnabled),
  },
  plugins: [...(developerToolsEnabled ? [localContentSavePlugin()] : []), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "../shared"),
    },
  },
  server: {
    // Accesible desde cualquier dispositivo de la LAN (no solo localhost).
    host: true,
    port: clientPort,
    // permitir importar /shared (fuera de la raíz del cliente)
    fs: { allow: [".."] },
    proxy: {
      "/api": { target: backendTarget },
    },
  },
});

function localContentSavePlugin(): Plugin {
  return {
    name: "essence-local-content-save",
    configureServer(server) {
      server.middlewares.use("/api/dev/content", async (req, res) => {
        if (!isLoopbackAddress(req.socket.remoteAddress)) {
          sendJson(res, 403, { ok: false, error: "Local content writes require a loopback connection." });
          return;
        }

        if (req.method === "OPTIONS") {
          sendJson(res, 204, {});
          return;
        }

        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Use POST to save local content." });
          return;
        }

        const contentLength = Number(req.headers["content-length"] ?? 0);
        if (contentLength > MAX_SAVE_BYTES) {
          sendJson(res, 413, { ok: false, error: "Content payload is too large." });
          return;
        }

        try {
          const body = await readUtf8Body(req, MAX_SAVE_BYTES);
          const parsed = JSON.parse(body);
          const validation = validateGameContent(parsed);
          if (!validation.ok) {
            sendJson(res, 400, {
              ok: false,
              error: "Content validation failed.",
              errors: validation.errors,
              warnings: validation.warnings,
            });
            return;
          }

          const normalized = normalizeContentSchema(parsed);
          const json = `${JSON.stringify(normalized, null, 2)}\n`;
          await writeFile(CONTENT_FILE_PATH, json, "utf8");
          sendJson(res, 200, {
            ok: true,
            path: CONTENT_FILE_PATH,
            bytes: Buffer.byteLength(json),
            warnings: validation.warnings,
          });
        } catch (error) {
          if (error instanceof ContentPayloadTooLargeError) {
            sendJson(res, 413, { ok: false, error: error.message });
            return;
          }
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : "Unable to save local content.",
          });
        }
      });
    },
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
