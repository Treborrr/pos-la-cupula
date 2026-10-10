/**
 * El papel del cierre de turno.
 *
 * A diferencia del ticket de venta, este NO pasa por la plantilla editable de
 * Ajustes: es un documento interno fijo, pensado para que lo lea el dueño, y
 * el contenido exacto que lleva es una decisión tomada a propósito —no "todo
 * lo que hay"— ver `DatosDelCierre` en `puertos/Impresora.ts`. Por eso se
 * recorre directo contra `SalidaDeTicket` en vez de reusar `renderTicket`.
 */

import { aTextoConSimbolo } from "@cupula/contratos";

import type { DatosDelCierre, DatosDelNegocio } from "../../puertos/Impresora";
import type { PerfilImpresora } from "./perfil";
import { partir } from "./renderTicket";
import { SalidaEscPos, SalidaTexto, type SalidaDeTicket } from "./salida";

/** Los bytes que van al papel. */
export function renderCierreEscPos(
  cierre: DatosDelCierre,
  negocio: DatosDelNegocio,
  perfil: PerfilImpresora,
): Buffer {
  const salida = new SalidaEscPos(perfil);
  pintar(salida, cierre, negocio);
  return salida.bytes();
}

/** El mismo cierre, en texto, para mostrarlo antes de imprimir. */
export function renderCierreTexto(
  cierre: DatosDelCierre,
  negocio: DatosDelNegocio,
  perfil: PerfilImpresora,
): string {
  const salida = new SalidaTexto(perfil.columnas);
  pintar(salida, cierre, negocio);
  return salida.texto();
}

// ─────────────────────────────────────────────────────────────────────────────

function pintar(salida: SalidaDeTicket, cierre: DatosDelCierre, negocio: DatosDelNegocio): void {
  salida.alinear("centro");
  salida.negrita(true);
  for (const linea of partir(negocio.nombre, salida.columnas)) salida.linea(linea);
  salida.normal();
  salida.alinear("centro");
  salida.linea("CIERRE DE TURNO");
  salida.normal();
  salida.avanzar(1);

  salida.alinear("izq");
  salida.linea(`${fecha(cierre.abiertoEn)}   ${hora(cierre.abiertoEn)} a ${hora(cierre.cerradoEn)}`);
  salida.separador();

  salida.dosColumnas("Ventas", String(cierre.cantidadVentas));
  salida.dosColumnas("Total vendido", aTextoConSimbolo(cierre.totalVendido));
  salida.avanzar(1);
  if (cierre.medios.EFECTIVO > 0) salida.dosColumnas("  Efectivo", aTextoConSimbolo(cierre.medios.EFECTIVO));
  if (cierre.medios.YAPE > 0) salida.dosColumnas("  Yape", aTextoConSimbolo(cierre.medios.YAPE));
  if (cierre.medios.TARJETA > 0) salida.dosColumnas("  Tarjeta", aTextoConSimbolo(cierre.medios.TARJETA));

  if (cierre.egresos.length > 0) {
    salida.separador();
    salida.dosColumnas(`Egresos (${cierre.egresos.length})`, aTextoConSimbolo(cierre.totalEgresos));
    for (const e of cierre.egresos) {
      salida.dosColumnas(`  ${e.motivo}`, aTextoConSimbolo(e.monto));
    }
  }

  salida.separador();
  salida.dosColumnas("Monto inicial", aTextoConSimbolo(cierre.montoInicial));
  salida.negrita(true);
  salida.dosColumnas("Efectivo esperado", aTextoConSimbolo(cierre.efectivoEnCajon));
  salida.normal();
  salida.dosColumnas("Efectivo contado", aTextoConSimbolo(cierre.contadoEfectivo));
  salida.negrita(true);
  salida.dosColumnas(
    "Diferencia",
    cierre.diferencia === 0 ? "cuadró" : aTextoConSimbolo(cierre.diferencia),
  );
  salida.normal();

  if (cierre.porBarbero.length > 0) {
    salida.separador();
    salida.linea("Por barbero");
    for (const b of cierre.porBarbero) {
      salida.dosColumnas(`  ${b.nombre} (${cantidadLegible(b.cantidad)})`, aTextoConSimbolo(b.total));
    }
  }

  salida.separador();
  salida.cortar();
}

/** "2026-09-16T21:03:00.000-05:00" → "16/09/2026". */
function fecha(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "2026-09-16T21:03:00.000-05:00" → "21:03". */
function hora(iso: string): string {
  return iso.slice(11, 16);
}

/** Cantidades enteras sin decimales de adorno: "2", no "2.000". */
function cantidadLegible(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}
