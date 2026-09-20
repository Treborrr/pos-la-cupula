/**
 * Impresora y respaldos: lo que se configura una vez y después nadie toca,
 * hasta que algo falla.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { PERFILES, perfilPorNombre } from "../../adaptadores/impresora/perfil";
import { ventaDePrueba } from "../../adaptadores/impresora/ImpresoraConfigurable";
import { PLANTILLA_POR_DEFECTO } from "../../adaptadores/impresora/plantilla";
import { listarImpresorasWindows } from "../../adaptadores/impresora/windows";
import type { Dependencias } from "../app";

export async function rutasMantenimiento(
  app: FastifyInstance,
  { pos, impresora, respaldos }: Dependencias,
) {
  // ── Impresora ─────────────────────────────────────────────────────────────

  app.get("/impresora", async () => ({
    estado: await impresora.estado(),
    configuracion: {
      modo: pos.config("impresora.modo"),
      perfil: pos.config("impresora.perfil"),
      nombreCompartido: pos.config("impresora.nombreCompartido"),
      host: pos.config("impresora.host"),
      puerto: pos.config("impresora.puerto"),
      conLogo: pos.config("impresora.conLogo"),
      abrirCajon: pos.config("impresora.abrirCajon") === true,
    },
    perfilesDisponibles: Object.entries(PERFILES).map(([id, p]) => ({
      id,
      nombre: p.nombre,
      anchoPuntos: p.anchoPuntos,
      columnas: p.columnas,
      qrPorFirmware: p.qrPorFirmware,
    })),
    // La plantilla se expone completa para poder editarla desde Ajustes sin
    // tocar código: el contenido del ticket es configuración, no programa.
    plantilla: pos.config("impresora.plantilla") ?? PLANTILLA_POR_DEFECTO,
  }));

  /**
   * Las impresoras que Windows tiene instaladas, para elegir la ticketera de
   * una lista en vez de escribir su nombre a mano.
   *
   * Nunca falla con error: si PowerShell no responde se devuelve la lista
   * vacía y el motivo, porque dejar la pantalla de Ajustes rota por no poder
   * enumerar impresoras sería peor que mostrarla sin la lista.
   */
  app.get("/impresora/windows", async () => {
    if (process.platform !== "win32") return { disponible: false, impresoras: [] };
    try {
      return { disponible: true, impresoras: await listarImpresorasWindows() };
    } catch (e) {
      return { disponible: true, impresoras: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Imprime un ticket de prueba. Es lo PRIMERO que hay que correr el día que
   * llegue la ticketera: verifica el transporte, el perfil, la página de
   * códigos (las tildes), el corte, el logo y el QR, sin cobrarle a nadie.
   */
  app.post("/impresora/prueba", async () => {
    const resultado = await impresora.imprimirVenta(
      // Con las columnas del perfil elegido: así la regla de números mide
      // exactamente el ancho que el perfil dice tener.
      ventaDePrueba(perfilPorNombre(pos.config<string>("impresora.perfil")).columnas),
      {
        nombre: pos.config<string>("negocio.nombre"),
        direccion: pos.config<string>("negocio.direccion"),
        ciudad: pos.config<string>("negocio.ciudad"),
        ruc: pos.config<string>("negocio.ruc"),
        pie: "TICKET DE PRUEBA — NO ES UNA VENTA",
      },
      {},
    );

    return {
      ...resultado,
      queRevisar: [
        "Que las tildes y la eñe salgan bien (ÁÉÍÓÚ ñÑ ¿¡). Si no, cambiar la página de códigos.",
        "Que la descripción larga se parta en varias líneas y no salga cortada.",
        "Que el logo se distinga. Si sale una mancha, hay que usar una versión más simple.",
        "Que la fila de números 1234567890… quepa en UNA sola línea. Si se parte en dos, el modelo elegido tiene más columnas que la impresora.",
        "Que el QR se lea con la pistola.",
        "Que el papel corte solo al final.",
        ...(pos.config("impresora.abrirCajon") === true ? ["Que el cajón de dinero se abra."] : []),
      ],
    };
  });

  // ── Respaldos ─────────────────────────────────────────────────────────────

  app.get("/respaldos", async () => respaldos.estado());

  app.post("/respaldos", async (peticion) => {
    const { etiqueta } = z
      .object({ etiqueta: z.string().trim().max(40).optional() })
      .parse(peticion.body ?? {});

    // Antes de respaldar se toma una instantánea: así la copia incluye el
    // estado ya reconstruido y restaurarla arranca más rápido.
    await pos.instantanea().catch(() => undefined);
    return respaldos.crear(etiqueta ?? "manual");
  });

  /**
   * Comprueba de verdad el destino externo: escribe un archivo, lo lee y lo
   * borra. Que la carpeta "exista" no alcanza — un USB desconectado deja la
   * letra de unidad, y OneDrive puede estar pausado.
   */
  app.post("/respaldos/verificar-destino", async () => {
    const destino = pos.config<string>("respaldos.destinoExterno");
    respaldos.configurarDestino(destino ?? null);
    return respaldos.verificarDestino();
  });
}
