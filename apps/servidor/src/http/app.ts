/**
 * La capa HTTP. Fina a propósito: valida la entrada, llama al dominio,
 * serializa la salida. Ninguna regla de negocio vive aquí.
 *
 * Esa delgadez es lo que permite la promesa del §13 de ARQUITECTURA.md: este
 * mismo API, sin tocar una línea, es el que va a correr en la nube. Lo único
 * que cambia detrás es el adaptador del almacén.
 */

import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import * as path from "node:path";
import { mkdir } from "node:fs/promises";

import { esErrorDeAutenticacion, esErrorDeAutorizacion, esErrorDeNegocio } from "../dominio/errores";
import type { ServicioPos } from "../servicios/Pos";
import type { Impresora } from "../puertos/Impresora";
import type { ServicioDeRespaldos } from "../servicios/Respaldos";
import type { ServicioDeNotificaciones } from "../servicios/Notificaciones";
import type { ServicioDeSesiones } from "../servicios/Sesiones";
import type { ServicioDeIntentosDeLogin } from "../servicios/IntentosDeLogin";
import type { ServicioDeVerificacionDeCuenta } from "../servicios/VerificacionDeCuenta";

import { registrarAutorizacion } from "./autorizacion";
import { rutasAuth } from "./rutas/auth";
import { rutasUsuarios } from "./rutas/usuarios";
import { rutasMiCuenta } from "./rutas/miCuenta";
import { rutasSistema } from "./rutas/sistema";
import { rutasSedes } from "./rutas/sedes";
import { rutasCatalogo } from "./rutas/catalogo";
import { rutasVentas } from "./rutas/ventas";
import { rutasInventario } from "./rutas/inventario";
import { rutasCaja } from "./rutas/caja";
import { rutasClientes } from "./rutas/clientes";
import { rutasBarberos } from "./rutas/barberos";
import { rutasMantenimiento } from "./rutas/mantenimiento";

export interface Dependencias {
  pos: ServicioPos;
  impresora: Impresora;
  respaldos: ServicioDeRespaldos;
  notificaciones: ServicioDeNotificaciones;
  sesiones: ServicioDeSesiones;
  intentosDeLogin: ServicioDeIntentosDeLogin;
  verificacionDeCuenta: ServicioDeVerificacionDeCuenta;
  /** Carpeta con la PWA compilada. Si no existe, solo se sirve el API. */
  carpetaPwa?: string;
  /** La carpeta `datos/`. Hoy solo la usan las fotos de catálogo. */
  carpetaDatos: string;
  version: string;
  /**
   * `true` bajo Railway (`RAILWAY_ENVIRONMENT`). Apaga el explorador de
   * carpetas de Ajustes → Respaldos: recorrer/crear carpetas por ruta
   * arbitraria es la mayor superficie de ataque de toda la app, y en la nube
   * no sirve para nada —el único disco escribible es el Volumen montado—.
   */
  enNube: boolean;
}

/**
 * Cuántos saltos de proxy hay de verdad por delante. Ver la nota de
 * `trustProxy` abajo: es un límite de seguridad, no una comodidad.
 */
function saltosDeProxyConfiables(enNube: boolean): FastifyServerOptions["trustProxy"] {
  // Instalado en la PC de la barbería no hay ningún proxy por delante: ahí una
  // cabecera `X-Forwarded-For` solo puede venir de alguien mintiendo, así que
  // no se lee nunca.
  if (!enNube) return false;

  /**
   * En Railway hay EXACTAMENTE un proxy por delante.
   *
   * `salto` cuenta desde el servidor hacia afuera: 0 es quien se conectó
   * directo —el proxy de Railway— y de ahí para la izquierda están los valores
   * que vinieron escritos en la cabecera, o sea los que el cliente controla.
   * Confiando solo en el salto 0, Fastify se queda con la IP que el proxy
   * agregó (la real) y descarta cualquier cosa que el atacante haya puesto
   * antes.
   *
   * Se escribe como función y no como el número `1` porque los tipos de
   * Fastify no aceptan números, aunque en ejecución funcionen: la función es
   * lo mismo, tipado y además dice qué significa.
   */
  return (_direccion: string, salto: number) => salto === 0;
}

