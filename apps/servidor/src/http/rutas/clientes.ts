/**
 * Clientes e integración con la tarjeta de fidelidad de TarjetaCloud.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  actualizarCliente,
  buscarClientes,
  registrarCliente,
  vincularFidelidad,
} from "../../dominio/clientes/clientes";
import type { Dependencias } from "../app";

export async function rutasClientes(app: FastifyInstance, { pos }: Dependencias) {
  app.get("/clientes", async (peticion) => {
    const { q, limite } = z
      .object({
        q: z.string().optional(),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(peticion.query);

    if (q && q.trim().length >= 2) {
      return { clientes: buscarClientes(pos.p, q, limite) };
    }

    // Sin término de búsqueda: los que vinieron más recientemente. Es lo útil
    // en el mostrador, y evita volcar la base entera.
    const clientes = [...pos.p.clientes.values()]
      .sort((a, b) => (b.ultimaVisita ?? "").localeCompare(a.ultimaVisita ?? ""))
      .slice(0, limite);
    return { clientes };
  });

  app.post("/clientes", async (peticion, respuesta) => {
    const datos = z
      .object({
        nombre: z.string().trim().min(1).max(80),
        telefono: z.string().trim().max(20).optional(),
        notas: z.string().trim().max(500).optional(),
        serial: z.string().trim().max(64).optional(),
        /** Crear igual uno con el mismo nombre, a pedido expreso. */
        permitirHomonimo: z.boolean().optional(),
      })
      .parse(peticion.body);

    const { clienteId, homonimos } = await pos.transaccion(() => {
      const r = registrarCliente(pos.p, datos);
      return { eventos: r.eventos, resultado: { clienteId: r.clienteId, homonimos: r.homonimos } };
    });

    return respuesta.status(201).send({
      cliente: pos.p.clientes.get(clienteId),
      // Solo llegan aquí si vino `permitirHomonimo`: el alta normal ya se
      // rechazó con CLIENTE_REPETIDO. Se devuelven para que la pantalla pueda
      // mostrar con quién comparte nombre.
      homonimos: homonimos.map((h) => ({ id: h.id, nombre: h.nombre, ultimaVisita: h.ultimaVisita })),
    });
  });

  app.get("/clientes/:id", async (peticion, respuesta) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const cliente = pos.p.clientes.get(id);
    if (!cliente) {
      return respuesta.status(404).send({
        error: { codigo: "CLIENTE_NO_EXISTE", mensaje: "Ese cliente no existe." },
      });
    }

    const ventas = [...pos.p.ventas.values()]
      .filter((v) => v.clienteId === id)
      .sort((a, b) => b.ts.localeCompare(a.ts));

    // Qué consume habitualmente: lo primero que uno quiere saber al abrir la
    // ficha de alguien que está sentado en la silla.
    const frecuencia = new Map<string, { nombre: string; veces: number }>();
    for (const venta of ventas) {
      if (venta.anulada) continue;
      for (const linea of venta.lineas) {
        const acum = frecuencia.get(linea.itemId) ?? { nombre: linea.nombre, veces: 0 };
        acum.veces += 1;
        frecuencia.set(linea.itemId, acum);
      }
    }

    return {
      cliente,
      ventas: ventas.slice(0, 50),
      habituales: [...frecuencia.values()].sort((a, b) => b.veces - a.veces).slice(0, 5),
    };
  });

  app.patch("/clientes/:id", async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const cambios = z
      .object({
        nombre: z.string().trim().min(1).max(80).optional(),
        telefono: z.string().trim().max(20).optional(),
        notas: z.string().trim().max(500).optional(),
      })
      .parse(peticion.body);

    await pos.escribir(() => actualizarCliente(pos.p, id, cambios));
    return { cliente: pos.p.clientes.get(id) };
  });

  /**
   * Vincula una tarjeta de fidelidad a un cliente.
   *
   * `origen` deja constancia de CÓMO se supo que son la misma persona. No es
   * burocracia: si el QR del programa está en modo "nombre" (como está La
   * Cúpula hoy), la identificación pasó por un cotejo de texto que pudo
   * confundir a dos homónimos. Un vínculo hecho por serial es exacto; uno
   * hecho por nombre es una apuesta razonable. Poder distinguirlos después
   * vale la pena.
   */
  app.post("/clientes/:id/fidelidad", async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { serial, origen } = z
      .object({
        serial: z.string().trim().min(3).max(64),
        origen: z.enum(["serial", "nombre", "manual"]).default("manual"),
      })
      .parse(peticion.body);

    await pos.escribir(() => vincularFidelidad(pos.p, id, serial, origen));
    return { cliente: pos.p.clientes.get(id) };
  });
}
