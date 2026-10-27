/**
 * Sucursales: alta, edición, baja y traslados de mercadería entre locales.
 *
 * Todo esto es ADMIN. Abrir un local, cambiarle el prefijo de los tickets o
 * mover mercadería de un lado a otro son decisiones del dueño, no del
 * mostrador. El listado también: un cajero no tiene por qué saber qué otros
 * locales existen, y su propia sucursal ya le llega en `/estado`.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  actualizarSede,
  crearSede,
  desactivarSede,
  prefijoSugerido,
  reactivarSede,
} from "../../dominio/sedes/sedes";
import { trasladarStock } from "../../dominio/inventario/traslados";
import type { Dependencias } from "../app";

export async function rutasSedes(app: FastifyInstance, { pos }: Dependencias) {
  app.get("/sedes", { config: { rol: "ADMIN" } }, async () => {
    const sedes = [...pos.p.sedes.values()]
      .sort((a, b) => Number(b.activa) - Number(a.activa) || a.nombre.localeCompare(b.nombre, "es"))
      .map((s) => ({
        ...s,
        /**
         * Cuántos tickets lleva emitidos. Es lo que decide si el prefijo
         * todavía se puede corregir, así que la pantalla necesita saberlo para
         * no ofrecer un campo que el servidor va a rechazar.
         */
        ticketsEmitidos: pos.p.ultimoCorrelativoPorSede.get(s.id) ?? 0,
        cajaAbierta: pos.p.turnoAbiertoDe(s.id) !== null,
      }));
    return { sedes };
  });

  /**
   * Propone un prefijo de ticket libre para un nombre. La pantalla lo pide
   * mientras se escribe el nombre, así el dueño no tiene que inventar nada.
   */
  app.get("/sedes/prefijo-sugerido", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { nombre } = z.object({ nombre: z.string().trim().max(80) }).parse(peticion.query);
    return { prefijo: prefijoSugerido(pos.p, nombre) };
  });

  app.post("/sedes", { config: { rol: "ADMIN" } }, async (peticion, respuesta) => {
    const datos = z
      .object({
        nombre: z.string().trim().min(1).max(80),
        direccion: z.string().trim().max(120).optional(),
        ciudad: z.string().trim().max(60).optional(),
        pie: z.string().trim().max(120).optional(),
        prefijoTicket: z.string().trim().min(2).max(4),
      })
      .parse(peticion.body);

    const sedeId = await pos.transaccion(() => {
      const r = crearSede(pos.p, datos);
      return { eventos: r.eventos, resultado: r.sedeId };
    }, peticion.actor);

    return respuesta.status(201).send({ sede: pos.p.sedes.get(sedeId) });
  });

  app.patch("/sedes/:sedeId", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { sedeId } = z.object({ sedeId: z.string().min(1) }).parse(peticion.params);
    const datos = z
      .object({
        nombre: z.string().trim().min(1).max(80).optional(),
        direccion: z.string().trim().max(120).optional(),
        ciudad: z.string().trim().max(60).optional(),
        pie: z.string().trim().max(120).optional(),
        prefijoTicket: z.string().trim().min(2).max(4).optional(),
      })
      .parse(peticion.body);

    await pos.escribir(() => actualizarSede(pos.p, sedeId, datos), peticion.actor);
    return { sede: pos.p.sedes.get(sedeId) };
  });

  app.post("/sedes/:sedeId/desactivar", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { sedeId } = z.object({ sedeId: z.string().min(1) }).parse(peticion.params);
    const { motivo } = z.object({ motivo: z.string().trim().max(200).optional() }).parse(peticion.body ?? {});
    await pos.escribir(() => desactivarSede(pos.p, sedeId, motivo), peticion.actor);
    return { sede: pos.p.sedes.get(sedeId) };
  });

  app.post("/sedes/:sedeId/reactivar", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { sedeId } = z.object({ sedeId: z.string().min(1) }).parse(peticion.params);
    await pos.escribir(() => reactivarSede(pos.p, sedeId), peticion.actor);
    return { sede: pos.p.sedes.get(sedeId) };
  });

  /**
   * El stock de un producto en TODAS las sucursales, de una.
   *
   * Es la pantalla desde la que se decide un traslado: sin ver los dos lados a
   * la vez, mover mercadería es adivinar.
   */
  app.get("/sedes/stock/:itemId", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { itemId } = z.object({ itemId: z.string().min(1) }).parse(peticion.params);
    const item = pos.p.items.get(itemId);
    if (!item) return { item: null, porSede: [] };

    return {
      item: { id: item.id, nombreCompleto: pos.p.nombreCompleto(item), tipo: item.tipo },
      total: pos.p.stockTotalDe(itemId),
      porSede: pos.p.sedesActivas().map((s) => ({
        sedeId: s.id,
        nombre: s.nombre,
        stock: pos.p.stockDe(s.id, itemId),
      })),
    };
  });

  app.post("/sedes/traslados", { config: { rol: "ADMIN" } }, async (peticion, respuesta) => {
    const datos = z
      .object({
        itemId: z.string().min(1),
        desdeSedeId: z.string().min(1),
        haciaSedeId: z.string().min(1),
        cantidad: z.number().positive(),
        motivo: z.string().trim().min(1).max(200),
      })
      .parse(peticion.body);

    const trasladoId = await pos.transaccion(() => {
      const r = trasladarStock(pos.p, datos);
      return { eventos: r.eventos, resultado: r.trasladoId };
    }, peticion.actor);

    return respuesta.status(201).send({
      trasladoId,
      desde: { sedeId: datos.desdeSedeId, stock: pos.p.stockDe(datos.desdeSedeId, datos.itemId) },
      hacia: { sedeId: datos.haciaSedeId, stock: pos.p.stockDe(datos.haciaSedeId, datos.itemId) },
    });
  });
}