export async function construirApp(deps: Dependencias): Promise<FastifyInstance> {
  const app = Fastify({
    // Registro en JSON plano. Corriendo como servicio de Windows nadie lo lee
    // en vivo, y JSON es lo que se puede filtrar después cuando haga falta.
    logger: { level: process.env.NIVEL_LOG ?? (process.env.VITEST ? "silent" : "info") },
    // El cuerpo más grande que puede llegar es un ticket con muchas líneas.
    bodyLimit: 1_000_000,
    /**
     * CUÁNTOS saltos de proxy se creen, no "créele a todos".
     *
     * La IP del cliente es un límite de seguridad acá: de ella dependen el
     * filtro de redes del cajero (`seguridad.redesCajero`) y el tope de
     * intentos de login. Con `trustProxy: true` Fastify se queda con el valor
     * de MÁS A LA IZQUIERDA de `X-Forwarded-For`, y esa parte la escribe quien
     * se conecta: mandando `X-Forwarded-For: 192.168.1.50` cualquiera entraba
     * como si estuviera en la red del local, desde cualquier parte del mundo.
     * Los dos controles quedaban en decoración. Hay prueba que lo fija.
     *
     * Con un número, Fastify confía SOLO en esa cantidad de saltos contados
     * desde el servidor hacia afuera, y se queda con el primero que está más
     * allá. En Railway hay exactamente un proxy por delante: lo que ese proxy
     * agrega es la IP real, y cualquier cosa que el atacante haya puesto antes
     * queda más a la izquierda y se descarta.
     *
     * Instalado en la PC de la barbería no hay ningún proxy, así que no se
     * confía en la cabecera en absoluto: ahí `X-Forwarded-For` solo puede
     * venir de alguien tratando de mentir.
     */
    trustProxy: saltosDeProxyConfiables(deps.enNube),
  });

  /**
   * Cabeceras de seguridad, escritas a mano.
   *
   * A mano y no con `@fastify/helmet` a propósito: son diez líneas que se leen
   * de una, y una dependencia menos es una vía menos por la que entra código
   * ajeno a un sistema que maneja la plata de un negocio. El mismo criterio que
   * ya se aplicó al service worker.
   *
   * Van en un `onRequest`, antes de todo, para que salgan TAMBIÉN en las
   * respuestas de error y en los archivos estáticos de la PWA. Puestas solo en
   * las rutas del API, el `index.html` —que es el que el navegador interpreta—
   * quedaría sin ninguna.
   */
  app.addHook("onRequest", async (_peticion, respuesta) => {
    /**
     * CSP. El POS no carga NADA de afuera: ni una fuente, ni un script, ni una
     * imagen. Por eso puede permitirse la política estricta que un sitio con
     * CDNs no puede, y esa es justamente la defensa que convierte un XSS de
     * "robo de sesión" en "no pasa nada".
     *
     *  · `'unsafe-inline'` SOLO en estilos: el `index.html` trae un bloque
     *    `<style>` y las barras de los reportes se dibujan con `style={{...}}`.
     *    En estilos el riesgo es cosmético; en scripts sería el agujero entero,
     *    y ahí no se permite.
     *  · `img-src` admite `data:` y `blob:` por el QR del ticket y las fotos
     *    del catálogo que se previsualizan antes de subirlas.
     *  · `frame-ancestors 'none'` es lo que impide el clickjacking: nadie puede
     *    meter el POS en un iframe y hacer que el dueño apriete "Anular" sin
     *    saberlo.
     *  · `form-action` y `base-uri` cierran dos vías clásicas de exfiltración
     *    si algún día entrara HTML inyectado.
     */
    respuesta.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );

    // Que el navegador NO adivine el tipo de un archivo. Importa por las fotos
    // del catálogo: llegan con el Content-Type que manda el cliente y se
    // sirven desde el mismo origen, así que sin esto un archivo disfrazado de
    // PNG podría llegar a interpretarse como otra cosa.
    respuesta.header("X-Content-Type-Options", "nosniff");

    // Lo mismo que `frame-ancestors`, para navegadores viejos que no leen CSP.
    respuesta.header("X-Frame-Options", "DENY");

    // Las URLs del POS llevan ids de venta y de cliente. Que no salgan hacia
    // ningún lado al hacer clic en un enlace externo.
    respuesta.header("Referrer-Policy", "no-referrer");

    // El POS no usa ninguna de las tres. Apagarlas evita que un día un script
    // inyectado pueda siquiera pedirlas.
    respuesta.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // Aísla la pestaña: nada que se abra desde acá conserva una referencia a
    // la ventana del POS.
    respuesta.header("Cross-Origin-Opener-Policy", "same-origin");

    /**
     * HSTS solo en la nube. En la barbería el POS se sirve por HTTP en la red
     * local, y mandar esta cabecera ahí dejaría el navegador del mostrador
     * negándose a abrirlo —el navegador recuerda la orden durante meses y no
     * hay forma simple de deshacerla desde el servidor.
     */
    if (deps.enNube) {
      respuesta.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
  });

  await app.register(fastifyCookie);
  // `global: false`: el límite de intentos NO se aplica solo porque sí a
  // cada ruta — se activa a propósito en `/auth/login`, donde de verdad
  // importa, para no interferir con el ritmo normal de cobrar.
  await app.register(fastifyRateLimit, { global: false });

  // Las fotos de catálogo llegan CRUDAS —ni JSON ni multipart—, con el
  // Content-Type real de la imagen. `'*'` es el comodín que Fastify usa SOLO
  // cuando ningún parser más específico matcheó —el de `application/json`
  // de toda la vida sigue intacto—, así que cualquier Content-Type que no
  // sea JSON llega como Buffer a la ruta. Eso es a propósito: si se
  // registrara solo para los tres tipos de imagen válidos, un archivo con
  // Content-Type inesperado (un PDF, un .gif) nunca llegaría a la ruta —la
  // rechazaría Fastify con un 415 genérico— en vez del mensaje claro de
  // "la foto tiene que ser JPG, PNG o WEBP" que la ruta ya sabe dar.
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_peticion, cuerpo, listo) => listo(null, cuerpo));

  /**
   * Un solo lugar traduce excepciones a respuestas.
   *
   * La distinción importa: `ErrorDeNegocio` es algo que la persona del
   * mostrador hizo y puede corregir, y su mensaje está escrito para ella.
   * Cualquier otra excepción es un bug nuestro: se registra completo y al
   * usuario se le dice que fue del sistema, sin filtrarle un stack trace.
   */
  app.setErrorHandler((error, peticion, respuesta) => {
    if (esErrorDeAutenticacion(error)) {
      return respuesta.status(401).send({ error: { codigo: error.codigo, mensaje: error.message } });
    }

    if (esErrorDeAutorizacion(error)) {
      return respuesta.status(403).send({ error: { codigo: "ROL_INSUFICIENTE", mensaje: error.message } });
    }

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

    /**
     * Errores que el propio Fastify ya clasificó: JSON malformado (400),
     * cuerpo más grande que el tope (413), demasiados intentos de login (429).
     *
     * Sin esto caían todos al 500 de abajo, y eso tenía dos costos. Uno, de
     * cara a la persona: pasados los 10 intentos, el login respondía "Algo
     * falló en el sistema" en vez de "Demasiados intentos, espera un minuto",
     * así que la única señal de que el freno existe quedaba escondida detrás de
     * un mensaje de avería. Dos, de cara a quien opera: un 500 es "revisar el
     * servidor" y un 429 es "funcionó la defensa"; confundirlos hace que un
     * ataque de fuerza bruta se lea como un sistema roto.
     *
     * Solo se respetan los 4xx. Un 5xx que venga de una librería se sigue
     * tratando como imprevisto: se registra con su detalle y afuera sale el
     * mensaje genérico, sin filtrar nada del interior.
     */
    const conEstado = (error ?? {}) as { statusCode?: unknown; code?: unknown; message?: unknown; error?: { codigo?: string; mensaje?: string } };
    const estadoPropio = typeof conEstado.statusCode === "number" ? conEstado.statusCode : 0;
    if (estadoPropio >= 400 && estadoPropio < 500) {
      // Si ya trae un `error` con nuestra forma (lo arman los limitadores de
      // intentos), se respeta tal cual: ese mensaje está escrito para la
      // persona del mostrador y es mejor que cualquiera que se arme acá.
      if (conEstado.error?.mensaje) {
        return respuesta.status(estadoPropio).send({ error: conEstado.error });
      }
      return respuesta.status(estadoPropio).send({
        error: {
          codigo: typeof conEstado.code === "string" ? conEstado.code : "PETICION_INVALIDA",
          mensaje: typeof conEstado.message === "string" ? conEstado.message : "La petición no se pudo procesar.",
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
      // Antes que cualquier ruta: decide quién puede llegar a cada una.
      registrarAutorizacion(api, deps);

      await rutasAuth(api, deps);
      await rutasUsuarios(api, deps);
      await rutasMiCuenta(api, deps);
      await rutasSistema(api, deps);
      await rutasSedes(api, deps);
      await rutasCatalogo(api, deps);
      await rutasVentas(api, deps);
      await rutasInventario(api, deps);
      await rutasCaja(api, deps);
      await rutasClientes(api, deps);
      await rutasBarberos(api, deps);
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

  // Las fotos de catálogo, servidas tal cual quedaron en disco. `decorateReply:
  // false` porque `reply.sendFile` ya lo decoró el registro de arriba —hacerlo
  // dos veces revienta con "decorator already added"— y acá no hace falta: esta
  // ruta solo necesita servir archivos por prefijo, no mandar uno a mano.
  await mkdir(path.join(deps.carpetaDatos, "fotos"), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.join(deps.carpetaDatos, "fotos"),
    prefix: "/fotos/",
    decorateReply: false,
  });

  return app;
}
