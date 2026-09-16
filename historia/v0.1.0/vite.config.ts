import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const contratos = fileURLToPath(new URL("../../paquetes/contratos/src/indice.ts", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      // El paquete de contratos se consume como fuente TypeScript, sin paso de
      // compilación: un tipo cambiado en el servidor se ve al instante aquí.
      "@cupula/contratos": contratos,
    },
  },
  server: {
    port: 5180,
    // En desarrollo el front corre en su puerto y el API en el 7070. Con este
    // proxy la PWA siempre pega a rutas relativas `/api/...`, igual que en
    // producción, y no hace falta CORS ni variables de entorno distintas.
    proxy: {
      "/api": { target: "http://localhost:7070", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    // La PC objetivo tiene 4 GB: menos JS que parsear es arranque más rápido.
    target: "es2022",
    sourcemap: true,
  },
});
