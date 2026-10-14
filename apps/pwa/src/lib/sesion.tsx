/**
 * Quién está logueado, disponible en cualquier pantalla sin tener que
 * volver a pedirlo. Vive en su propio archivo —no en `App.tsx`— para que
 * páginas como `Barberos.tsx` puedan importar `usarUsuario()` sin un import
 * circular.
 */

import { createContext, useContext } from "react";
import type { RolUsuario } from "./api";

export interface UsuarioDeSesion {
  id: string;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
}

const ContextoDeUsuario = createContext<UsuarioDeSesion | null>(null);

export const ProveedorDeUsuario = ContextoDeUsuario.Provider;

/** Quién está logueado ahora. Solo se usa dentro del shell ya autenticado, nunca es null ahí. */
export function usarUsuario(): UsuarioDeSesion {
  const usuario = useContext(ContextoDeUsuario);
  if (!usuario) throw new Error("usarUsuario() se usó fuera del shell autenticado.");
  return usuario;
}

export function esAdmin(usuario: UsuarioDeSesion): boolean {
  return usuario.rol === "ADMIN";
}

/**
 * Para distinguir un logout que la propia persona pidió de uno que la
 * sorprendió (otro cajero entró, un admin la desactivó). `App` solo muestra
 * el aviso de "se cerró tu sesión" en el segundo caso — un clic en "Salir"
 * no necesita que le expliquen por qué ya no hay sesión.
 */
export const banderaDeSalidaIntencional = { valor: false };
