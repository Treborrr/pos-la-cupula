/**
 * "Mi cuenta": nada se aplica hasta confirmar el código, el código nunca va
 * al correo nuevo si ya hay uno viejo registrado, y el tope diario de
 * correos no rompe el flujo aunque bloquee el envío.
 */

import { describe, expect, it, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

import { construirApp } from "../src/http/app";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { relojDelSistema } from "../src/puertos/Reloj";
import {
  abrirAlmacen,
  borrar,
  carpetaTemporal,
  conSesionAdmin,
  dependenciasDeSeguridadDePrueba,
  enviadorDeCorreoFalso,
  notificacionesDePrueba,
} from "./ayuda";

const aCerrar: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of aCerrar.splice(0)) await fn().catch(() => undefined);
});

async function appDePrueba(enviador = enviadorDeCorreoFalso()): Promise<{ app: FastifyInstance; pos: ServicioPos }> {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    notificaciones: notificacionesDePrueba(pos, relojDelSistema, { enviador }),
    carpetaDatos: dir,
    version: "pruebas",
    ...dependenciasDeSeguridadDePrueba(),
  });
  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return { app, pos };
}

/** El código es lo único en el correo que son 6 dígitos seguidos. */
function codigoDe(html: string): string {
  const m = /\b(\d{6})\b/.exec(html);
  if (!m) throw new Error(`No se encontró un código de 6 dígitos en: ${html}`);
  return m[1];
}

describe("mi cuenta", () => {
  it("sin correo registrado, el código va al correo NUEVO que se está dando de alta", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, pos } = await appDePrueba(enviador);
    await conSesionAdmin(app, pos);

    const r = await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/solicitar-cambio",
      payload: { correo: "dueno@cupula.test" },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().enviado).toBe(true);
    expect(enviador.enviados).toHaveLength(1);
    expect(enviador.enviados[0].to).toEqual(["dueno@cupula.test"]);
  });

  it("con un correo ya registrado, el código va al VIEJO aunque se pida cambiarlo por otro", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, pos } = await appDePrueba(enviador);
    await conSesionAdmin(app, pos);

    // Primera ronda: registra el correo inicial.
    await app.inject({ method: "POST", url: "/api/mi-cuenta/solicitar-cambio", payload: { correo: "viejo@cupula.test" } });
    const primerCodigo = codigoDe(enviador.enviados[0].html);
    await app.inject({ method: "POST", url: "/api/mi-cuenta/confirmar-cambio", payload: { codigo: primerCodigo } });

    // Segunda ronda: pide cambiar a uno nuevo. El código tiene que ir al viejo.
    const r = await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/solicitar-cambio",
      payload: { correo: "nuevo@cupula.test" },
    });

    expect(r.statusCode).toBe(200);
    expect(enviador.enviados).toHaveLength(2);
    expect(enviador.enviados[1].to).toEqual(["viejo@cupula.test"]);
  });

  it("sin correo viejo ni nuevo en el pedido, rechaza con un error claro", async () => {
    const { app, pos } = await appDePrueba();
    await conSesionAdmin(app, pos);

    const r = await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/solicitar-cambio",
      payload: { nombre: "Nuevo Nombre" },
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe("SIN_CORREO");
  });

  it("un código incorrecto repetido agota los intentos y descarta el pedido", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, pos } = await appDePrueba(enviador);
    await conSesionAdmin(app, pos);

    await app.inject({ method: "POST", url: "/api/mi-cuenta/solicitar-cambio", payload: { correo: "dueno@cupula.test" } });

    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/api/mi-cuenta/confirmar-cambio", payload: { codigo: "000000" } });
      expect(r.statusCode).toBe(400);
    }

    // Al agotarse los intentos, el código correcto YA no sirve: hay que pedir uno nuevo.
    const codigoReal = codigoDe(enviador.enviados[0].html);
    const r = await app.inject({ method: "POST", url: "/api/mi-cuenta/confirmar-cambio", payload: { codigo: codigoReal } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe("CODIGO_INVALIDO");
  });

  it("confirmar aplica nombre, correo, teléfono y contraseña juntos, en un solo pedido", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, pos } = await appDePrueba(enviador);
    await conSesionAdmin(app, pos);

    await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/solicitar-cambio",
      payload: {
        nombre: "Roberto Nuevo",
        correo: "roberto@cupula.test",
        telefono: "+51 999 888 777",
        contrasenaNueva: "una-contrasena-bien-larga",
      },
    });
    const codigo = codigoDe(enviador.enviados[0].html);

    const r = await app.inject({ method: "POST", url: "/api/mi-cuenta/confirmar-cambio", payload: { codigo } });

    expect(r.statusCode).toBe(200);
    expect(r.json().usuario).toMatchObject({
      nombre: "Roberto Nuevo",
      correo: "roberto@cupula.test",
      telefono: "+51 999 888 777",
    });
    expect(r.json().contrasenaCambiada).toBe(true);

    const [u] = [...pos.p.usuarios.values()];
    expect(u.hash).not.toContain("una-contrasena-bien-larga"); // nunca texto plano
  });

  it("confirmar un cambio de contraseña invalida la sesión actual", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, pos } = await appDePrueba(enviador);
    await conSesionAdmin(app, pos);

    await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/solicitar-cambio",
      payload: { correo: "dueno@cupula.test", contrasenaNueva: "otra-contrasena-larga" },
    });
    const codigo = codigoDe(enviador.enviados[0].html);
    await app.inject({ method: "POST", url: "/api/mi-cuenta/confirmar-cambio", payload: { codigo } });

    // La misma cookie (el parche de `conSesionAdmin` la sigue mandando) ya no sirve.
    const r = await app.inject({ method: "GET", url: "/api/mi-cuenta" });
    expect(r.statusCode).toBe(401);
  });

  it("un cambio de SOLO contraseña no escribe un evento vacío de datos", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, pos } = await appDePrueba(enviador);
    await conSesionAdmin(app, pos);

    // Primera ronda: registra el correo (hace falta para poder pedir algo).
    await app.inject({ method: "POST", url: "/api/mi-cuenta/solicitar-cambio", payload: { correo: "dueno@cupula.test" } });
    await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/confirmar-cambio",
      payload: { codigo: codigoDe(enviador.enviados[0].html) },
    });

    // Segunda ronda: solo la contraseña, nada de nombre/correo/teléfono.
    await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/solicitar-cambio",
      payload: { contrasenaNueva: "una-contrasena-distinta" },
    });
    // Desde ACÁ: lo único que falta escribir es la confirmación en sí —
    // mandar el código ya quedó registrado (`correo.enviado`) arriba.
    const seqAntes = pos.almacen.ultimaSeq();
    const r = await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/confirmar-cambio",
      payload: { codigo: codigoDe(enviador.enviados[1].html) },
    });

    expect(r.statusCode).toBe(200);
    // Un solo evento nuevo (la contraseña) — ningún `usuario.datos_actualizados` de más.
    expect(pos.almacen.ultimaSeq() - seqAntes).toBe(1);
  });

  it("el tope diario de correos bloquea el envío del código, sin romper el pedido", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, pos } = await appDePrueba(enviador);
    await pos.guardarConfig("notificaciones.topeTotalDiario", 0);
    await conSesionAdmin(app, pos);

    const r = await app.inject({
      method: "POST",
      url: "/api/mi-cuenta/solicitar-cambio",
      payload: { correo: "dueno@cupula.test" },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().enviado).toBe(false);
    expect(enviador.enviados).toHaveLength(0);
  });
});
