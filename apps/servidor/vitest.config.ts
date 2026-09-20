import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const contratos = fileURLToPath(new URL("../../paquetes/contratos/src/indice.ts", import.meta.url));

export default defineConfig({
  resolve: {
    // Alias explícito: el paquete se consume como fuente TypeScript, sin paso
    // de compilación. Un tipo cambiado se ve al instante en los dos lados.
    alias: { "@cupula/contratos": contratos },
  },
  test: {
    include: ["pruebas/**/*.prueba.ts"],
    // Cada archivo de pruebas trabaja sobre su propia carpeta temporal, así que
    // pueden correr en paralelo sin pisarse.
    environment: "node",
  },
});
