/**
 * Export de auditoría: el log de eventos convertido en algo que se pueda leer
 * y analizar.
 *
 * POR QUÉ EXISTE. El log crudo (`datos/eventos/*.jsonl`) ya registra TODO y es
 * a prueba de manoseo, pero está escrito para la máquina: identificadores ULID
 * en vez de nombres, importes en céntimos y cada línea envuelta en su sobre con
 * el hash. Se puede leer, pero para revisar si alguien está haciendo mal uso
 * del sistema hay que ir cruzando identificadores a mano, y ahí se abandona.
 *
 * Esto produce el MISMO contenido ya resuelto: nombres en vez de ids, soles en
 * vez de céntimos, en orden cronológico y con el turno de caja al lado de cada
 * movimiento.
 *
 * SOBRE LA ATRIBUCIÓN. El POS no tiene login, así que el log no sabe QUIÉN hizo
 * cada cosa: todos los eventos quedan firmados como "mostrador". Lo más cerca
 * que se puede llegar es el CUÁNDO y el turno de caja en el que cayó; sabiendo
 * quién trabajó cada turno, la atribución la hace quien lee. Por eso cada
 * movimiento lleva turno y hora, y por eso el resumen agrupa por turno.
 *
 * Es de solo lectura: reproduce el log y no escribe un solo evento.
 */

import { aTexto, esDeTipo, type Evento } from "@cupula/contratos";

import type { AlmacenDeEventos } from "../puertos/AlmacenDeEventos";
import { Proyeccion } from "../proyecciones/Proyeccion";

export interface Movimiento {
  seq: number;
  fecha: string;
  hora: string;
  tipo: string;
  detalle: string;
  /** Turno de caja en el que cayó. `null` = con la caja cerrada. */
  turno: string | null;
  monto?: string;
  /** Lo que merece una segunda mirada. Vacío en la enorme mayoría. */
  señales?: string[];
}

export interface Auditoria {
  generado: string;
  carpeta: string;
  periodo: { desde: string; hasta: string };
  integridad: {
    ok: boolean;
    eventos: number;
    ultimaSeq: number;
    huecos: number[];
    hashRotos: number[];
    enCuarentena: number;
    nota: string;
  };
  resumen: Record<string, unknown>;
  señales: { tipo: string; cuantas: number; detalle: string[] }[];
  turnos: Record<string, unknown>[];
  movimientos: Movimiento[];
  /** Carpeta de respaldo externa configurada, si la hay. Vacío si no. */
  destinoExterno: string;
}

const soles = (centimos: number) => Number((centimos / 100).toFixed(2));

/** "2026-09-18T15:14:44.732-05:00" → ["2026-09-18", "15:14"] */
function partirFecha(ts: string): [string, string] {
  return [ts.slice(0, 10), ts.slice(11, 16)];
}

function minutosEntre(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 60000);
}

