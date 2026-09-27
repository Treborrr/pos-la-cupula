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

import { aTexto, type LineaVenta } from "@cupula/contratos";

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
    "venta.barbero": nombreDelBarberoUnico() ?? "",
  };

  const condiciones = {
    anulada: venta.anulada,
    copia: Boolean(extra.reimpresion),
    cliente: Boolean(extra.nombreDelCliente),
    barbero: Boolean(valores["venta.barbero"]),
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
      // en el papel del cliente. Hace falta de verdad acá: "VIDA POD CARTUCHO
      // LP WATERMELON PEACH ICE" son 41 caracteres.
      for (const trozo of partir(descripcion(linea), salida.columnas)) salida.linea(trozo);

      salida.dosColumnas(
        `  ${cantidadLegible(linea.cantidad)} x ${aTexto(linea.precioUnitario)}`,
        aTexto(linea.total),
      );

      // Solo cuando la venta tiene MÁS DE UN barbero. Con uno solo, ya se
      // nombró arriba junto al cliente y repetirlo bajo cada servicio alarga
      // el papel sin agregar nada.
      if (mostrarBarbero && linea.barberoId && !nombreDelBarberoUnico()) {
        const nombre = extra.nombresDeBarbero?.[linea.barberoId];
        if (nombre) salida.linea(`  (${nombre})`);
      }
    }
  }

  /**
   * El barbero de la venta, si hay UNO solo.
   *
   * Hoy siempre es uno: la pantalla de cobro lo elige junto al cliente. Pero
   * las ventas anteriores a ese cambio pueden tener un barbero distinto por
   * servicio, y ahí devuelve null para que cada línea muestre el suyo.
   */
  function nombreDelBarberoUnico(): string | null {
    const ids = [...new Set(venta.lineas.map((l) => l.barberoId).filter(Boolean))];
    if (ids.length !== 1) return null;
    return extra.nombresDeBarbero?.[ids[0] as string] ?? null;
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

/**
 * Cómo se nombra una línea en el papel: "DON NISH TALCO".
 *
 * La marca se imprime SOLO en los productos. Los servicios los hace La Cúpula
 * —está en el encabezado del ticket, tres centímetros más arriba— así que
 * repetir la marca en cada línea de servicio gastaría papel para decir algo que
 * el cliente ya leyó. En un producto es lo contrario: la marca es justo lo que
 * distingue el TALCO de DON NISH del de SIRMAN.
 *
 * La marca sale de la LÍNEA y no del catálogo, como el nombre y el código: el
 * ticket de ayer tiene que seguir diciendo lo que decía ayer.
 */
function descripcion(linea: LineaVenta): string {
  return linea.tipo === "PRODUCTO" && linea.marca ? `${linea.marca} ${linea.nombre}` : linea.nombre;
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
