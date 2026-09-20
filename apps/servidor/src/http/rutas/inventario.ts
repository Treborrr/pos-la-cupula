/**
 * Inventario: existencias, movimientos y kardex. Solo ítems tipo PRODUCTO.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  ajustarStock,
  registrarEntrada,
  registrarMerma,
  stockBajo,
} from "../../dominio/inventario/inventario";
import { kardexDe } from "../../consultas/kardex";
import type { Dependencias } from "../app";

export async function rutasInventario(app: FastifyInstance, { pos }: Dependencias) {
  app.get("/inventario", async () => {
    const productos = [...pos.p.items.values()]
      .filter((i) => i.tipo === "PRODUCTO")
      .map((i) => {
        const stock = pos.p.stockDe(i.id);
        return {
          ...i,
          stock,
          bajoMinimo: stock < i.stockMinimo,
          // El negativo siempre se marca, aunque el mínimo esté en 0: significa
          // que se vendió más de lo que el sistema creía tener y hay que contar.
          enNegativo: stock < 0,
          valorizado: Math.round(stock * i.precio),
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return {
      productos,
      alertas: stockBajo(pos.p),
      valorTotal: productos.reduce((a, p) => a + Math.max(0, p.valorizado), 0),
    };
  });

  app.post("/inventario/entrada", async (peticion, respuesta) => {
    const datos = z
      .object({
        itemId: z.string().min(1),
        cantidad: z.number().positive(),
        costoUnitario: z.number().int().min(0).optional(),
        motivo: z.string().trim().min(1).max(200),
        referencia: z.string().trim().max(80).optional(),
      })
      .parse(peticion.body);

    await pos.escribir(() => registrarEntrada(pos.p, datos));
    return respuesta.status(201).send({ itemId: datos.itemId, stock: pos.p.stockDe(datos.itemId) });
  });

  app.post("/inventario/ajuste", async (peticion, respuesta) => {
    const datos = z
      .object({
        itemId: z.string().min(1),
        cantidadContada: z.number().min(0),
        motivo: z.string().trim().min(1).max(200),
      })
      .parse(peticion.body);

    await pos.escribir(() => ajustarStock(pos.p, datos));
    return respuesta.status(201).send({ itemId: datos.itemId, stock: pos.p.stockDe(datos.itemId) });
  });

  app.post("/inventario/merma", async (peticion, respuesta) => {
    const datos = z
      .object({
        itemId: z.string().min(1),
        cantidad: z.number().positive(),
        motivo: z.string().trim().min(1).max(200),
      })
      .parse(peticion.body);

    await pos.escribir(() => registrarMerma(pos.p, datos));
    return respuesta.status(201).send({ itemId: datos.itemId, stock: pos.p.stockDe(datos.itemId) });
  });

  app.get("/inventario/:itemId/kardex", async (peticion, respuesta) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(peticion.params);
    const { limite } = z
      .object({ limite: z.coerce.number().int().min(1).max(1000).default(200) })
      .parse(peticion.query);

    const item = pos.p.items.get(itemId);
    if (!item) {
      return respuesta.status(404).send({
        error: { codigo: "ITEM_NO_EXISTE", mensaje: "Ese ítem no existe." },
      });
    }

    return { item, stock: pos.p.stockDe(itemId), movimientos: await kardexDe(pos.almacen, itemId, limite) };
  });
}