export async function construirAuditoria(
  almacen: AlmacenDeEventos,
  carpeta: string,
  ahora: string,
): Promise<Auditoria> {
  const p = new Proyeccion();
  const movimientos: Movimiento[] = [];

  // Acumuladores de señales. Se juntan mientras se recorre y se resumen al
  // final, así el log se lee una sola vez.
  const anulaciones: string[] = [];
  const reimpresiones: string[] = [];
  const bajasDePrecio: string[] = [];
  const preciosPorDebajo: string[] = [];
  const descuentos: string[] = [];
  const ajustesALaBaja: string[] = [];
  const mermas: string[] = [];
  const cierresConDiferencia: string[] = [];
  const ventasFueraDeTurno: string[] = [];
  const cambiosDeConfig: string[] = [];
  const fueraDeHorario: string[] = [];

  const nombreItem = (id: string) => p.items.get(id)?.nombre ?? id;
  const nombreBarbero = (id: string | null) => (id ? (p.barberos.get(id)?.nombre ?? id) : null);
  const nombreCliente = (id: string | null) => (id ? (p.clientes.get(id)?.nombre ?? id) : null);

  /** "T3 (abrió 09:00)" — etiqueta corta y estable para agrupar. */
  const numeroDeTurno = new Map<string, number>();
  const etiquetaTurno = (id: string | null): string | null => {
    if (!id) return null;
    const t = p.turnos.get(id);
    if (!t) return id;
    if (!numeroDeTurno.has(id)) numeroDeTurno.set(id, numeroDeTurno.size + 1);
    return `T${numeroDeTurno.get(id)} (abrió ${t.abiertoEn.slice(11, 16)})`;
  };

  let primera = "";
  let ultima = "";

  for await (const e of almacen.leer()) {
    // El evento se aplica ANTES de describirlo cuando crea algo (para poder
    // nombrarlo) y después cuando lo modifica (para poder comparar contra el
    // estado anterior). Por eso cada rama decide su momento.
    const [fecha, hora] = partirFecha(e.ts);
    if (!primera) primera = fecha;
    ultima = fecha;

    const base = { seq: e.seq, fecha, hora, tipo: e.tipo } as const;
    const señales: string[] = [];

    if (esDeTipo(e, "venta.registrada")) {
      p.aplicar(e);
      const v = e.datos;
      const items = v.lineas
        .map((l) => `${l.nombre} x${l.cantidad}` + (l.precioUnitario !== l.precioLista ? ` (a ${aTexto(l.precioUnitario)}, lista ${aTexto(l.precioLista)})` : ""))
        .join(", ");

      for (const l of v.lineas) {
        if (l.precioUnitario < l.precioLista) {
          const texto = `${v.correlativo} ${fecha} ${hora} · ${l.nombre}: cobrado ${aTexto(l.precioUnitario)} contra lista ${aTexto(l.precioLista)}`;
          señales.push(`precio por debajo de lista: ${l.nombre}`);
          preciosPorDebajo.push(texto);
        }
      }
      if (v.descuento > 0) {
        señales.push(`descuento de ${aTexto(v.descuento)} sobre ${aTexto(v.subtotal)}`);
        descuentos.push(`${v.correlativo} ${fecha} ${hora} · descuento ${aTexto(v.descuento)} sobre ${aTexto(v.subtotal)}`);
      }
      if (v.turnoId === null) {
        señales.push("cobrada con la caja cerrada");
        ventasFueraDeTurno.push(`${v.correlativo} ${fecha} ${hora} · ${aTexto(v.total)}`);
      }
      // La barbería no abre de madrugada: una venta a esa hora es un error de
      // reloj o algo que amerita preguntar.
      const h = Number(hora.slice(0, 2));
      if (h < 7 || h >= 23) {
        señales.push("fuera del horario habitual");
        fueraDeHorario.push(`${v.correlativo} ${fecha} ${hora}`);
      }

      const barberos = [...new Set(v.lineas.map((l) => nombreBarbero(l.barberoId)).filter(Boolean))];
      movimientos.push({
        ...base,
        tipo: "venta",
        detalle:
          `${v.correlativo} · ${items}` +
          (v.clienteId ? ` · cliente: ${nombreCliente(v.clienteId)}` : " · SIN CLIENTE") +
          (barberos.length ? ` · atendió: ${barberos.join(", ")}` : "") +
          ` · pagos: ${v.pagos.map((g) => `${g.medio} ${aTexto(g.monto)}`).join(" + ")}`,
        turno: etiquetaTurno(v.turnoId),
        monto: aTexto(v.total),
        ...(señales.length ? { señales } : {}),
      });
      continue;
    }

    if (esDeTipo(e, "venta.anulada")) {
      const venta = p.ventas.get(e.datos.ventaId);
      const demora = venta ? minutosEntre(venta.ts, e.ts) : null;
      const efectivo = venta?.pagos.some((g) => g.medio === "EFECTIVO") ?? false;
      p.aplicar(e);

      // Anular mucho después de cobrar, y en efectivo, es el patrón clásico de
      // quedarse con la plata: el cliente ya se fue y el cajón nunca cuadró.
      if (demora !== null && demora > 60) señales.push(`anulada ${demora} minutos después de cobrada`);
      if (efectivo) señales.push("era una venta en efectivo");

      const texto = `${e.datos.correlativo} ${fecha} ${hora} · ${venta ? aTexto(venta.total) : "?"}${efectivo ? " EN EFECTIVO" : ""}${demora !== null ? ` · ${demora} min después` : ""} · motivo: ${e.datos.motivo}`;
      anulaciones.push(texto);

      movimientos.push({
        ...base,
        tipo: "ANULACIÓN",
        detalle: `${e.datos.correlativo} · motivo: ${e.datos.motivo}` + (venta ? ` · era de ${aTexto(venta.total)}` : ""),
        turno: etiquetaTurno(p.turnoAbierto?.id ?? null),
        monto: venta ? aTexto(venta.total) : undefined,
        ...(señales.length ? { señales } : {}),
      });
      continue;
    }

    if (esDeTipo(e, "venta.reimpresa")) {
      p.aplicar(e);
      const venta = p.ventas.get(e.datos.ventaId);
      const veces = venta?.reimpresiones ?? 1;
      if (veces >= 3) señales.push(`reimpreso ${veces} veces`);
      reimpresiones.push(`${e.datos.correlativo} ${fecha} ${hora} · van ${veces}`);
      movimientos.push({
        ...base,
        tipo: "reimpresión",
        detalle: `${e.datos.correlativo} · van ${veces}`,
        turno: etiquetaTurno(p.turnoAbierto?.id ?? null),
        ...(señales.length ? { señales } : {}),
      });
      continue;
    }

    if (esDeTipo(e, "item.precio_cambiado")) {
      const nombre = nombreItem(e.datos.itemId);
      p.aplicar(e);
      const baja = e.datos.precioNuevo < e.datos.precioAnterior;
      if (baja) señales.push("bajada de precio");
      const texto = `${fecha} ${hora} · ${nombre}: ${aTexto(e.datos.precioAnterior)} → ${aTexto(e.datos.precioNuevo)}${e.datos.motivo ? ` · ${e.datos.motivo}` : " · SIN MOTIVO"}`;
      if (baja) bajasDePrecio.push(texto);
      movimientos.push({
        ...base,
        tipo: "cambio de precio",
        detalle: `${nombre}: ${aTexto(e.datos.precioAnterior)} → ${aTexto(e.datos.precioNuevo)}${e.datos.motivo ? ` · ${e.datos.motivo}` : " · sin motivo"}`,
        turno: etiquetaTurno(p.turnoAbierto?.id ?? null),
        ...(señales.length ? { señales } : {}),
      });
      continue;
    }

    if (esDeTipo(e, "stock.ajustado")) {
      const nombre = nombreItem(e.datos.itemId);
      p.aplicar(e);
      const delta = e.datos.cantidadContada - e.datos.cantidadSistema;
      if (delta < 0) {
        señales.push(`faltaban ${Math.abs(delta)} unidades`);
        ajustesALaBaja.push(`${fecha} ${hora} · ${nombre}: sistema ${e.datos.cantidadSistema}, contado ${e.datos.cantidadContada} (faltan ${Math.abs(delta)}) · ${e.datos.motivo}`);
      }
      movimientos.push({
        ...base,
        tipo: "ajuste de stock",
        detalle: `${nombre}: sistema ${e.datos.cantidadSistema} → contado ${e.datos.cantidadContada} · ${e.datos.motivo}`,
        turno: etiquetaTurno(p.turnoAbierto?.id ?? null),
        ...(señales.length ? { señales } : {}),
      });
      continue;
    }

    if (esDeTipo(e, "stock.merma")) {
      const nombre = nombreItem(e.datos.itemId);
      p.aplicar(e);
      mermas.push(`${fecha} ${hora} · ${nombre}: ${e.datos.cantidad} · ${e.datos.motivo}`);
      movimientos.push({
        ...base,
        tipo: "merma",
        detalle: `${nombre}: ${e.datos.cantidad} · ${e.datos.motivo}`,
        turno: etiquetaTurno(p.turnoAbierto?.id ?? null),
        señales: ["salida de mercadería sin venta"],
      });
      continue;
    }

    if (esDeTipo(e, "stock.entrada")) {
      const nombre = nombreItem(e.datos.itemId);
      p.aplicar(e);
      movimientos.push({
        ...base,
        tipo: "entrada de stock",
        detalle: `${nombre}: +${e.datos.cantidad} · ${e.datos.motivo}`,
        turno: etiquetaTurno(p.turnoAbierto?.id ?? null),
      });
      continue;
    }

    if (esDeTipo(e, "caja.turno_cerrado")) {
      p.aplicar(e);
      const d = e.datos;
      if (d.diferencia !== 0) {
        señales.push(d.diferencia < 0 ? `FALTA ${aTexto(Math.abs(d.diferencia))}` : `SOBRA ${aTexto(d.diferencia)}`);
        cierresConDiferencia.push(
          `${fecha} ${hora} · esperado ${aTexto(d.esperado.efectivoEnCajon)}, contado ${aTexto(d.contadoEfectivo)} → ${d.diferencia < 0 ? "falta" : "sobra"} ${aTexto(Math.abs(d.diferencia))} · ${d.cantidadVentas} ventas`,
        );
      }
      movimientos.push({
        ...base,
        tipo: "CIERRE DE CAJA",
        detalle: `esperado ${aTexto(d.esperado.efectivoEnCajon)}, contado ${aTexto(d.contadoEfectivo)} · ${d.cantidadVentas} ventas · efectivo ${aTexto(d.esperado.efectivo)}, yape ${aTexto(d.esperado.yape)}, tarjeta ${aTexto(d.esperado.tarjeta)}${d.notas ? ` · ${d.notas}` : ""}`,
        turno: etiquetaTurno(d.turnoId),
        monto: aTexto(d.diferencia),
        ...(señales.length ? { señales } : {}),
      });
      continue;
    }

    if (esDeTipo(e, "caja.turno_abierto")) {
      p.aplicar(e);
      movimientos.push({
        ...base,
        tipo: "apertura de caja",
        detalle: `monto inicial ${aTexto(e.datos.montoInicial)}${e.datos.notas ? ` · ${e.datos.notas}` : ""}`,
        turno: etiquetaTurno(e.datos.turnoId),
        monto: aTexto(e.datos.montoInicial),
      });
      continue;
    }

    if (esDeTipo(e, "config.actualizada")) {
      p.aplicar(e);
      // Tocar estas es cambiar las reglas del juego, no configurar la
      // impresora: van marcadas aparte.
      const sensible = /^(ventas\.|fidelidad\.|respaldos\.)/.test(e.datos.clave);
      const texto = `${fecha} ${hora} · ${e.datos.clave} = ${JSON.stringify(e.datos.valor)}`;
      if (sensible) cambiosDeConfig.push(texto);
      movimientos.push({
        ...base,
        tipo: "configuración",
        detalle: `${e.datos.clave} = ${JSON.stringify(e.datos.valor)}`,
        turno: etiquetaTurno(p.turnoAbierto?.id ?? null),
        ...(sensible ? { señales: ["cambia una regla de negocio"] } : {}),
      });
      continue;
    }

    // El resto (altas y bajas de ítems, clientes y barberos) se registra sin
    // análisis: importa que esté, no hay patrón de fraude asociado.
    p.aplicar(e);
    const detalle = descripcionGenerica(e, nombreItem);
    if (detalle) {
      movimientos.push({
        ...base,
        detalle,
        turno: etiquetaTurno(p.turnoAbierto?.id ?? null),
      });
    }
  }

  const integridad = await almacen.verificar();

  const ventas = [...p.ventas.values()];
  const vigentes = ventas.filter((v) => !v.anulada);
  const totales = p.totalesDe(vigentes);

  const turnos = [...p.turnos.values()].map((t) => ({
    turno: etiquetaTurno(t.id),
    abierto: t.abiertoEn.replace("T", " ").slice(0, 16),
    cerrado: t.cerradoEn ? t.cerradoEn.replace("T", " ").slice(0, 16) : "SIN CERRAR",
    montoInicial: soles(t.montoInicial),
    contado: t.contadoEfectivo !== undefined ? soles(t.contadoEfectivo) : null,
    diferencia: t.diferencia !== undefined ? soles(t.diferencia) : null,
  }));

  const señales = [
    { tipo: "Anulaciones", cuantas: anulaciones.length, detalle: anulaciones },
    { tipo: "Cierres de caja que no cuadraron", cuantas: cierresConDiferencia.length, detalle: cierresConDiferencia },
    { tipo: "Ventas cobradas con la caja cerrada", cuantas: ventasFueraDeTurno.length, detalle: ventasFueraDeTurno },
    { tipo: "Cobros por debajo del precio de lista", cuantas: preciosPorDebajo.length, detalle: preciosPorDebajo },
    { tipo: "Descuentos aplicados a la venta", cuantas: descuentos.length, detalle: descuentos },
    { tipo: "Bajadas de precio en el catálogo", cuantas: bajasDePrecio.length, detalle: bajasDePrecio },
    { tipo: "Ajustes de stock con faltante", cuantas: ajustesALaBaja.length, detalle: ajustesALaBaja },
    { tipo: "Mermas", cuantas: mermas.length, detalle: mermas },
    { tipo: "Reimpresiones de ticket", cuantas: reimpresiones.length, detalle: reimpresiones },
    { tipo: "Cambios de reglas de negocio", cuantas: cambiosDeConfig.length, detalle: cambiosDeConfig },
    { tipo: "Movimientos fuera del horario habitual", cuantas: fueraDeHorario.length, detalle: fueraDeHorario },
  ].filter((s) => s.cuantas > 0);

  return {
    generado: ahora,
    carpeta,
    periodo: { desde: primera || "—", hasta: ultima || "—" },
    integridad: {
      ok: integridad.ok,
      eventos: integridad.eventos,
      ultimaSeq: integridad.ultimaSeq,
      huecos: integridad.huecos,
      hashRotos: integridad.hashRotos,
      enCuarentena: integridad.enCuarentena,
      nota: integridad.ok
        ? "El log está íntegro: no falta ningún evento y nadie editó los archivos a mano."
        : "ATENCIÓN: el log tiene huecos o la cadena de hash está rota. Alguien editó o borró líneas. Revisar antes de sacar conclusiones de los números.",
    },
    resumen: {
      ventasRegistradas: ventas.length,
      ventasVigentes: vigentes.length,
      ventasAnuladas: ventas.length - vigentes.length,
      totalVendido: soles(totales.total),
      efectivo: soles(totales.medios.EFECTIVO),
      yape: soles(totales.medios.YAPE),
      tarjeta: soles(totales.medios.TARJETA),
      clientes: p.clientes.size,
      barberos: p.barberos.size,
      turnos: p.turnos.size,
    },
    señales,
    turnos,
    movimientos,
    destinoExterno: String(p.config.get("respaldos.destinoExterno") ?? ""),
  };
}

