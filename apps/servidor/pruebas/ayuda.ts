import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ulid } from "ulid";

import type { EventoNuevo } from "@cupula/contratos";
import { AlmacenArchivoJsonl } from "../src/adaptadores/almacen/ArchivoJsonl";
import { relojFijo, type Reloj } from "../src/puertos/Reloj";
import type { EnviadorDeCorreo } from "../src/puertos/EnviadorDeCorreo";
import type { Alerta } from "../src/consultas/alertas";
import type { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeNotificaciones } from "../src/servicios/Notificaciones";

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

/**
 * Doble de prueba de `EnviadorDeCorreo`: no toca la red, guarda cada intento
 * en `enviados` para que la prueba pueda revisar qué se habría mandado, y
 * puede simular una falla con `fallarSiempre`.
 */
export function enviadorDeCorreoFalso(): EnviadorDeCorreo & {
  enviados: { to: string[]; subject: string; html: string }[];
  fallarSiempre: boolean;
} {
  return {
    enviados: [],
    fallarSiempre: false,
    async enviar(datos) {
      this.enviados.push(datos);
      if (this.fallarSiempre) return { ok: false, detalle: "falla simulada" };
      return { ok: true };
    },
  };
}

/**
 * `ServicioDeNotificaciones` de prueba: usa el enviador falso de arriba por
 * defecto y, salvo que se pase `obtenerAlertas`, no reporta ninguna alerta
 * activa — así las pruebas que no son sobre alertas técnicas no las
 * disparan por accidente.
 */
export function notificacionesDePrueba(
  pos: ServicioPos,
  reloj: Reloj = relojFijo(),
  opciones: {
    enviador?: ReturnType<typeof enviadorDeCorreoFalso>;
    obtenerAlertas?: () => Promise<Alerta[]>;
  } = {},
): ServicioDeNotificaciones {
  return new ServicioDeNotificaciones(
    pos,
    reloj,
    opciones.enviador ?? enviadorDeCorreoFalso(),
    opciones.obtenerAlertas ?? (async () => []),
  );
}
