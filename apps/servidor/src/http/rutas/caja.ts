/**
 * Caja: apertura, arqueo en vivo y cierre de turno.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { abrirTurno, arquear, cerrarTurno } from "../../dominio/caja/caja";
import type { Dependencias } from "../app";

/**
 * Se repite en cada respuesta de caja a propósito: la persona que cuadra el
 * cajón tiene que ver por qué el número puede no dar, en el mismo lugar donde
 * lee la diferencia. Escondido en un manual no sirve.
 */
const ADVERTENCIA_EGRESOS =
  "El efectivo esperado no descuenta las salidas de dinero del cajón (compras, adelantos, taxi), " +
  "porque esta versión todavía no registra egresos. Toma la diferencia como referencia.";

export async function rutasCaja(app: FastifyInstance, { pos, respaldos }: Dependencias) {
  app.get("/caja", async () => {
    if (!pos.p.turnoAbierto) {
      const ultimo = [...pos.p.turnos.values()].sort((a, b) => b.abiertoEn.localeCompare(a.abiertoEn))[0];
      return { abierto: false, ultimoTurno: ultimo ?? null };
    }
    return {
      abierto: true,
      arqueo: arquear(pos.p),
      advertencia: ADVERTENCIA_EGRESOS,
    };
  });

  app.post("/caja/abrir", async (peticion, respuesta) => {
    const { montoInicial, notas } = z
      .object({
        montoInicial: z.number().int().min(0),
        notas: z.string().trim().max(500).optional(),
      })
      .parse(peticion.body);

    const turnoId = await pos.transaccion(() => {
      const r = abrirTurno(pos.p, { montoInicial, notas });
      return { eventos: r.eventos, resultado: r.turnoId };
    });

    return respuesta.status(201).send({ turno: pos.p.turnos.get(turnoId) });
  });

  app.post("/caja/cerrar", async (peticion) => {
    const { contadoEfectivo, notas } = z
      .object({
        contadoEfectivo: z.number().int().min(0),
        notas: z.string().trim().max(500).optional(),
      })
      .parse(peticion.body);

    const cierre = await pos.transaccion(() => {
      const r = cerrarTurno(pos.p, { contadoEfectivo, notas });
      return { eventos: r.eventos, resultado: r };
    });

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

    return {
      turno: pos.p.turnos.get(cierre.arqueo.turnoId),
      arqueo: cierre.arqueo,
      diferencia: cierre.diferencia,
      advertencia: ADVERTENCIA_EGRESOS,
      integridad: { ok: integridad.ok, eventos: integridad.eventos, ultimaSeq: integridad.ultimaSeq },
    };
  });

  app.get("/caja/turnos", async (peticion) => {
    const { limite } = z
      .object({ limite: z.coerce.number().int().min(1).max(200).default(30) })
      .parse(peticion.query);

    const turnos = [...pos.p.turnos.values()]
      .sort((a, b) => b.abiertoEn.localeCompare(a.abiertoEn))
      .slice(0, limite);
    return { turnos };
  });
}
