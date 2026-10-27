/**
 * Sesiones de login, en memoria. Un reinicio del servidor desloguea a todo
 * el mundo — se acepta: en Railway un despliegue no es frecuente, y es la
 * misma filosofía que ya usa el resto del sistema para estado efímero (el
 * lote de alertas pendientes de `ServicioDeNotificaciones`, por ejemplo).
 *
 * El token no va firmado: su propia aleatoriedad (256 bits) es la garantía,
 * y nada que importe vive codificado en la cookie — rol, nombre, lo que sea
 * se busca siempre acá adentro a partir del token. Firmar la cookie no
 * agregaría nada que este diseño ya no tenga.
 */

import { randomBytes } from "node:crypto";

import type { RolUsuario } from "@cupula/contratos";
import type { Reloj } from "../puertos/Reloj";

/** Ventana deslizante: cada pedido válido la corre para adelante. */
const EXPIRA_TRAS_INACTIVIDAD_MS = 8 * 60 * 60 * 1000;

export interface Sesion {
  token: string;
  usuarioId: string;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
  /** En qué local trabaja. Es lo que acota el límite de "un cajero a la vez". */
  sedeId: string;
  ip: string;
  creadaEn: number;
  ultimoUso: number;
}

export class ServicioDeSesiones {
  private readonly sesiones = new Map<string, Sesion>();
  /**
   * sucursal → token del cajero logueado en ESE local. ADMIN no tiene límite.
   *
   * Era un único token global: "una persona de mostrador a la vez" valía
   * cuando había un solo mostrador. Con varias sucursales, un límite global
   * significa que la cajera del segundo local, al entrar, echa al cajero del
   * primero y le corta una venta a la mitad. El mostrador que hay que
   * mantener en uno es el de cada local.
   */
  private readonly cajeroActivoPorSede = new Map<string, string>();

  constructor(private readonly reloj: Reloj) {}

  /**
   * Si `rol` es CAJERO, cierra cualquier otra sesión de cajero abierta EN SU
   * MISMA SUCURSAL: una persona de mostrador a la vez por local, sin importar
   * cuál de las cuentas use. Los cajeros de los otros locales no se tocan.
   */
  crear(datos: {
    usuarioId: string;
    usuario: string;
    nombre: string;
    rol: RolUsuario;
    sedeId: string;
    ip: string;
  }): string {
    const token = randomBytes(32).toString("base64url");
    const ahora = this.reloj.ms();
    this.sesiones.set(token, { token, ...datos, creadaEn: ahora, ultimoUso: ahora });

    if (datos.rol === "CAJERO") {
      const anterior = this.cajeroActivoPorSede.get(datos.sedeId);
      if (anterior && anterior !== token) this.sesiones.delete(anterior);
      this.cajeroActivoPorSede.set(datos.sedeId, token);
    }

    return token;
  }

  /**
   * `null` si no existe o venció de inactividad. Si es válida, corre la
   * ventana (actualiza `ultimoUso`) antes de devolverla.
   */
  obtener(token: string): Sesion | null {
    const s = this.sesiones.get(token);
    if (!s) return null;

    const ahora = this.reloj.ms();
    if (ahora - s.ultimoUso > EXPIRA_TRAS_INACTIVIDAD_MS) {
      this.destruir(token);
      return null;
    }

    s.ultimoUso = ahora;
    return s;
  }

  destruir(token: string): void {
    const sesion = this.sesiones.get(token);
    this.sesiones.delete(token);
    if (sesion && this.cajeroActivoPorSede.get(sesion.sedeId) === token) {
      this.cajeroActivoPorSede.delete(sesion.sedeId);
    }
  }

  /**
   * Para cuando un admin desactiva una cuenta o le resetea la contraseña a
   * alguien: corta el acceso YA, no espera a que la sesión expire sola.
   */
  invalidarPorUsuario(usuarioId: string): void {
    for (const token of [...this.sesiones.keys()]) {
      if (this.sesiones.get(token)?.usuarioId === usuarioId) this.destruir(token);
    }
  }
}
