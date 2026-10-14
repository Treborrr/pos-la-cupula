/**
 * Ventas: cobrar, consultar, anular, reimprimir. Y los reportes, que salen de
 * las mismas proyecciones.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { coincide } from "@cupula/contratos";
import type { Venta } from "../../proyecciones/tipos";
import { construirReporte } from "../../consultas/reportes";
import { registrarPropina } from "../../dominio/venta/propina";
import type { Dependencias } from "../app";
import { booleanoDeQuery } from "./catalogo";

const esquemaPago = z.object({
  medio: z.enum(["EFECTIVO", "YAPE", "TARJETA", "ADELANTO"]),
  monto: z.number().int().min(1),
  recibido: z.number().int().min(0).optional(),
  vuelto: z.number().int().min(0).optional(),
  /** Obligatorio cuando medio es ADELANTO: a qué barbero se le descuenta. */
  barberoId: z.string().min(1).optional(),
});

const esquemaCobro = z.object({
  lineas: z
    .array(
      z.object({
        itemId: z.string().min(1),
        cantidad: z.number().positive(),
        precioUnitario: z.number().int().min(0).optional(),
        barberoId: z.string().nullable().optional(),
        /** Propina para el barbero de esta línea. No es parte del cobro. */
        propina: z.number().int().min(1).optional(),
      }),
    )
    .min(1),
  pagos: z.array(esquemaPago).min(1),
  descuento: z.number().int().min(0).optional(),
  clienteId: z.string().nullable().optional(),
  notas: z.string().trim().max(500).optional(),
  /**
   * La genera la pantalla al abrirse, no el servidor. Es lo que permite que un
   * reintento después de un timeout devuelva la MISMA venta en vez de cobrar
   * dos veces.
   */
  claveIdempotencia: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  /** Opcional: si viene, se manda un recibo por correo además del ticket. */
  correoRecibo: z.string().trim().email().optional(),
});

