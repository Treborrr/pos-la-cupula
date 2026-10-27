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
import { registrarCompra } from "../../dominio/compras/compras";
import { kardexDe } from "../../consultas/kardex";
import { sedeParaEscribir } from "../autorizacion";
import type { Dependencias } from "../app";

export async function rutasInventario(app: FastifyInstance, { pos }: Dependencias) {
  app.get("/inventario", { config: { rol: "CAJERO" } }, async (peticion) => {
    const productos = [...pos.p.items.values()]
      .filter((i) => i.tipo === "PRODUCTO")
      .map((i) => {
        const stock = pos.p.stockDe(peticion.sede, i.id);
        const positivo = Math.max(0, stock);
        return {
          ...pos.p.itemParaPantalla(i, peticion.sede),
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
      alertas: stockBajo(pos.p, peticion.sede),
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

  app.post("/inventario/entrada", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const datos = z
      .object({
        itemId: z.string().min(1),
        cantidad: z.number().positive(),
        costoUnitario: z.number().int().min(0).optional(),
        motivo: z.string().trim().min(1).max(200),
        referencia: z.string().trim().max(80).optional(),
      })
      .parse(peticion.body);

    await pos.escribir(() => registrarEntrada(pos.p, sedeParaEscribir(peticion), datos), peticion.actor);
    return respuesta.status(201).send({ itemId: datos.itemId, stock: pos.p.stockDe(peticion.sede, datos.itemId) });
  });

  /**
   * ADMIN, no cajero — a diferencia de entrada/merma, un ajuste puede
   * absorber en silencio una merma real (por ejemplo, un robo) bajo "conté
   * y había menos", sin ninguna señal secundaria para el dueño.
   */
  app.post("/inventario/ajuste", { config: { rol: "ADMIN" } }, async (peticion, respuesta) => {
    const datos = z
      .object({
        itemId: z.string().min(1),
        cantidadContada: z.number().min(0),
        motivo: z.string().trim().min(1).max(200),
      })
      .parse(peticion.body);

    await pos.escribir(() => ajustarStock(pos.p, sedeParaEscribir(peticion), datos), peticion.actor);
    return respuesta.status(201).send({ itemId: datos.itemId, stock: pos.p.stockDe(peticion.sede, datos.itemId) });
  });

  /**
   * Varios productos en una sola compra: cada línea entra al inventario con
   * su costo (actualiza el promedio ponderado) y, si de verdad salió plata
   * del cajón, se registra el egreso solo — no hay que anotarlo dos veces.
   */
  app.post("/inventario/compra", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const datos = z
      .object({
        lineas: z
          .array(
            z.object({
              itemId: z.string().min(1),
              cantidad: z.number().positive(),
              costoUnitario: z.number().int().min(0),
            }),
          )
          .min(1),
        proveedor: z.string().trim().max(80).optional(),
        comprobante: z.string().trim().max(80).optional(),
        salioDeLaCaja: z.boolean().optional(),
      })
      .parse(peticion.body);

    const resultado = await pos.transaccion(() => {
      const r = registrarCompra(pos.p, sedeParaEscribir(peticion), datos);
      return { eventos: r.eventos, resultado: r };
    }, peticion.actor);

    return respuesta.status(201).send({
      compraId: resultado.compraId,
      total: resultado.total,
      productos: datos.lineas.map((l) => ({ itemId: l.itemId, stock: pos.p.stockDe(peticion.sede, l.itemId) })),
    });
  });

  app.post("/inventario/merma", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const datos = z
      .object({
        itemId: z.string().min(1),
        cantidad: z.number().positive(),
        motivo: z.string().trim().min(1).max(200),
      })
      .parse(peticion.body);

    await pos.escribir(() => registrarMerma(pos.p, sedeParaEscribir(peticion), datos), peticion.actor);
    return respuesta.status(201).send({ itemId: datos.itemId, stock: pos.p.stockDe(peticion.sede, datos.itemId) });
  });

  app.get("/inventario/:itemId/kardex", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
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

    return { item, stock: pos.p.stockDe(peticion.sede, itemId), movimientos: await kardexDe(pos.almacen, itemId, limite) };
  });
}
