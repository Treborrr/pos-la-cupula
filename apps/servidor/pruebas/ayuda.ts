import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ulid } from "ulid";

import type { EventoNuevo } from "@cupula/contratos";
import { AlmacenArchivoJsonl } from "../src/adaptadores/almacen/ArchivoJsonl";
import { relojFijo } from "../src/puertos/Reloj";

/** Carpeta temporal propia para cada prueba, borrada al terminar. */
export async function carpetaTemporal(prefijo = "pos-cupula-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefijo));
}

export async function borrar(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export { relojFijo };

export async function abrirAlmacen(
  dir: string,
  opciones: { reloj?: ReturnType<typeof relojFijo>; sinBloqueo?: boolean } = {},
): Promise<AlmacenArchivoJsonl> {
  return AlmacenArchivoJsonl.abrir({
    directorio: dir,
    reloj: opciones.reloj,
    sinBloqueo: opciones.sinBloqueo ?? true,
  });
}

/** Un `item.creado` válido, para no repetir el payload en cada prueba. */
export function itemNuevo(codigo = "COR", nombre = "CORTE CLASICO", precio = 2000): EventoNuevo {
  return {
    tipo: "item.creado",
    datos: {
      itemId: ulid(),
      codigo,
      nombre,
      tipo: "SERVICIO",
      categoria: "Barbería",
      precio,
    },
  };
}

export function rutaMes(dir: string, mes: string): string {
  return path.join(dir, "eventos", `${mes}.jsonl`);
}
