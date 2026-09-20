/**
 * Caja: apertura de turno, arqueo y cierre.
 *
 * ADVERTENCIA QUE HAY QUE SOSTENER A LA VISTA (está también en ARQUITECTURA.md
 * §1): la v1 NO registra egresos de caja. El efectivo esperado que calcula
 * este módulo ignora las salidas de dinero del cajón —compra de insumos,
 * adelanto a un barbero, el taxi—, así que la diferencia del arqueo es una
 * referencia, no una verdad. El evento `caja.egreso_registrado` está reservado
 * en el contrato para encenderlo cuando el cliente lo pida.
 *
 * Por eso la pantalla de cierre muestra la advertencia junto a la diferencia,
 * en vez de presentarla como un faltante.
 */

import type { Centimos, EventoNuevo } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import { mediosEnCero } from "../../proyecciones/tipos";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

export function abrirTurno(
  p: Proyeccion,
  datos: { montoInicial: Centimos; notas?: string },
): { eventos: EventoNuevo[]; turnoId: string } {
  if (p.turnoAbierto) {
    throw new ErrorDeNegocio(
      "TURNO_YA_ABIERTO",
      `Ya hay un turno abierto desde ${horaDe(p.turnoAbierto.abiertoEn)}.`,
      "Ciérralo antes de abrir uno nuevo.",
    );
  }
  if (datos.montoInicial < 0) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "El monto inicial no puede ser negativo.");
  }

  const turnoId = ulid();
  return {
    turnoId,
    eventos: [
      { tipo: "caja.turno_abierto", datos: { turnoId, montoInicial: datos.montoInicial, notas: datos.notas } },
    ],
  };
}

export interface ArqueoDelTurno {
  turnoId: string;
  abiertoEn: string;
  montoInicial: Centimos;
  medios: ReturnType<typeof mediosEnCero>;
  totalVendido: Centimos;
  cantidadVentas: number;
  /** Lo que debería haber en el cajón: inicial + cobrado en efectivo. */
  efectivoEnCajon: Centimos;
  ventasAnuladas: number;
  /** Ventas cobradas con la caja cerrada. No entran en `efectivoEnCajon`. */
  ventasFueraDeTurno: number;
  totalFueraDeTurno: Centimos;
  /** Efectivo de esas ventas. Está en el cajón aunque el arqueo no lo espere. */
  efectivoFueraDeTurno: Centimos;
}

/**
 * Calcula el arqueo del turno abierto sin cerrarlo. Es lo que la pantalla de
 * caja muestra en vivo durante el día.
 */
export function arquear(p: Proyeccion, turnoId?: string): ArqueoDelTurno {
  const turno = turnoId ? p.turnos.get(turnoId) : p.turnoAbierto;
  if (!turno) {
    throw new ErrorDeNegocio(
      "TURNO_NO_ABIERTO",
      "No hay ningún turno abierto.",
      "Abre la caja para empezar a llevar el arqueo del día.",
    );
  }

  const medios = mediosEnCero();
  let totalVendido = 0;
  let cantidadVentas = 0;
  let ventasAnuladas = 0;
  let ventasFueraDeTurno = 0;
  let totalFueraDeTurno = 0;
  let efectivoFueraDeTurno = 0;

  /**
   * Las ventas cobradas con la caja cerrada se reportan en el turno SIGUIENTE:
   * desde que cerró el turno anterior (o desde el inicio de ese día) hasta que
   * este cierra.
   *
   * Antes solo se miraban desde la apertura, así que el efectivo cobrado un
   * rato ANTES de abrir la caja no aparecía en ningún arqueo: estaba en el
   * cajón pero no lo esperaba nadie, y el cierre daba sobrante sin explicación.
   */
  let desdeFuera = `${turno.abiertoEn.slice(0, 10)}T00:00:00`;
  for (const otro of p.turnos.values()) {
    if (otro.id !== turno.id && otro.cerradoEn && otro.cerradoEn <= turno.abiertoEn && otro.cerradoEn > desdeFuera) {
      desdeFuera = otro.cerradoEn;
    }
  }

  for (const venta of p.ventas.values()) {
    if (turno.cerradoEn && venta.ts > turno.cerradoEn) continue;

    if (venta.turnoId === null) {
      if (venta.ts >= desdeFuera && !venta.anulada) {
        ventasFueraDeTurno++;
        totalFueraDeTurno += venta.total;
        for (const pago of venta.pagos) if (pago.medio === "EFECTIVO") efectivoFueraDeTurno += pago.monto;
      }
      continue;
    }

    if (venta.ts < turno.abiertoEn) continue;
    if (venta.turnoId !== turno.id) continue;
    if (venta.anulada) {
      ventasAnuladas++;
      continue;
    }

    cantidadVentas++;
    totalVendido += venta.total;
    for (const pago of venta.pagos) medios[pago.medio] += pago.monto;
  }

  return {
    turnoId: turno.id,
    abiertoEn: turno.abiertoEn,
    montoInicial: turno.montoInicial,
    medios,
    totalVendido,
    cantidadVentas,
    efectivoEnCajon: turno.montoInicial + medios.EFECTIVO,
    ventasAnuladas,
    ventasFueraDeTurno,
    totalFueraDeTurno,
    efectivoFueraDeTurno,
  };
}

export function cerrarTurno(
  p: Proyeccion,
  datos: { contadoEfectivo: Centimos; notas?: string },
): { eventos: EventoNuevo[]; arqueo: ArqueoDelTurno; diferencia: Centimos } {
  const arqueo = arquear(p);
  if (datos.contadoEfectivo < 0) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "Lo contado no puede ser negativo.");
  }

  // Negativo = falta dinero en el cajón.
  const diferencia = datos.contadoEfectivo - arqueo.efectivoEnCajon;

  return {
    arqueo,
    diferencia,
    eventos: [
      {
        tipo: "caja.turno_cerrado",
        datos: {
          turnoId: arqueo.turnoId,
          esperado: {
            montoInicial: arqueo.montoInicial,
            efectivo: arqueo.medios.EFECTIVO,
            yape: arqueo.medios.YAPE,
            tarjeta: arqueo.medios.TARJETA,
            totalVendido: arqueo.totalVendido,
            efectivoEnCajon: arqueo.efectivoEnCajon,
          },
          contadoEfectivo: datos.contadoEfectivo,
          diferencia,
          cantidadVentas: arqueo.cantidadVentas,
          notas: datos.notas,
        },
      },
    ],
  };
}

function horaDe(iso: string): string {
  return iso.slice(11, 16);
}
