/**
 * Caja: apertura, arqueo en vivo y cierre de turno.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { CATEGORIAS_EGRESO } from "@cupula/contratos";
import { abrirTurno, arquear, cerrarTurno, registrarEgreso } from "../../dominio/caja/caja";
import { ErrorDeNegocio } from "../../dominio/errores";
import type { DatosDelCierre } from "../../puertos/Impresora";
import type { Dependencias } from "../app";

/**
 * Los egresos del turno, del más reciente al más viejo.
 *
 * Se devuelven con el arqueo y no en una ruta aparte: quien cuadra el cajón
 * necesita ver EN QUÉ se fue la plata en el mismo lugar donde lee cuánto
 * falta. Un total de egresos sin el detalle obliga a confiar en el número.
 */
function egresosDelTurno(pos: Dependencias["pos"], turnoId: string) {
  return [...pos.p.egresos.values()]
    .filter((e) => e.turnoId === turnoId)
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

export async function rutasCaja(app: FastifyInstance, { pos, respaldos, impresora, notificaciones }: Dependencias) {
  app.get("/caja", { config: { rol: "CAJERO" } }, async (peticion) => {
    const sede = peticion.sede;
    if (!pos.p.turnoAbiertoDe(sede)) {
      // El último turno de ESTA sucursal: el de otro local no dice nada sobre
      // con cuánto conviene abrir este cajón.
      const ultimo = [...pos.p.turnos.values()]
        .filter((t) => t.sedeId === sede)
        .sort((a, b) => b.abiertoEn.localeCompare(a.abiertoEn))[0];
      return { abierto: false, ultimoTurno: ultimo ?? null };
    }
    const arqueo = arquear(pos.p, sede);
    return { abierto: true, arqueo, egresos: egresosDelTurno(pos, arqueo.turnoId) };
  });

  /**
   * Registra una salida de efectivo del cajón.
   *
   * No exige turno abierto: negarse a registrar un gasto porque nadie abrió la
   * caja haría que el gasto no quede en ningún lado, y eso es justo lo que
   * rompía el arqueo antes de que esto existiera.
   */
  app.post("/caja/egreso", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const datos = z
      .object({
        monto: z.number().int().min(1),
        motivo: z.string().trim().min(1).max(200),
        comprobante: z.string().trim().max(80).optional(),
        categoria: z.enum(CATEGORIAS_EGRESO).optional(),
        barberoId: z.string().min(1).optional(),
      })
      .parse(peticion.body);

    const egresoId = await pos.transaccion(() => {
      const r = registrarEgreso(pos.p, peticion.sede, datos);
      return { eventos: r.eventos, resultado: r.egresoId };
    }, peticion.actor);

    return respuesta.status(201).send({
      egreso: pos.p.egresos.get(egresoId),
      arqueo: pos.p.turnoAbiertoDe(peticion.sede) ? arquear(pos.p, peticion.sede) : null,
    });
  });

  app.post("/caja/abrir", { config: { rol: "CAJERO" } }, async (peticion, respuesta) => {
    const { montoInicial, notas } = z
      .object({
        montoInicial: z.number().int().min(0),
        notas: z.string().trim().max(500).optional(),
      })
      .parse(peticion.body);

    const turnoId = await pos.transaccion(() => {
      const r = abrirTurno(pos.p, peticion.sede, { montoInicial, notas });
      return { eventos: r.eventos, resultado: r.turnoId };
    }, peticion.actor);

    return respuesta.status(201).send({ turno: pos.p.turnos.get(turnoId) });
  });

  app.post("/caja/cerrar", { config: { rol: "CAJERO" } }, async (peticion) => {
    const { contadoEfectivo, notas } = z
      .object({
        contadoEfectivo: z.number().int().min(0),
        notas: z.string().trim().max(500).optional(),
      })
      .parse(peticion.body);

    const cierre = await pos.transaccion(() => {
      const r = cerrarTurno(pos.p, peticion.sede, { contadoEfectivo, notas });
      return { eventos: r.eventos, resultado: r };
    }, peticion.actor);

    // El cierre de turno es el momento natural para tres tareas de
    // mantenimiento: dejar el arranque acotado, confirmarle al dueño que los
    // datos del día están íntegros, y respaldar.
    //
    // El respaldo aquí importa más que el horario: cerrar la caja es JUSTO lo
    // que se hace antes de apagar la computadora, así que es la última
    // oportunidad de guardar el día completo.
    //
    // No se espera a que termine ni se falla el cierre si falla: la persona
    // está parada frente al cajón con la plata contada. El resultado queda en
    // el registro y la pantalla de Ajustes muestra cuándo fue el último.
    await pos.instantanea().catch(() => undefined);
    const integridad = await pos.almacen.verificar();
    void respaldos
      .crear("cierre")
      .then((r) => {
        if (!r.ok) app.log.error({ motivo: r.motivo }, "falló el respaldo al cerrar turno");
      })
      .catch((e) => app.log.error({ err: e }, "falló el respaldo al cerrar turno"));

    // El reporte del día se manda recién cuando cierra caja, nunca antes —
    // y si cierran dos veces el mismo día, esto reprograma el envío en vez
    // de duplicarlo: solo sale un correo, el del último cierre.
    notificaciones.alCerrarTurno();

    return {
      turno: pos.p.turnos.get(cierre.arqueo.turnoId),
      arqueo: cierre.arqueo,
      egresos: egresosDelTurno(pos, cierre.arqueo.turnoId),
      diferencia: cierre.diferencia,
      integridad: { ok: integridad.ok, eventos: integridad.eventos, ultimaSeq: integridad.ultimaSeq },
    };
  });

  app.get("/caja/turnos", { config: { rol: "CAJERO" } }, async (peticion) => {
    const { limite } = z
      .object({ limite: z.coerce.number().int().min(1).max(200).default(30) })
      .parse(peticion.query);

    const turnos = [...pos.p.turnos.values()]
      .filter((t) => t.sedeId === peticion.sede)
      .sort((a, b) => b.abiertoEn.localeCompare(a.abiertoEn))
      .slice(0, limite);
    return { turnos };
  });

  /**
   * Imprime el papel del cierre de un turno YA cerrado. No vuelve a escribir
   * nada —no es un evento, es releer lo que ya quedó en el log— así que se
   * puede reimprimir el cierre de hoy o el de la semana pasada por igual.
   */
  app.post("/caja/turnos/:turnoId/imprimir", { config: { rol: "CAJERO" } }, async (peticion) => {
    const { turnoId } = z.object({ turnoId: z.string().min(1) }).parse(peticion.params);
    const turno = pos.p.turnos.get(turnoId);
    if (!turno || !turno.cerradoEn) {
      throw new ErrorDeNegocio(
        "TURNO_NO_ABIERTO",
        "Ese turno no está cerrado todavía.",
        "Solo se puede imprimir el cierre de un turno ya cerrado.",
      );
    }

    const arqueo = arquear(pos.p, turno.sedeId, turnoId);
    const datos: DatosDelCierre = {
      turnoId: turno.id,
      abiertoEn: turno.abiertoEn,
      cerradoEn: turno.cerradoEn,
      montoInicial: arqueo.montoInicial,
      medios: arqueo.medios,
      totalVendido: arqueo.totalVendido,
      cantidadVentas: arqueo.cantidadVentas,
      egresos: egresosDelTurno(pos, turnoId)
        .slice()
        .reverse()
        .map((e) => ({ monto: e.monto, motivo: e.motivo })),
      totalEgresos: arqueo.egresos,
      efectivoEnCajon: arqueo.efectivoEnCajon,
      contadoEfectivo: turno.contadoEfectivo ?? 0,
      diferencia: turno.diferencia ?? 0,
      porBarbero: arqueo.porBarbero,
    };

    return impresora.imprimirCierre(datos, {
      nombre: pos.config<string>("negocio.nombre"),
      direccion: pos.config<string>("negocio.direccion"),
      ciudad: pos.config<string>("negocio.ciudad"),
      ruc: pos.config<string>("negocio.ruc"),
      pie: pos.config<string>("negocio.pie"),
    });
  });
}
