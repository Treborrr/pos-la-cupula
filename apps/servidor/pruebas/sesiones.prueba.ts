/**
 * Sesiones en memoria: la ventana de 8h de inactividad y la regla de "solo un
 * cajero a la vez POR SUCURSAL" son las dos cosas que no se pueden verificar
 * mirando el código, hay que hacerlas pasar de verdad.
 */

import { describe, expect, it } from "vitest";

import { SEDE_PRINCIPAL } from "@cupula/contratos";

import { ServicioDeSesiones } from "../src/servicios/Sesiones";
import { relojFijo } from "./ayuda";

function datos(usuarioId: string, rol: "ADMIN" | "CAJERO" = "CAJERO", sedeId = SEDE_PRINCIPAL) {
  return { usuarioId, usuario: usuarioId, nombre: usuarioId, rol, sedeId, ip: "127.0.0.1" };
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

  it("un login nuevo de CAJERO cierra el de la MISMA sucursal", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const primero = s.crear(datos("cajero1"));
    expect(s.obtener(primero)).not.toBeNull();

    const segundo = s.crear(datos("cajero2"));
    expect(s.obtener(primero)).toBeNull();
    expect(s.obtener(segundo)).not.toBeNull();
  });

  /**
   * El límite es por mostrador, no global. Cuando era global, la cajera del
   * segundo local al entrar echaba al cajero del primero y le cortaba la venta
   * a la mitad. Con varias sucursales eso es inaceptable.
   */
  it("dos cajeros de sucursales DISTINTAS conviven sin echarse", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const enPrincipal = s.crear(datos("kevin", "CAJERO", SEDE_PRINCIPAL));
    const enCentro = s.crear(datos("ana", "CAJERO", "centro"));

    expect(s.obtener(enPrincipal)).not.toBeNull();
    expect(s.obtener(enCentro)).not.toBeNull();
  });

  it("el relevo en una sucursal no toca al cajero de la otra", () => {
    const s = new ServicioDeSesiones(relojFijo());
    const enCentro = s.crear(datos("ana", "CAJERO", "centro"));
    const turnoMananero = s.crear(datos("kevin", "CAJERO", SEDE_PRINCIPAL));
    const turnoTarde = s.crear(datos("luis", "CAJERO", SEDE_PRINCIPAL));

    expect(s.obtener(turnoMananero)).toBeNull(); // relevado en su local
    expect(s.obtener(turnoTarde)).not.toBeNull();
    expect(s.obtener(enCentro)).not.toBeNull(); // el otro local, intacto
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
