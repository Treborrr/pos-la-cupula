/**
 * Usuarios: las cuentas de login. Dos roles —ADMIN y CAJERO— con lo que cada
 * uno puede ver o hacer decidido en la capa HTTP (ver `http/autorizacion.ts`),
 * no acá: este archivo solo sabe de altas, bajas y contraseñas.
 *
 * Los dos ADMIN se crean por fuera de la UI (un script que corre directo
 * contra el log, ver `herramientas/crear-usuario.mts`) pero reusan esta misma
 * función, para que el tope de "como mucho 2 admins activos" no se pueda
 * saltar por un camino distinto.
 */

import type { EventoNuevo, RolUsuario } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

const TOPES: Record<RolUsuario, number> = { ADMIN: 2, CAJERO: 3 };

export interface UsuarioNuevo {
  /** Ya normalizado a minúsculas por `esquemaUsuarioHandle`. */
  usuario: string;
  nombre: string;
  rol: RolUsuario;
  /** Ya calculado — ver `seguridad/contrasenas.ts`. El dominio nunca hashea ni verifica. */
  hash: string;
}

function activosDeRol(p: Proyeccion, rol: RolUsuario): number {
  let n = 0;
  for (const u of p.usuarios.values()) if (u.activo && u.rol === rol) n++;
  return n;
}

function verificarCupo(p: Proyeccion, rol: RolUsuario): void {
  if (activosDeRol(p, rol) >= TOPES[rol]) {
    throw new ErrorDeNegocio(
      rol === "ADMIN" ? "LIMITE_ADMINS_ALCANZADO" : "LIMITE_CAJEROS_ALCANZADO",
      rol === "ADMIN" ? `Ya hay ${TOPES.ADMIN} administradores activos.` : `Ya hay ${TOPES.CAJERO} cajeros activos.`,
      rol === "ADMIN" ? undefined : "Desactiva uno antes de crear otro.",
    );
  }
}

export function crearUsuario(p: Proyeccion, nuevo: UsuarioNuevo): { eventos: EventoNuevo[]; usuarioId: string } {
  const nombre = nuevo.nombre.trim();
  if (!nombre) throw new ErrorDeNegocio("DATO_INVALIDO", "El usuario necesita un nombre.");

  if (p.porNombreDeUsuario.has(nuevo.usuario)) {
    throw new ErrorDeNegocio(
      "USUARIO_REPETIDO",
      `Ya existe una cuenta activa con el usuario "${nuevo.usuario}".`,
      "Elige otro usuario, o desactiva la cuenta anterior primero.",
    );
  }

  verificarCupo(p, nuevo.rol);

  const usuarioId = ulid();
  return {
    usuarioId,
    eventos: [
      {
        tipo: "usuario.creado",
        datos: { usuarioId, usuario: nuevo.usuario, nombre, rol: nuevo.rol, hash: nuevo.hash },
      },
    ],
  };
}

/**
 * Vuelve a activar una cuenta desactivada, con el mismo usuario/nombre/rol y
 * la MISMA contraseña que tenía (reactivar no es resetear la clave). Reusa
 * `usuario.creado` con el mismo id —igual que `reactivarBarbero`— en vez de
 * inventar un `usuario.reactivado`.
 */
export function reactivarUsuario(p: Proyeccion, usuarioId: string): EventoNuevo[] {
  const u = p.usuarios.get(usuarioId);
  if (!u) throw new ErrorDeNegocio("USUARIO_NO_EXISTE", "Esa cuenta no existe.");
  if (u.activo) return [];

  const ocupadoPor = p.porNombreDeUsuario.get(u.usuario);
  if (ocupadoPor && ocupadoPor !== u.id) {
    throw new ErrorDeNegocio(
      "USUARIO_REPETIDO",
      `El usuario "${u.usuario}" ya lo tiene otra cuenta activa.`,
      "Cambia el nombre de usuario de una de las dos antes de reactivar.",
    );
  }

  verificarCupo(p, u.rol);

  return [
    {
      tipo: "usuario.creado",
      datos: { usuarioId: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, hash: u.hash },
    },
  ];
}

export function desactivarUsuario(p: Proyeccion, usuarioId: string): EventoNuevo[] {
  const u = p.usuarios.get(usuarioId);
  if (!u) throw new ErrorDeNegocio("USUARIO_NO_EXISTE", "Esa cuenta no existe.");
  if (!u.activo) return [];

  // No es una regla de negocio pedida — es la red de seguridad para no poder
  // quedarse sin ningún administrador activo por un clic apurado.
  if (u.rol === "ADMIN" && activosDeRol(p, "ADMIN") <= 1) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "No se puede desactivar al único administrador activo.",
      "Crea o reactiva otro administrador antes.",
    );
  }

  return [{ tipo: "usuario.desactivado", datos: { usuarioId } }];
}

/** `hash` ya viene calculado — ver `seguridad/contrasenas.ts`. */
export function cambiarContrasena(p: Proyeccion, usuarioId: string, hash: string): EventoNuevo[] {
  if (!p.usuarios.has(usuarioId)) throw new ErrorDeNegocio("USUARIO_NO_EXISTE", "Esa cuenta no existe.");
  return [{ tipo: "usuario.contrasena_cambiada", datos: { usuarioId, hash } }];
}