function descripcionGenerica(e: Evento, nombreItem: (id: string) => string): string | null {
  if (esDeTipo(e, "item.creado")) return `alta de ${e.datos.tipo.toLowerCase()}: ${e.datos.codigo} ${e.datos.nombre} a ${aTexto(e.datos.precio)}`;
  if (esDeTipo(e, "item.actualizado")) return `cambio en ${nombreItem(e.datos.itemId)}: ${JSON.stringify(e.datos)}`;
  if (esDeTipo(e, "item.desactivado")) return `baja de ${nombreItem(e.datos.itemId)}${e.datos.motivo ? ` · ${e.datos.motivo}` : ""}`;
  if (esDeTipo(e, "item.reactivado")) return `reactivación de ${nombreItem(e.datos.itemId)}`;
  if (esDeTipo(e, "cliente.registrado")) return `alta de cliente: ${e.datos.nombre}`;
  if (esDeTipo(e, "cliente.actualizado")) return `cambio de cliente: ${JSON.stringify(e.datos)}`;
  if (esDeTipo(e, "cliente.vinculado_fidelidad")) return `tarjeta de fidelidad vinculada (${e.datos.origen})`;
  if (esDeTipo(e, "barbero.creado")) return `alta o reactivación de barbero: ${e.datos.nombre}`;
  if (esDeTipo(e, "barbero.actualizado")) return `cambio de barbero: ${e.datos.nombre ?? ""}`;
  if (esDeTipo(e, "barbero.desactivado")) return `baja de barbero`;
  return null;
}

