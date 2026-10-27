/**
 * Caja: apertura de turno, egresos, arqueo y cierre.
 *
 * EL EFECTIVO ESPERADO ES: inicial + cobrado en efectivo − lo que salió.
 *
 * Ese último término faltó hasta la v0.6.0 y era el defecto más grande del
 * sistema. Sin registrar las salidas —compra de insumos, un adelanto a un
 * barbero, el taxi— el arqueo decía S/ 480 cuando en el cajón había S/ 430, y
 * nadie podía explicar la diferencia. El problema no era el número equivocado:
 * era que una caja que nunca cuadra es una caja que nadie mira, y entonces un
 * faltante de verdad pasa inadvertido entre el ruido.
 *
 * Un egreso lleva MOTIVO obligatorio por la misma razón: un egreso sin motivo
 * es indistinguible de plata que falta.
 */

import type { CategoriaEgreso, Centimos, EventoNuevo } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import { mediosEnCero } from "../../proyecciones/tipos";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

/**
 * La caja es de la sucursal: dos locales pueden tener turno abierto a la vez.
 * Lo que sigue siendo imposible es que UNO tenga dos.
 */
export function abrirTurno(
  p: Proyeccion,
  sedeId: string,
  datos: { montoInicial: Centimos; notas?: string },
): { eventos: EventoNuevo[]; turnoId: string } {
  const abierto = p.turnoAbiertoDe(sedeId);
  if (abierto) {
    throw new ErrorDeNegocio(
      "TURNO_YA_ABIERTO",
      `Ya hay un turno abierto desde ${horaDe(abierto.abiertoEn)}.`,
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
      {
        tipo: "caja.turno_abierto",
        datos: { turnoId, sedeId, montoInicial: datos.montoInicial, notas: datos.notas },
      },
    ],
  };
}

/**
 * Registra una salida de efectivo del cajón.
 *
 * NO exige turno abierto. Igual que con las ventas: negarse a registrarlo
 * porque nadie abrió la caja haría que el gasto no quede en ningún lado, y un
 * egreso sin turno es infinitamente mejor que un egreso sin registrar. El
 * arqueo del turno siguiente lo reporta aparte, como ya hace con las ventas
 * cobradas con la caja cerrada.
 */
