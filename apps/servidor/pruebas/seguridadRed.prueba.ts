/**
 * La IP del cliente es un LÍMITE DE SEGURIDAD en este sistema: de ella
 * dependen el filtro de redes del cajero (`seguridad.redesCajero`) y el tope
 * de intentos de login. Si el cliente puede elegir qué IP aparenta tener, los
 * dos controles son decorativos.
 *
 * Detrás del proxy de Railway hace falta leer `X-Forwarded-For`, pero
 * confiando en TODA la cadena cualquiera puede anteponer la IP que quiera.
 * Estas pruebas fijan que solo se confíe en el salto que de verdad pone el
 * proxy.
 */

import { afterEach, describe, expect, it } from "vitest";

import { construirApp } from "../src/http/app";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { relojDelSistema } from "../src/puertos/Reloj";
import { crearUsuario } from "../src/dominio/usuarios/usuarios";
import { hashearContrasena } from "../src/seguridad/contrasenas";
import {
  abrirAlmacen,
  borrar,
  carpetaTemporal,
  dependenciasDeSeguridadDePrueba,
  notificacionesDePrueba,
} from "./ayuda";

const aCerrar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cerrar of aCerrar.splice(0)) await cerrar();
});

/** La red del local: solo desde ahí puede entrar un cajero. */
const RED_DEL_LOCAL = "192.168.1.0/24";

async function apiConRedRestringida(enNube = false) {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  await pos.guardarConfig("seguridad.redesCajero", RED_DEL_LOCAL);

  const hash = await hashearContrasena("contrasena-del-cajero");
  await pos.transaccion(() => {
    const r = crearUsuario(pos.p, { usuario: "kevin", nombre: "Kevin", rol: "CAJERO", hash });
    return { eventos: r.eventos, resultado: null };
  });

  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    notificaciones: notificacionesDePrueba(pos),
    carpetaDatos: dir,
    version: "pruebas",
    ...dependenciasDeSeguridadDePrueba(),
    enNube,
  });

  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return { app };
}

const login = (app: Awaited<ReturnType<typeof apiConRedRestringida>>["app"], headers = {}) =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers,
    payload: { usuario: "kevin", contrasena: "contrasena-del-cajero" },
  });

describe("la IP del cliente no se puede falsificar", () => {
  it("desde fuera de la red del local, el cajero NO entra", async () => {
    const { app } = await apiConRedRestringida();
    const r = await login(app);
    expect(r.statusCode).toBe(401);
  });

  /**
   * El ataque: anteponer una IP de la red permitida en `X-Forwarded-For`.
   * Si el servidor confía en toda la cadena, se queda con la de la izquierda
   * —la que puso el atacante— y la restricción de red cae entera.
   */
  it("no entra anteponiendo una IP permitida en X-Forwarded-For", async () => {
    const { app } = await apiConRedRestringida();
    const r = await login(app, { "x-forwarded-for": "192.168.1.50" });
    expect(r.statusCode).toBe(401);
  });

  it("tampoco con una cadena larga de saltos inventados", async () => {
    const { app } = await apiConRedRestringida();
    const r = await login(app, {
      "x-forwarded-for": "192.168.1.50, 10.0.0.9, 172.16.0.3",
    });
    expect(r.statusCode).toBe(401);
  });

  it("ni usando las variantes menos conocidas de la misma cabecera", async () => {
    const { app } = await apiConRedRestringida();
    for (const cabecera of ["x-real-ip", "x-client-ip", "forwarded"]) {
      const r = await login(app, { [cabecera]: "192.168.1.50" });
      expect(r.statusCode, `entró con ${cabecera}`).toBe(401);
    }
  });
});

/**
 * El caso de producción. En Railway hay un proxy por delante que SÍ agrega la
 * IP real al final de `X-Forwarded-For`, así que la cabecera llega con la
 * forma `<lo que puso el cliente>, <la IP real>`.
 */
describe("detrás del proxy de Railway", () => {
  it("usa la IP que agregó el proxy, no la que antepuso el atacante", async () => {
    const { app } = await apiConRedRestringida(true);

    // El atacante escribió "192.168.1.50"; el proxy le agregó su IP real
    // (127.0.0.1 en la prueba), que está fuera de la red del local.
    const r = await login(app, { "x-forwarded-for": "192.168.1.50, 127.0.0.1" });
    expect(r.statusCode).toBe(401);
  });

  it("deja entrar cuando la IP REAL sí está en la red del local", async () => {
    const { app } = await apiConRedRestringida(true);

    // Sin nadie mintiendo: el proxy agrega la IP real, que sí está permitida.
    const r = await login(app, { "x-forwarded-for": "192.168.1.50" });
    expect(r.statusCode).toBe(200);
  });
});
