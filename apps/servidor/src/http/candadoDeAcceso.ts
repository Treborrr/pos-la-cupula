/**
 * Candado opcional para cuando el POS deja la LAN/Tailscale y se publica en
 * internet (por ejemplo en Railway).
 *
 * La decisión D3 de ARQUITECTURA.md es "sin login, un solo usuario": válida
 * mientras el único que llega al puerto es quien está físicamente en el
 * mostrador o conectado por Tailscale (una red privada que ya exige su propia
 * autenticación por dispositivo). Publicado en una URL de internet esa premisa
 * desaparece: cualquiera que la encuentre puede cobrar, anular, cambiar
 * precios o leer la ficha de un cliente.
 *
 * Esto NO es un sistema de login con usuarios y roles — sería ensanchar D3,
 * no respetarla. Es un candado único para todo el local: una sola clave
 * compartida, por HTTP Basic, que el navegador recuerda solo y que cualquier
 * cliente HTTP sabe hablar sin código nuevo.
 *
 * `seguridad.claveAcceso` es config de la instalación — como
 * `negocio.correoDueno` — NO una variable de entorno: se asigna desde
 * Ajustes, sin tocar Railway ni reiniciar el servidor, y un cambio hecho
 * ahí se aplica en la siguiente petición. Por defecto NO HACE NADA: si la
 * clave está vacía (instalación nueva, o la de la barbería en la LAN que
 * nunca la toca), el comportamiento es exactamente el de siempre.
 */

import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";

import type { ServicioPos } from "../servicios/Pos";

const USUARIO = "cupula";

function igual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Comparar largos antes no es tiempo-constante, pero filtrar "cuántos
  // caracteres tiene la clave" es una fuga aceptable frente a lo que evita:
  // timingSafeEqual exige buffers del mismo largo o lanza.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function candadoDeAcceso(app: FastifyInstance, pos: ServicioPos): Promise<void> {
  app.addHook("onRequest", async (peticion, respuesta) => {
    // Se lee en CADA petición, no una vez al registrar el hook: así un cambio
    // de clave desde Ajustes se aplica de inmediato, sin reiniciar el proceso.
    const clave = pos.config<string>("seguridad.claveAcceso");
    if (!clave) return;

    // El healthcheck de Railway pega directo a esta ruta sin credenciales:
    // si se la exige, Railway nunca ve el deploy como sano y lo reinicia en
    // bucle. Lo que expone (versión, integridad del log, memoria) no es dato
    // de negocio.
    if (peticion.url === "/api/salud") return;

    const cabecera = peticion.headers.authorization ?? "";
    const [tipo, credencial] = cabecera.split(" ");
    let autorizado = false;

    if (tipo === "Basic" && credencial) {
      const decodificado = Buffer.from(credencial, "base64").toString("utf8");
      const separador = decodificado.indexOf(":");
      if (separador !== -1) {
        const usuario = decodificado.slice(0, separador);
        const pass = decodificado.slice(separador + 1);
        autorizado = usuario === USUARIO && igual(pass, clave);
      }
    }

    if (autorizado) return;

    respuesta
      .status(401)
      .header("WWW-Authenticate", 'Basic realm="POS La Cúpula"')
      .send({ error: { codigo: "NO_AUTORIZADO", mensaje: "Clave de acceso requerida." } });
  });
}
