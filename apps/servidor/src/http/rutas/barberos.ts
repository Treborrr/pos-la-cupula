/**
 * Barberos: alta, producción por semana y adelantos. Solo atribución y
 * gestión — nada de comisiones ni liquidación de sueldo (D6 de
 * ARQUITECTURA.md). "Liquidar" acá es saldar los adelantos, no pagar sueldo.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  actualizarBarbero,
  crearBarbero,
  desactivarBarbero,
  liquidarBarbero,
  reactivarBarbero,
} from "../../dominio/barberos/barberos";
import { reporteDeBarbero } from "../../consultas/barberos";
import { booleanoDeQuery } from "./catalogo";
import type { Dependencias } from "../app";

export async function rutasBarberos(app: FastifyInstance, { pos }: Dependencias) {
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

  /**
   * Producción semana a semana —incluidos los cortes gratis— y los adelantos
   * sin liquidar. `desde`/`hasta` acotan qué semanas se traen; los adelantos
   * pendientes y la última liquidación no dependen del rango: son el estado
   * actual de la cuenta, se mire la semana que se mire.
   */
  app.get("/barberos/:id/reporte", async (peticion, respuesta) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { desde, hasta } = z
      .object({
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(peticion.query);

    const barbero = pos.p.barberos.get(id);
    if (!barbero) {
      return respuesta.status(404).send({
        error: { codigo: "BARBERO_NO_EXISTE", mensaje: "No existe ese barbero." },
      });
    }

    return { barbero, ...reporteDeBarbero(pos.p, id, desde, hasta) };
  });

  /**
   * Salda los adelantos pendientes de un barbero. No paga sueldo ni calcula
   * comisión: eso sigue totalmente fuera del sistema.
   */
  app.post("/barberos/:id/liquidar", async (peticion, respuesta) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { notas } = z.object({ notas: z.string().trim().max(500).optional() }).parse(peticion.body ?? {});

    const liquidacionId = await pos.transaccion(() => {
      const r = liquidarBarbero(pos.p, id, notas);
      return { eventos: r.eventos, resultado: r.liquidacionId };
    });

    return respuesta.status(201).send({ liquidacion: pos.p.liquidaciones.get(liquidacionId) });
  });
}
