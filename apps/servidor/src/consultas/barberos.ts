/**
 * Reporte por barbero: producción semana a semana —incluidos los cortes
 * gratis— y los adelantos que todavía no se liquidaron.
 *
 * Es un dato de GESTIÓN, no una liquidación de sueldo: en La Cúpula los
 * barberos tienen sueldo fijo y el sistema no calcula comisiones (D6 de
 * ARQUITECTURA.md). Lo único que esto hace es mostrar cuánto produjo cada
 * uno y cuánto se le adelantó, para que el dueño decida con los números
 * delante — no para calcular nada por él.
 */

import type { Centimos } from "@cupula/contratos";

import { adelantosPendientesDeBarbero, type AdelantoDeBarbero } from "../dominio/barberos/barberos";
import type { Proyeccion } from "../proyecciones/Proyeccion";

export interface LineaDeBarbero {
  correlativo: string;
  ts: string;
  nombre: string;
  cantidad: number;
  precioUnitario: Centimos;
  total: Centimos;
  /** Precio de lista existía y se cobró en cero: una cortesía real. */
  gratis: boolean;
}

export interface SemanaDeBarbero {
  /** Lunes de la semana, "YYYY-MM-DD". */
  desde: string;
  /** Domingo de la semana. */
  hasta: string;
  lineas: LineaDeBarbero[];
  total: Centimos;
  cantidad: number;
  cantidadGratis: number;
}

export interface ReporteDeBarbero {
  semanas: SemanaDeBarbero[];
  adelantosPendientes: AdelantoDeBarbero[];
  saldoPendiente: Centimos;
  ultimaLiquidacion: { ts: string; monto: Centimos } | null;
}

export function reporteDeBarbero(
  p: Proyeccion,
  barberoId: string,
  desde: string,
  hasta: string,
): ReporteDeBarbero {
  const porSemana = new Map<string, LineaDeBarbero[]>();

  for (const venta of p.ventas.values()) {
    if (venta.anulada) continue;
    const dia = venta.ts.slice(0, 10);
    if (dia < desde || dia > hasta) continue;

    for (const linea of venta.lineas) {
      if (linea.barberoId !== barberoId) continue;

      const semana = lunesDeLaSemana(dia);
      const lista = porSemana.get(semana) ?? [];
      lista.push({
        correlativo: venta.correlativo,
        ts: venta.ts,
        nombre: linea.nombre,
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        total: linea.total,
        gratis: linea.precioUnitario === 0 && (linea.precioLista ?? 0) > 0,
      });
      porSemana.set(semana, lista);
    }
  }

  const semanas = [...porSemana.entries()]
    .map(([lunes, lineas]) => {
      const ordenadas = [...lineas].sort((a, b) => a.ts.localeCompare(b.ts));
      return {
        desde: lunes,
        hasta: sumarDias(lunes, 6),
        lineas: ordenadas,
        total: ordenadas.reduce((a, l) => a + l.total, 0),
        cantidad: ordenadas.length,
        cantidadGratis: ordenadas.filter((l) => l.gratis).length,
      };
    })
    // Más reciente primero: es la que el dueño quiere ver al entrar.
    .sort((a, b) => b.desde.localeCompare(a.desde));

  const adelantosPendientes = adelantosPendientesDeBarbero(p, barberoId);
  const saldoPendiente = adelantosPendientes.reduce((a, x) => a + x.monto, 0);
  const ultima = p.ultimaLiquidacionPorBarbero.get(barberoId);

  return {
    semanas,
    adelantosPendientes,
    saldoPendiente,
    ultimaLiquidacion: ultima ? { ts: ultima.ts, monto: ultima.monto } : null,
  };
}

/** El lunes de la semana que contiene esa fecha, en "YYYY-MM-DD". */
function lunesDeLaSemana(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  const diaSemana = d.getUTCDay(); // 0 domingo, 1 lunes … 6 sábado
  const retroceder = diaSemana === 0 ? 6 : diaSemana - 1;
  d.setUTCDate(d.getUTCDate() - retroceder);
  return d.toISOString().slice(0, 10);
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