/**
 * El archivo que se le pasa a quien vaya a analizarlo.
 *
 * Texto plano con un encabezado que explica qué es y cómo leerlo, y después
 * los datos en JSON. Se abre con el Bloc de notas y se puede pegar entero en
 * una conversación.
 */
export function formatearAuditoria(a: Auditoria): string {
  const l: string[] = [];
  l.push("=".repeat(78));
  l.push(" AUDITORÍA DEL POS — LA CÚPULA TATTOO BARBER SHOP");
  l.push("=".repeat(78));
  l.push("");
  l.push(`Generado: ${a.generado}`);
  l.push(`Período : ${a.periodo.desde} a ${a.periodo.hasta}`);
  l.push(`Datos   : ${a.carpeta}`);
  l.push("");
  l.push("QUÉ ES ESTE ARCHIVO");
  l.push("  Todos los movimientos del POS, reconstruidos desde el log de eventos.");
  l.push("  El log es append-only y cada línea lleva un hash encadenado con la");
  l.push("  anterior, así que editar una operación vieja rompe todas las siguientes");
  l.push("  y se detecta (ver INTEGRIDAD).");
  l.push("");
  l.push("  IMPORTANTE AL LEERLO: el POS no tiene login, así que NINGÚN movimiento");
  l.push("  dice quién lo hizo. Lo que hay es la hora y el turno de caja. Para");
  l.push("  atribuir algo a una persona hay que cruzarlo con quién trabajó ese turno.");
  l.push("");
  l.push("-".repeat(78));
  l.push(" INTEGRIDAD DEL LOG");
  l.push("-".repeat(78));
  l.push(JSON.stringify(a.integridad, null, 2));
  l.push("");
  l.push("-".repeat(78));
  l.push(" RESUMEN");
  l.push("-".repeat(78));
  l.push(JSON.stringify(a.resumen, null, 2));
  l.push("");
  l.push("-".repeat(78));
  l.push(" SEÑALES — lo que merece una segunda mirada");
  l.push("-".repeat(78));
  l.push(
    a.señales.length === 0
      ? "Ninguna. No hubo anulaciones, faltantes de caja, descuentos ni ajustes de stock."
      : JSON.stringify(a.señales, null, 2),
  );
  l.push("");
  l.push("  Ojo: que algo aparezca acá NO significa que esté mal. Un descuento puede");
  l.push("  ser una promoción y una anulación puede ser un error tipeado. Son los");
  l.push("  puntos por donde empezar a preguntar, no conclusiones.");
  l.push("");
  l.push("-".repeat(78));
  l.push(" TURNOS DE CAJA");
  l.push("-".repeat(78));
  l.push(JSON.stringify(a.turnos, null, 2));
  l.push("");
  l.push("-".repeat(78));
  l.push(` MOVIMIENTOS (${a.movimientos.length}, en orden cronológico)`);
  l.push("-".repeat(78));
  for (const m of a.movimientos) l.push(JSON.stringify(m));
  l.push("");
  return l.join("\n");
}
