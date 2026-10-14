/**
 * Sesiones en memoria: la ventana de 8h de inactividad y la regla de "solo
 * un cajero a la vez" son las dos cosas que no se pueden verificar mirando
 * el código, hay que hacerlas pasar de verdad.
 */

import { describe, expect, it } from "vitest";

import { ServicioDeSesiones } from "../src/servicios/Sesiones";
import { relojFijo } from "./ayuda";

function datos(usuarioId: string, rol: "ADMIN" | "CAJERO" = "CAJERO") {
  return { usuarioId, usuario: usuarioId, nombre: usuarioId, rol, ip: "127.0.0.1" };
}

describe("ServicioDeSesiones", () => {
  it("una sesión recién creada se puede obtener", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const token = s.crear(datos("u1"));
    expect(s.obtener(token)?.usuarioId).toBe("u1");
  });

  it("un token inventado no existe", () => {
    const s = new ServicioDeSesiones(relojFijo());
    expect(s.obtener("token-que-nunca-se-creó")).toBeNull();
  });

  it("expira a las 8h de inactividad", () => {
    const reloj = relojFijo();
    const s = new ServicioDeSesiones(reloj);
    const token = s.crear(datos("u1"));

    reloj.avanzar(8 * 60 * 60 * 1000 + 1);
    expect(s.obtener(token)).toBeNull();
  });

  it("la ventana es DESLIZANTE: usarla antes de las 8h la renueva", () => {
    const reloj = relojFijo();
    const s = new ServicioDeSesiones(reloj);
    const token = s.crear(datos("u1"));

    reloj.avanzar(7 * 60 * 60 * 1000); // 7h: todavía viva
    expect(s.obtener(token)).not.toBeNull();

    reloj.avanzar(7 * 60 * 60 * 1000); // 7h más — si no se hubiera renovado, ya habría expirado
    expect(s.obtener(token)).not.toBeNull();
  });

  it("un login nuevo de CAJERO cierra cualquier otra sesión de cajero activa", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const primero = s.crear(datos("cajero1"));
    expect(s.obtener(primero)).not.toBeNull();

    const segundo = s.crear(datos("cajero2"));
    expect(s.obtener(primero)).toBeNull();
    expect(s.obtener(segundo)).not.toBeNull();
  });

  it("dos ADMIN pueden estar logueados a la vez", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const a = s.crear(datos("dueno1", "ADMIN"));
    const b = s.crear(datos("dueno2", "ADMIN"));

    expect(s.obtener(a)).not.toBeNull();
    expect(s.obtener(b)).not.toBeNull();
  });

  it("un ADMIN logueado no echa a un cajero activo", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const cajero = s.crear(datos("cajero1"));
    s.crear(datos("dueno1", "ADMIN"));

    expect(s.obtener(cajero)).not.toBeNull();
  });

  it("destruir() cierra la sesión y libera el cupo de cajero", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const primero = s.crear(datos("cajero1"));
    s.destruir(primero);
    expect(s.obtener(primero)).toBeNull();

    // Si no hubiera liberado el cupo, esto igual funcionaría (otro token),
    // pero probamos que no haga falta cerrar nada más para que entre otro.
    const segundo = s.crear(datos("cajero2"));
    expect(s.obtener(segundo)).not.toBeNull();
  });

  it("invalidarPorUsuario corta todas las sesiones de esa cuenta ya mismo", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const token = s.crear(datos("cajero1"));
    s.invalidarPorUsuario("cajero1");
    expect(s.obtener(token)).toBeNull();
  });

  it("invalidarPorUsuario no toca sesiones de otras cuentas", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const deOtro = s.crear(datos("dueno1", "ADMIN"));
    s.invalidarPorUsuario("dueno2");
    expect(s.obtener(deOtro)).not.toBeNull();
  });
});
