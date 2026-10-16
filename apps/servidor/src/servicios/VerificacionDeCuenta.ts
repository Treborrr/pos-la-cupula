/**
 * El código de 6 dígitos que confirma un cambio de "Mi cuenta" (nombre,
 * correo, teléfono y/o contraseña, todo junto en un solo pedido).
 *
 * En memoria, igual que `ServicioDeSesiones` y `ServicioDeIntentosDeLogin`:
 * un reinicio del servidor descarta cualquier pedido a medio confirmar — se
 * acepta, una ventana de 15 minutos no sobrevivir un redeploy no es grave, y
 * quien lo pidió solo tiene que volver a pedir el código.
 *
 * Nada de esto toca el log hasta que el código es correcto: `solicitar` NO
 * escribe ningún evento, solo guarda el pedido pendiente y devuelve el
 * código para que la ruta lo mande por correo.
 */

import { randomInt, timingSafeEqual } from "node:crypto";

import type { Reloj } from "../puertos/Reloj";

const VENCE_TRAS_MS = 15 * 60 * 1000;
const TOPE_INTENTOS_FALLIDOS = 5;

export interface CambiosPendientes {
  nombre?: string;
  correo?: string;
  telefono?: string;
  /** Ya hasheada — ver `seguridad/contrasenas.ts`. Nunca texto plano. */
  hashNuevo?: string;
}

interface Pendiente {
  codigo: string;
  destinatario: string;
  cambios: CambiosPendientes;
  venceEn: number;
  intentosFallidos: number;
}

export class ServicioDeVerificacionDeCuenta {
  private readonly pendientes = new Map<string, Pendiente>();

  constructor(private readonly reloj: Reloj) {}

  /** Reemplaza cualquier pedido anterior de la misma cuenta — pedir un código nuevo descarta el viejo. */
  solicitar(usuarioId: string, destinatario: string, cambios: CambiosPendientes): string {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pendientes.set(usuarioId, {
      codigo,
      destinatario,
      cambios,
      venceEn: this.reloj.ms() + VENCE_TRAS_MS,
      intentosFallidos: 0,
    });
    return codigo;
  }

  /**
   * `null` si no hay pedido, venció, o el código está mal. Un código mal
   * tecleado repetidas veces agota el pedido entero (hay que pedir uno
   * nuevo) — mismo criterio que el bloqueo de `/auth/login`.
   */
  confirmar(usuarioId: string, codigo: string): CambiosPendientes | null {
    const p = this.pendientes.get(usuarioId);
    if (!p) return null;

    if (this.reloj.ms() > p.venceEn) {
      this.pendientes.delete(usuarioId);
      return null;
    }

    if (!igual(codigo, p.codigo)) {
      p.intentosFallidos++;
      if (p.intentosFallidos >= TOPE_INTENTOS_FALLIDOS) this.pendientes.delete(usuarioId);
      return null;
    }

    this.pendientes.delete(usuarioId);
    return p.cambios;
  }
}

function igual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
