/**
 * Freno a los intentos fallidos de login, en memoria — defensa en profundidad
 * además del límite por IP (`@fastify/rate-limit`) en la ruta.
 *
 * A propósito NO es un evento en el log: el login de ADMIN no tiene
 * restricción de red (tiene que poder entrar desde cualquier lado, es el
 * blanco más expuesto de todo el sistema), así que cada bot escaneando
 * internet dejaría un intento fallido para siempre en un log pensado para
 * hechos de negocio. Se resetea solo al reiniciar — igual que las sesiones.
 */

import type { Reloj } from "../puertos/Reloj";

const TOPE_FALLOS_CONSECUTIVOS = 5;
const VENTANA_DE_BLOQUEO_MS = 15 * 60 * 1000;

interface Registro {
  fallosConsecutivos: number;
  bloqueadoHasta: number | null;
}

export class ServicioDeIntentosDeLogin {
  private readonly registros = new Map<string, Registro>();

  constructor(private readonly reloj: Reloj) {}

  /** Se consulta por el HANDLE tecleado, exista o no la cuenta: una cuenta inexistente también se puede sondear a fuerza bruta. */
  estaBloqueado(handle: string): boolean {
    const r = this.registros.get(handle);
    if (!r?.bloqueadoHasta) return false;
    if (this.reloj.ms() >= r.bloqueadoHasta) {
      this.registros.delete(handle);
      return false;
    }
    return true;
  }

  registrarFallo(handle: string): void {
    const r = this.registros.get(handle) ?? { fallosConsecutivos: 0, bloqueadoHasta: null };
    r.fallosConsecutivos += 1;
    if (r.fallosConsecutivos >= TOPE_FALLOS_CONSECUTIVOS) {
      r.bloqueadoHasta = this.reloj.ms() + VENTANA_DE_BLOQUEO_MS;
    }
    this.registros.set(handle, r);
  }

  registrarExito(handle: string): void {
    this.registros.delete(handle);
  }
}
