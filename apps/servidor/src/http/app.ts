/**
 * La capa HTTP. Fina a propósito: valida la entrada, llama al dominio,
 * serializa la salida. Ninguna regla de negocio vive aquí.
 *
 * Esa delgadez es lo que permite la promesa del §13 de ARQUITECTURA.md: este
 * mismo API, sin tocar una línea, es el que va a correr en la nube. Lo único
 * que cambia detrás es el adaptador del almacén.
 */

import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import * as path from "node:path";

import { esErrorDeNegocio } from "../dominio/errores";
import type { ServicioPos } from "../servicios/Pos";
import type { Impresora } from "../puertos/Impresora";
import type { ServicioDeRespaldos } from "../servicios/Respaldos";

import { rutasSistema } from "./rutas/sistema";
import { rutasCatalogo } from "./rutas/catalogo";
import { rutasVentas } from "./rutas/ventas";
import { rutasInventario } from "./rutas/inventario";
import { rutasCaja } from "./rutas/caja";
import { rutasClientes } from "./rutas/clientes";
import { rutasMantenimiento } from "./rutas/mantenimiento";

export interface Dependencias {
  pos: ServicioPos;
  impresora: Impresora;
  respaldos: ServicioDeRespaldos;
  /** Carpeta con la PWA compilada. Si no existe, solo se sirve el API. */
  carpetaPwa?: string;
  version: string;
}

export async function construirApp(deps: Dependencias): Promise<FastifyInstance> {
  const app = Fastify({
    // Registro en JSON plano. Corriendo como servicio de Windows nadie lo lee
    // en vivo, y JSON es lo que se puede filtrar después cuando haga falta.
    logger: { level: process.env.NIVEL_LOG ?? (process.env.VITEST ? "silent" : "info") },
    // El cuerpo más grande que puede llegar es un ticket con muchas líneas.
    bodyLimit: 1_000_000,
  });

  /**
   * Un solo lugar traduce excepciones a respuestas.
   *
   * La distinción importa: `ErrorDeNegocio` es algo que la persona del
   * mostrador hizo y puede corregir, y su mensaje está escrito para ella.
   * Cualquier otra excepción es un bug nuestro: se registra completo y al
   * usuario se le dice que fue del sistema, sin filtrarle un stack trace.
   */
  app.setErrorHandler((error, peticion, respuesta) => {
    if (esErrorDeNegocio(error)) {
      return respuesta.status(400).send({
        error: { codigo: error.codigo, mensaje: error.message, sugerencia: error.sugerencia },
      });
    }

    if (error instanceof ZodError) {
      const primero = error.issues[0];
      return respuesta.status(400).send({
        error: {
          codigo: "DATO_INVALIDO",
          mensaje: `${primero.path.join(".") || "El dato"}: ${primero.message}`,
          detalles: error.issues.map((i) => ({ campo: i.path.join("."), problema: i.message })),
        },
      });
    }

    peticion.log.error({ err: error }, "error no previsto");
    return respuesta.status(500).send({
      error: {
        codigo: "ERROR_DEL_SISTEMA",
        mensaje: "Algo falló en el sistema. La operación no se completó.",
        sugerencia: "Vuelve a intentar. Si sigue pasando, revisa el estado en Ajustes → Diagnóstico.",
      },
    });
  });

  app.setNotFoundHandler((peticion, respuesta) => {
    if (peticion.url.startsWith("/api/")) {
      return respuesta.status(404).send({
        error: { codigo: "NO_ENCONTRADO", mensaje: `No existe ${peticion.method} ${peticion.url}` },
      });
    }
    // Cualquier otra ruta es navegación de la PWA: se devuelve el index y el
    // enrutador del navegador se encarga.
    return respuesta.sendFile("index.html");
  });

  await app.register(
    async (api) => {
      await rutasSistema(api, deps);
      await rutasCatalogo(api, deps);
      await rutasVentas(api, deps);
      await rutasInventario(api, deps);
      await rutasCaja(api, deps);
      await rutasClientes(api, deps);
      await rutasMantenimiento(api, deps);
    },
    { prefix: "/api" },
  );

  if (deps.carpetaPwa) {
    await app.register(fastifyStatic, {
      root: path.resolve(deps.carpetaPwa),
      // El service worker y el manifest no llevan hash en el nombre, así que
      // el navegador tiene que poder detectar que cambiaron. Sin esto, una
      // versión nueva del POS puede quedar invisible durante días.
      //
      // Ojo: aquí llega un `FastifyReply`, no el ServerResponse de Node —
      // `@fastify/static` v10 cambió la firma. Va `reply.header(...)`.
      setHeaders(reply, ruta) {
        if (ruta.endsWith("sw.js") || ruta.endsWith("manifest.webmanifest")) {
          reply.header("Cache-Control", "no-cache");
        }
      },
    });
  }

  return app;
}
