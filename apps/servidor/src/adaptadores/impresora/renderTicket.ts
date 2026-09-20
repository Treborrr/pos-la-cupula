/**
 * De una venta a un ticket.
 *
 * Recorre la plantilla UNA sola vez y escribe en una `SalidaDeTicket`. De ahí
 * salen las dos formas que hacen falta —los bytes ESC/POS para el papel y el
 * texto para la vista previa en pantalla— sin poder divergir entre sí, porque
 * son el mismo recorrido sobre la misma plantilla.
 *
 * Es una función PURA respecto del mundo: no toca hardware, no abre puertos,
 * no sabe qué hora es. Por eso todo el ticket se puede probar con archivos
 * golden sin tener la impresora enchufada.
 */

import { aTexto } from "@cupula/contratos";

import type { Venta } from "../../proyecciones/tipos";
import type { DatosDelNegocio, OpcionesDeImpresion } from "../../puertos/Impresora";
import { qrDeVenta } from "../../puertos/Impresora";
import { anchoImpreso } from "./cp850";
import type { PerfilImpresora } from "./perfil";
import { PLANTILLA_POR_DEFECTO, reemplazar, type BloqueTicket } from "./plantilla";
import { SalidaEscPos, SalidaTexto, type SalidaDeTicket } from "./salida";

export interface OpcionesRender {
  perfil: PerfilImpresora;
  plantilla?: BloqueTicket[];
  /** Apagar el logo acelera la impresión y ahorra papel. */
  conLogo?: boolean;
}

/** Los bytes que van al papel. */
export async function renderTicketEscPos(
  venta: Venta,
  negocio: DatosDelNegocio,
  opciones: OpcionesRender,
  extra: OpcionesDeImpresion = {},
): Promise<Buffer> {
  const salida = new SalidaEscPos(opciones.perfil);
  // El pulso va PRIMERO: el cajón tiene que abrirse mientras el papel sale, no
  // después de que terminó de imprimirse todo el ticket.
  if (extra.abrirCajon) salida.abrirCajon();
  await pintar(salida, venta, negocio, opciones, extra);
  return salida.bytes();
}

/** El mismo ticket, en texto, para mostrarlo antes de imprimir. */
export async function renderTicketTexto(
  venta: Venta,
  negocio: DatosDelNegocio,
  opciones: OpcionesRender,
  extra: OpcionesDeImpresion = {},
): Promise<string> {
  const salida = new SalidaTexto(opciones.perfil.columnas);
  await pintar(salida, venta, negocio, opciones, extra);
  return salida.texto();
}

// ─────────────────────────────────────────────────────────────────────────────

