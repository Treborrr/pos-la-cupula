/**
 * Inventario: existencias, movimientos y kardex. Solo ítems tipo PRODUCTO.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  ajustarStock,
  bajoMinimo,
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
        const positivo = Math.max(0, stock);
        return {
          ...pos.p.itemParaPantalla(i),
          stock,
          // La MISMA definición que usa la alerta del encabezado. Cuando cada
          // uno la calculaba por su lado, la tabla marcaba 28 productos y el
          // encabezado decía 0.
          bajoMinimo: bajoMinimo(stock, i.stockMinimo),
          // El negativo se marca aparte además: significa que se vendió más de
          // lo que el sistema creía tener y hay que contar.
          enNegativo: stock < 0,
          // Dos valorizaciones, que responden preguntas distintas: a costo es
          // cuánta plata hay inmovilizada, a precio de venta es cuánto entraría
          // si se vendiera todo. `null` cuando falta el dato — un 0 haría creer
          // que el inventario vale menos de lo que vale.
          valorizadoCosto: i.costo === null ? null : Math.round(positivo * i.costo),
          valorizadoVenta: i.precio === null ? null : Math.round(positivo * i.precio),
        };
      })
      .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, "es"));

    const sumar = (campo: "valorizadoCosto" | "valorizadoVenta") =>
      productos.reduce((a, p) => a + (p[campo] ?? 0), 0);

    return {
      productos,
      alertas: stockBajo(pos.p),
      valorTotalCosto: sumar("valorizadoCosto"),
      valorTotalVenta: sumar("valorizadoVenta"),
      /**
       * Cuántos productos con stock quedaron fuera de cada total por no tener
       * el dato. Sin esto, un valorizado bajo se lee como "hay poca mercadería"
       * cuando en realidad es "falta cargar los costos".
       */
      sinCosto: productos.filter((p) => p.costo === null && p.stock > 0).length,
      sinPrecio: productos.filter((p) => p.precio === null && p.stock > 0).length,
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