export function registrarEgreso(
  p: Proyeccion,
  sedeId: string,
  datos: {
    monto: Centimos;
    motivo: string;
    comprobante?: string;
    categoria?: CategoriaEgreso;
    barberoId?: string;
  },
): { eventos: EventoNuevo[]; egresoId: string } {
  if (!(datos.monto > 0)) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "El monto del egreso tiene que ser mayor a cero.");
  }
  if (!datos.motivo?.trim()) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "Falta decir para qué salió la plata.",
      "Un egreso sin motivo es indistinguible de un faltante al cerrar la caja.",
    );
  }

  const categoria = datos.categoria ?? "OTRO";

  // Solo ADELANTO lleva barbero: es la única categoría que se le descuenta a
  // alguien en particular. Las demás con barbero serían un dato suelto que
  // nadie sabría de dónde salió.
  if (categoria === "ADELANTO") {
    if (!datos.barberoId) {
      throw new ErrorDeNegocio(
        "DATO_INVALIDO",
        "Un adelanto tiene que decir a qué barbero se le dio.",
        "Elige el barbero antes de guardar.",
      );
    }
    const barbero = p.barberos.get(datos.barberoId);
    if (!barbero || !barbero.activo) {
      throw new ErrorDeNegocio("BARBERO_INACTIVO", "Ese barbero ya no está activo.");
    }
  } else if (datos.barberoId) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "Solo un adelanto puede llevar barbero.");
  }

  const egresoId = ulid();
  return {
    egresoId,
    eventos: [
      {
        tipo: "caja.egreso_registrado",
        datos: {
          egresoId,
          sedeId,
          turnoId: p.turnoAbiertoDe(sedeId)?.id ?? null,
          monto: datos.monto,
          motivo: datos.motivo.trim(),
          comprobante: datos.comprobante?.trim() || undefined,
          categoria,
          barberoId: categoria === "ADELANTO" ? datos.barberoId : undefined,
        },
      },
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
  /** Lo que salió del cajón en este turno. */
  egresos: Centimos;
  cantidadEgresos: number;
  /** Lo que debería haber en el cajón: inicial + efectivo cobrado − egresos. */
  efectivoEnCajon: Centimos;
  ventasAnuladas: number;
  /** Ventas cobradas con la caja cerrada. No entran en `efectivoEnCajon`. */
  ventasFueraDeTurno: number;
  totalFueraDeTurno: Centimos;
  /** Efectivo de esas ventas. Está en el cajón aunque el arqueo no lo espere. */
  efectivoFueraDeTurno: Centimos;
  /** Egresos registrados con la caja cerrada: también salieron del cajón. */
  egresosFueraDeTurno: Centimos;
  /**
   * Producción por barbero EN ESTE TURNO. Mismo criterio que el reporte de
   * período (por línea, no por venta: una venta puede tener servicios de más
   * de un barbero) para que el papel del cierre y la pantalla de Reportes
   * nunca cuenten distinto lo mismo. Dato de gestión, NO una liquidación
   * (D6: sueldo fijo, sin comisiones).
   */
  porBarbero: { barberoId: string; nombre: string; cantidad: number; total: Centimos }[];
}

/**
 * Calcula el arqueo del turno abierto sin cerrarlo. Es lo que la pantalla de
 * caja muestra en vivo durante el día.
 */
export function arquear(p: Proyeccion, sedeId: string, turnoId?: string): ArqueoDelTurno {
  const turno = turnoId ? p.turnos.get(turnoId) : p.turnoAbiertoDe(sedeId);
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
  let egresos = 0;
  let cantidadEgresos = 0;
  let egresosFueraDeTurno = 0;
  const porBarbero = new Map<string, { cantidad: number; total: Centimos }>();

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
    // Solo los turnos de ESTA sucursal: el cierre del otro local no tiene nada
    // que decir sobre desde cuándo cuenta la plata de este cajón.
    if (otro.sedeId !== turno.sedeId) continue;
    if (otro.id !== turno.id && otro.cerradoEn && otro.cerradoEn <= turno.abiertoEn && otro.cerradoEn > desdeFuera) {
      desdeFuera = otro.cerradoEn;
    }
  }

  for (const venta of p.ventas.values()) {
    // Las ventas de otra sucursal no son de este cajón. Sin este filtro, una
    // venta cobrada en otro local con su caja cerrada aparecería acá como
    // "cobrada fuera de turno" y el arqueo esperaría plata que está a 200 km.
    if (venta.sedeId !== turno.sedeId) continue;
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
    for (const linea of venta.lineas) {
      if (!linea.barberoId) continue;
      const b = porBarbero.get(linea.barberoId) ?? { cantidad: 0, total: 0 };
      b.cantidad += linea.cantidad;
      b.total += linea.total;
      porBarbero.set(linea.barberoId, b);
    }
  }

  // Los egresos siguen exactamente las mismas reglas que las ventas: los del
  // turno se restan del efectivo esperado, y los registrados con la caja
  // cerrada se reportan aparte en el turno siguiente. Tratarlos distinto haría
  // que la plata que salió antes de abrir la caja no la esperara nadie.
  for (const egreso of p.egresos.values()) {
    if (egreso.sedeId !== turno.sedeId) continue;
    if (turno.cerradoEn && egreso.ts > turno.cerradoEn) continue;

    if (egreso.turnoId === null) {
      if (egreso.ts >= desdeFuera) egresosFueraDeTurno += egreso.monto;
      continue;
    }
    if (egreso.turnoId !== turno.id) continue;
    if (egreso.ts < turno.abiertoEn) continue;

    cantidadEgresos++;
    egresos += egreso.monto;
  }

  return {
    turnoId: turno.id,
    abiertoEn: turno.abiertoEn,
    montoInicial: turno.montoInicial,
    medios,
    totalVendido,
    cantidadVentas,
    egresos,
    cantidadEgresos,
    efectivoEnCajon: turno.montoInicial + medios.EFECTIVO - egresos,
    ventasAnuladas,
    ventasFueraDeTurno,
    totalFueraDeTurno,
    efectivoFueraDeTurno,
    egresosFueraDeTurno,
    porBarbero: [...porBarbero.entries()]
      .map(([barberoId, d]) => ({ barberoId, nombre: p.barberos.get(barberoId)?.nombre ?? "(eliminado)", ...d }))
      .sort((a, b) => b.total - a.total),
  };
}

export function cerrarTurno(
  p: Proyeccion,
  sedeId: string,
  datos: { contadoEfectivo: Centimos; notas?: string },
): { eventos: EventoNuevo[]; arqueo: ArqueoDelTurno; diferencia: Centimos } {
  const arqueo = arquear(p, sedeId);
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
          sedeId,
          esperado: {
            montoInicial: arqueo.montoInicial,
            efectivo: arqueo.medios.EFECTIVO,
            yape: arqueo.medios.YAPE,
            tarjeta: arqueo.medios.TARJETA,
            totalVendido: arqueo.totalVendido,
            egresos: arqueo.egresos,
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
