import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const backendPort = process.env.API_PORT ?? process.env.SERVER_PORT ?? process.env.PORT ?? "3001";
const backendTarget = process.env.VITE_API_TARGET ?? `http://localhost:${backendPort}`;
const clientPort = Number(process.env.CLIENT_PORT ?? process.env.VITE_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      "/socket.io": { target: backendTarget, ws: true },
      "/api": { target: backendTarget },
    },
  },
});