export async function rutasVentas(app: FastifyInstance, { pos, impresora, notificaciones }: Dependencias) {
  app.post("/ventas", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const pedido = esquemaCobro.parse(peticion.body);
    const { venta, advertencias, duplicada } = await pos.cobrar(pedido, peticion.actor);

    // La impresión va DESPUÉS de que la venta está en disco, y su resultado no
    // afecta al de la venta: que falle la ticketera no puede deshacer un cobro
    // ni impedir que se responda que se cobró. El correo del recibo sigue la
    // misma regla.
    const impresion = await imprimir(venta).catch((e) => ({
      impreso: false,
      vistaPrevia: "",
      motivo: e instanceof Error ? e.message : "Falló la impresión",
    }));

    let correo: { enviado: boolean; detalle?: string } | undefined;
    if (pedido.correoRecibo) {
      const resultado = await notificaciones
        .notificarRecibo(pedido.correoRecibo, venta, datosDelNegocio(), opcionesDeImpresion(venta))
        .catch((e) => ({ ok: false, detalle: e instanceof Error ? e.message : "Falló el envío" }));
      correo = { enviado: resultado.ok, detalle: resultado.detalle };
    }

    return respuesta.status(duplicada ? 200 : 201).send({
      venta,
      advertencias,
      duplicada,
      impresion,
      correo,
    });
  });

  app.get("/ventas", { config: { rol: "CAJERO" } }, async (peticion) => {
    const { dia, desde, hasta, q, limite, incluirAnuladas } = z
      .object({
        dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        q: z.string().optional(),
        limite: z.coerce.number().int().min(1).max(500).default(100),
        incluirAnuladas: booleanoDeQuery().default(true),
      })
      .parse(peticion.query);

    let ventas: Venta[];
    if (dia) {
      ventas = pos.p.ventasDelDia(dia);
    } else if (desde || hasta) {
      const d = desde ?? "0000-00-00";
      const h = hasta ?? "9999-99-99";
      ventas = [...pos.p.ventas.values()].filter((v) => {
        const f = v.ts.slice(0, 10);
        return f >= d && f <= h;
      });
    } else {
      ventas = [...pos.p.ventas.values()];
    }

    if (!incluirAnuladas) ventas = ventas.filter((v) => !v.anulada);
    if (q) {
      ventas = ventas.filter(
        (v) =>
          v.correlativo.toUpperCase().includes(q.trim().toUpperCase()) ||
          v.lineas.some((l) => coincide(l.nombre, q)),
      );
    }

    // Más recientes primero: en el mostrador siempre se busca algo de recién.
    ventas.sort((a, b) => b.ts.localeCompare(a.ts));
    const totales = pos.p.totalesDe(ventas);

    return { ventas: ventas.slice(0, limite), cantidadTotal: ventas.length, totales };
  });

  app.get("/ventas/:id", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    // Acepta el id interno o el correlativo: la pistola devuelve correlativo,
    // la lista de la pantalla tiene el id.
    const venta = pos.p.ventas.get(id) ?? pos.p.ventaPorCorrelativo(id);
    if (!venta) {
      return respuesta.status(404).send({
        error: { codigo: "VENTA_NO_EXISTE", mensaje: `No existe la venta ${id}.` },
      });
    }
    return {
      venta,
      vistaPreviaTicket: (await imprimir(venta, true)).vistaPrevia,
      propinas: pos.p.propinasPorVenta.get(venta.id) ?? [],
    };
  });

  app.post("/ventas/:id/anular", { config: { rol: "CAJERO" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { motivo } = z.object({ motivo: z.string().trim().min(3).max(200) }).parse(peticion.body);
    const ventaId = pos.p.ventas.has(id) ? id : (pos.p.ventaPorCorrelativo(id)?.id ?? id);
    return { venta: await pos.anular(ventaId, motivo, peticion.actor) };
  });

  app.post("/ventas/:id/reimprimir", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const venta = pos.p.ventas.get(id) ?? pos.p.ventaPorCorrelativo(id);
    if (!venta) {
      return respuesta.status(404).send({
        error: { codigo: "VENTA_NO_EXISTE", mensaje: `No existe la venta ${id}.` },
      });
    }
    await pos.registrarReimpresion(venta.id, peticion.actor);
    return { venta: pos.p.ventas.get(venta.id), impresion: await imprimir(venta, true) };
  });

  /**
   * Agrega una propina DESPUÉS de cobrar: el cliente volvió, o se olvidó
   * anotarla al momento. La que se anota junto con el carrito va por
   * `POST /ventas` (campo `propina` de cada línea); esta es la vía para
   * corregirla más tarde, referenciando una venta que ya existe.
   */
  app.post("/ventas/:id/propina", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const venta = pos.p.ventas.get(id) ?? pos.p.ventaPorCorrelativo(id);
    if (!venta) {
      return respuesta.status(404).send({
        error: { codigo: "VENTA_NO_EXISTE", mensaje: `No existe la venta ${id}.` },
      });
    }

    const { lineaIndex, barberoId, monto } = z
      .object({
        lineaIndex: z.number().int().min(0),
        barberoId: z.string().min(1),
        monto: z.number().int().min(1),
      })
      .parse(peticion.body);

    await pos.transaccion(() => {
      const r = registrarPropina(pos.p, { ventaId: venta.id, lineaIndex, barberoId, monto });
      return { eventos: r.eventos, resultado: r.propinaId };
    }, peticion.actor);

    return respuesta.status(201).send({ propinas: pos.p.propinasPorVenta.get(venta.id) ?? [] });
  });

  // ── Reportes ──────────────────────────────────────────────────────────────

  app.get("/reportes/resumen", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { desde, hasta } = z
      .object({
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(peticion.query);

    // El cálculo entero vive en `consultas/reportes`: la ruta solo valida el
    // rango y devuelve. Así se puede probar el reporte sin levantar HTTP.
    return construirReporte(pos.p, desde, hasta);
  });

  function datosDelNegocio() {
    return {
      nombre: pos.config<string>("negocio.nombre"),
      direccion: pos.config<string>("negocio.direccion"),
      ciudad: pos.config<string>("negocio.ciudad"),
      ruc: pos.config<string>("negocio.ruc"),
      pie: pos.config<string>("negocio.pie"),
    };
  }

  /** Lo mismo le hace falta al ticket impreso y al recibo por correo. */
  function opcionesDeImpresion(venta: Venta, reimpresion = false) {
    const nombresDeBarbero: Record<string, string> = {};
    for (const linea of venta.lineas) {
      if (linea.barberoId) {
        nombresDeBarbero[linea.barberoId] = pos.p.barberos.get(linea.barberoId)?.nombre ?? "";
      }
    }

    return {
      reimpresion,
      nombresDeBarbero,
      nombreDelCliente: venta.clienteId ? pos.p.clientes.get(venta.clienteId)?.nombre : undefined,
    };
  }

  async function imprimir(venta: Venta, reimpresion = false) {
    return impresora.imprimirVenta(venta, datosDelNegocio(), opcionesDeImpresion(venta, reimpresion));
  }
}
