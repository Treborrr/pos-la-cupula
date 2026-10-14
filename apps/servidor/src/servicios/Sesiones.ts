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
  ip: string;
  creadaEn: number;
  ultimoUso: number;
}

export class ServicioDeSesiones {
  private readonly sesiones = new Map<string, Sesion>();
  /** Token de la única sesión de CAJERO activa, si hay alguna. ADMIN no tiene este límite. */
  private cajeroActivo: string | null = null;

  constructor(private readonly reloj: Reloj) {}

  /**
   * Si `rol` es CAJERO, cierra cualquier otra sesión de cajero que hubiera
   * quedado activa — solo una persona de mostrador a la vez, sin importar
   * cuál de las cuentas use.
   */
  crear(datos: { usuarioId: string; usuario: string; nombre: string; rol: RolUsuario; ip: string }): string {
    const token = randomBytes(32).toString("base64url");
    const ahora = this.reloj.ms();
    this.sesiones.set(token, { token, ...datos, creadaEn: ahora, ultimoUso: ahora });

    if (datos.rol === "CAJERO") {
      if (this.cajeroActivo && this.cajeroActivo !== token) this.sesiones.delete(this.cajeroActivo);
      this.cajeroActivo = token;
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
    this.sesiones.delete(token);
    if (this.cajeroActivo === token) this.cajeroActivo = null;
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
