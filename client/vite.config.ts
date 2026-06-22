import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    // permitir importar /shared (fuera de la raíz del cliente)
    fs: { allow: [".."] },
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});
