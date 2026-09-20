/**
 * Catálogo de servicios y productos, y la lista de barberos.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { coincide } from "@cupula/contratos";
import {
  actualizarItem,
  crearItem,
  desactivarItem,
  reactivarItem,
  siguienteCodigo,
} from "../../dominio/catalogo/catalogo";
import {
  actualizarBarbero,
  crearBarbero,
  desactivarBarbero,
  reactivarBarbero,
} from "../../dominio/barberos/barberos";
import type { Dependencias } from "../app";

/**
 * Booleano de query string.
 *
 * `z.coerce.boolean()` da VERDADERO para "false" y para "0", porque son
 * cadenas no vacías. Con `?incluirInactivos=false` se colaban los inactivos en
 * la pantalla de cobro.
 */
export const booleanoDeQuery = () =>
  z.preprocess((v) => (v === "false" || v === "0" ? false : v), z.coerce.boolean());

const esquemaItemNuevo = z.object({
  // Vacío u omitido: lo genera el servidor (ver `siguienteCodigo`).
  codigo: z.string().trim().max(24).optional(),
  nombre: z.string().trim().min(1).max(80),
  tipo: z.enum(["SERVICIO", "PRODUCTO"]),
  categoria: z.string().trim().min(1).max(40),
  precio: z.number().int().min(0),
  stockMinimo: z.number().min(0).optional(),
  stockInicial: z.number().min(0).optional(),
  orden: z.number().int().min(0).optional(),
});

const esquemaCambios = z.object({
  codigo: z.string().trim().min(1).max(24).optional(),
  nombre: z.string().trim().min(1).max(80).optional(),
  categoria: z.string().trim().min(1).max(40).optional(),
  precio: z.number().int().min(0).optional(),
  stockMinimo: z.number().min(0).optional(),
  orden: z.number().int().min(0).optional(),
  motivoPrecio: z.string().trim().max(200).optional(),
});

export async function rutasCatalogo(app: FastifyInstance, { pos }: Dependencias) {
  app.get("/catalogo", async (peticion) => {
    const { q, incluirInactivos, tipo } = z
      .object({
        q: z.string().optional(),
        incluirInactivos: booleanoDeQuery().optional(),
        tipo: z.enum(["SERVICIO", "PRODUCTO"]).optional(),
      })
      .parse(peticion.query);

    let items = [...pos.p.items.values()];
    if (!incluirInactivos) items = items.filter((i) => i.activo);
    if (tipo) items = items.filter((i) => i.tipo === tipo);
    if (q) items = items.filter((i) => coincide(`${i.codigo} ${i.nombre} ${i.categoria}`, q));

    // Orden de la grilla primero, después alfabético: el dueño puede poner los
    // servicios más vendidos adelante sin pelear con el orden alfabético.
    items.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));

    return {
      items: items.map((i) => ({
        ...i,
        stock: i.tipo === "PRODUCTO" ? pos.p.stockDe(i.id) : null,
      })),
      categorias: [...new Set(items.map((i) => i.categoria))].sort((a, b) => a.localeCompare(b, "es")),
    };
  });

  /** Lo consulta el formulario de alta para mostrar el código que va a tocar. */
  app.get("/catalogo/siguiente-codigo", async (peticion) => {
    const { tipo } = z.object({ tipo: z.enum(["SERVICIO", "PRODUCTO"]) }).parse(peticion.query);
    return { codigo: siguienteCodigo(pos.p, tipo) };
  });

  app.post("/catalogo", async (peticion, respuesta) => {
    const datos = esquemaItemNuevo.parse(peticion.body);
    const itemId = await pos.transaccion(() => {
      const r = crearItem(pos.p, datos);
      return { eventos: r.eventos, resultado: r.itemId };
    });
    return respuesta.status(201).send({ item: pos.p.items.get(itemId) });
  });

  app.patch("/catalogo/:id", async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const cambios = esquemaCambios.parse(peticion.body);
    await pos.escribir(() => actualizarItem(pos.p, id, cambios));
    return { item: pos.p.items.get(id) };
  });

  app.post("/catalogo/:id/desactivar", async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { motivo } = z.object({ motivo: z.string().trim().max(200).optional() }).parse(peticion.body ?? {});
    await pos.escribir(() => desactivarItem(pos.p, id, motivo));
    return { item: pos.p.items.get(id) };
  });

  app.post("/catalogo/:id/reactivar", async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    await pos.escribir(() => reactivarItem(pos.p, id));
    return { item: pos.p.items.get(id) };
  });

  // ── Barberos: solo atribución, sin comisiones (D6) ────────────────────────

  app.get("/barberos", async (peticion) => {
    const { incluirInactivos } = z
      .object({ incluirInactivos: booleanoDeQuery().optional() })
      .parse(peticion.query);

    const barberos = [...pos.p.barberos.values()]
      .filter((b) => incluirInactivos || b.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return { barberos };
  });

  app.post("/barberos", async (peticion, respuesta) => {
    const { nombre } = z.object({ nombre: z.string().trim().min(1).max(80) }).parse(peticion.body);
    const barberoId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, nombre);
      return { eventos: r.eventos, resultado: r.barberoId };
    });
    return respuesta.status(201).send({ barbero: pos.p.barberos.get(barberoId) });
  });

  app.patch("/barberos/:id", async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { nombre } = z.object({ nombre: z.string().trim().min(1).max(80) }).parse(peticion.body);
    await pos.escribir(() => actualizarBarbero(pos.p, id, nombre));
    return { barbero: pos.p.barberos.get(id) };
  });

  app.post("/barberos/:id/reactivar", async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    await pos.escribir(() => reactivarBarbero(pos.p, id));
    return { barbero: pos.p.barberos.get(id) };
  });

  app.post("/barberos/:id/desactivar", async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    await pos.escribir(() => desactivarBarbero(pos.p, id));
    return { barbero: pos.p.barberos.get(id) };
  });
}