async function pintar(
  salida: SalidaDeTicket,
  venta: Venta,
  negocio: DatosDelNegocio,
  { plantilla = PLANTILLA_POR_DEFECTO, conLogo = true }: OpcionesRender,
  extra: OpcionesDeImpresion,
): Promise<void> {
  const valores: Record<string, string> = {
    "negocio.nombre": negocio.nombre,
    "negocio.direccion": negocio.direccion,
    "negocio.ciudad": negocio.ciudad,
    "negocio.ruc": negocio.ruc,
    "negocio.pie": negocio.pie,
    "venta.correlativo": venta.correlativo,
    "venta.fecha": `${venta.ts.slice(8, 10)}/${venta.ts.slice(5, 7)}/${venta.ts.slice(0, 4)}`,
    "venta.hora": venta.ts.slice(11, 16),
    "venta.total": `S/ ${aTexto(venta.total)}`,
    "venta.medios": venta.pagos.map((p) => p.medio).join(" + "),
    "venta.motivoAnulacion": venta.motivoAnulacion ?? "",
    "cliente.nombre": extra.nombreDelCliente ?? "",
  };

  const condiciones = {
    anulada: venta.anulada,
    copia: Boolean(extra.reimpresion),
    cliente: Boolean(extra.nombreDelCliente),
    descuento: venta.descuento > 0,
  };

  await recorrer(plantilla);

  async function recorrer(bloques: BloqueTicket[]): Promise<void> {
    for (const bloque of bloques) {
      switch (bloque.tipo) {
        case "logo":
          if (conLogo) {
            salida.alinear("centro");
            await salida.logo();
            salida.normal();
          }
          break;

        case "texto": {
          const contenido = reemplazar(bloque.contenido, valores).trim();
          // Un marcador que quedó vacío no deja una línea en blanco de adorno.
          if (contenido === "") break;

          salida.alinear(bloque.alinear ?? "izq");
          if (bloque.negrita) salida.negrita(true);
          const escala = bloque.tamano ?? 1;
          if (escala > 1) salida.tamano(escala, escala);

          // En tamaño doble entra la mitad de texto por línea: partir con el
          // ancho normal dejaría la mitad fuera del papel.
          for (const linea of partir(contenido, Math.floor(salida.columnas / escala))) {
            salida.linea(linea);
          }
          salida.normal();
          break;
        }

        case "separador":
          salida.alinear("izq");
          salida.separador(bloque.caracter ?? "-");
          break;

        case "lineas":
          pintarLineas(bloque.mostrarBarbero ?? false);
          break;

        case "totales":
          pintarTotales();
          break;

        case "pagos":
          pintarPagos();
          break;

        case "qr":
          await salida.qr(
            bloque.contenido ? reemplazar(bloque.contenido, valores) : qrDeVenta(venta.correlativo),
          );
          break;

        case "espacio":
          salida.avanzar(bloque.lineas ?? 1);
          break;

        case "corte":
          salida.cortar();
          break;

        case "si":
          if (condiciones[bloque.condicion]) await recorrer(bloque.bloques);
          break;
      }
    }
  }

  function pintarLineas(mostrarBarbero: boolean): void {
    salida.alinear("izq");

    for (const linea of venta.lineas) {
      // La descripción se PARTE en varias líneas en vez de truncarse. El Excel
      // cortaba a 18 caracteres con Left() y nombres largos salían mutilados
      // en el papel del cliente.
      for (const trozo of partir(linea.nombre, salida.columnas)) salida.linea(trozo);

      salida.dosColumnas(
        `  ${cantidadLegible(linea.cantidad)} x ${aTexto(linea.precioUnitario)}`,
        aTexto(linea.total),
      );

      if (mostrarBarbero && linea.barberoId) {
        const nombre = extra.nombresDeBarbero?.[linea.barberoId];
        if (nombre) salida.linea(`  (${nombre})`);
      }
    }
  }

  function pintarTotales(): void {
    if (venta.descuento > 0) {
      salida.dosColumnas("Subtotal", aTexto(venta.subtotal));
      salida.dosColumnas("Descuento", `-${aTexto(venta.descuento)}`);
    }
    salida.negrita(true);
    salida.tamano(1, 2);
    salida.dosColumnas("TOTAL", `S/ ${aTexto(venta.total)}`);
    salida.normal();
  }

  function pintarPagos(): void {
    for (const pago of venta.pagos) {
      salida.dosColumnas(`  ${pago.medio}`, aTexto(pago.monto));
      if (pago.recibido !== undefined) {
        salida.dosColumnas("  Recibido", aTexto(pago.recibido));
        salida.dosColumnas("  Vuelto", aTexto(Math.max(0, pago.recibido - pago.monto)));
      }
    }
  }
}

/** Cantidades enteras sin decimales de adorno: "2", no "2.000". */
function cantidadLegible(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/** Corta un texto al ancho del papel sin partir palabras, salvo que no quepan. */
export function partir(texto: string, ancho: number): string[] {
  const lineas: string[] = [];

  for (const parrafo of texto.split("\n")) {
    let actual = "";
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      if (actual === "") actual = palabra;
      else if (anchoImpreso(actual) + 1 + anchoImpreso(palabra) <= ancho) actual += " " + palabra;
      else {
        lineas.push(actual);
        actual = palabra;
      }
      // Una palabra sola más larga que el papel: no hay más remedio que
      // cortarla, pero al menos se imprime entera repartida en dos renglones.
      while (anchoImpreso(actual) > ancho) {
        lineas.push(actual.slice(0, ancho));
        actual = actual.slice(ancho);
      }
    }
    lineas.push(actual);
  }

  return lineas;
}
