/**
 * Registrar una venta. El caso de uso central del sistema.
 *
 * Es una función PURA: recibe el estado y lo que se pidió cobrar, y devuelve
 * los eventos a escribir. No toca disco, no imprime, no sabe qué hora es
 * (el `ts` lo pone el almacén al sellar). Eso la hace trivial de testear y es
 * la razón por la que el dominio no importa `fs`.
 */

import { multiplicar, type Centimos, type EventoNuevo, type LineaVenta, type Pago } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

export interface LineaPedida {
  itemId: string;
  cantidad: number;
  /**
   * Precio cobrado, si difiere del de lista (un ajuste puntual, una cortesía).
   * Si no viene, se usa el de lista.
   *
   * En un ítem SIN precio de lista es OBLIGATORIO: no hay de dónde sacarlo.
   */
  precioUnitario?: Centimos;
  barberoId?: string | null;
  /**
   * Propina que el cliente dejó para el barbero de ESTA línea, anotada en el
   * mismo momento de cobrar. No es parte del cobro: no suma al total, no pasa
   * por los pagos, no la espera el arqueo. Solo para que quede registrada.
   */
  propina?: Centimos;
}

export interface PedidoDeVenta {
  lineas: LineaPedida[];
  pagos: Pago[];
  descuento?: Centimos;
  clienteId?: string | null;
  notas?: string;
  /**
   * La genera la pantalla al abrirse. Si el mismo pedido llega dos veces
   * —doble clic, timeout y reintento— la segunda no cobra de nuevo.
   */
  claveIdempotencia: string;
}

export interface VentaPreparada {
  eventos: EventoNuevo[];
  ventaId: string;
  correlativo: string;
  total: Centimos;
  /** Cosas que no impiden cobrar pero el cajero tiene que ver. */
  advertencias: string[];
}

/** "NV" + 6 dígitos. El formato que el cliente ya conoce del Excel. */
export function formatearCorrelativo(numero: number): string {
  return `NV${String(numero).padStart(6, "0")}`;
}

export function siguienteCorrelativo(p: Proyeccion, inicial: number): string {
  return formatearCorrelativo(Math.max(p.ultimoCorrelativo + 1, inicial));
}

export function registrarVenta(
  p: Proyeccion,
  pedido: PedidoDeVenta,
  opciones: { correlativoInicial: number },
): VentaPreparada {
  if (!pedido.lineas || pedido.lineas.length === 0) {
    throw new ErrorDeNegocio("VENTA_SIN_LINEAS", "No hay nada que cobrar.", "Agrega al menos un ítem al ticket.");
  }

  const advertencias: string[] = [];
  const lineas: LineaVenta[] = [];
  const propinasPedidas: { lineaIndex: number; barberoId: string; monto: Centimos }[] = [];

  // Cuánto se lleva de cada producto EN ESTE ticket. Hace falta acumularlo
  // porque el mismo producto puede venir en dos líneas, y el aviso de stock
  // tiene que mirar el total, no cada línea por separado.
  const salidaPorProducto = new Map<string, number>();

  for (const pedida of pedido.lineas) {
    const item = p.items.get(pedida.itemId);
    if (!item) {
      throw new ErrorDeNegocio(
        "ITEM_NO_EXISTE",
        "Uno de los ítems del ticket ya no existe en el catálogo.",
        "Quita esa línea y vuelve a agregarla.",
      );
    }
    if (!item.activo) {
      throw new ErrorDeNegocio(
        "ITEM_INACTIVO",
        `"${item.nombre}" está desactivado y no se puede vender.`,
        "Reactívalo desde Catálogo, o quita la línea.",
      );
    }
    if (!(pedida.cantidad > 0)) {
      throw new ErrorDeNegocio("DATO_INVALIDO", `La cantidad de "${item.nombre}" tiene que ser mayor a cero.`);
    }
    if (pedida.barberoId && !p.barberos.has(pedida.barberoId)) {
      throw new ErrorDeNegocio("BARBERO_NO_EXISTE", "El barbero indicado no existe.");
    }

    /**
     * UN ÍTEM SIN PRECIO DE LISTA NO SE VENDE. Ni siquiera indicando el precio
     * en el pedido.
     *
     * La regla se aplica ACÁ y no solo escondiendo el botón en la pantalla, que
     * es la diferencia entre una regla y una costumbre: la pantalla de cobro,
     * la pistola de escaneo y cualquier integración futura pasan todas por esta
     * línea. Una regla que solo vive en el front se salta sin querer el día que
     * alguien agrega una segunda forma de cargar una línea.
     *
     * Por qué así: el precio de lista es una decisión del dueño, no del
     * mostrador. Si cada cajero pudiera escribir el precio de un producto sin
     * precio, el mismo producto se cobraría distinto según quién atienda, y el
     * margen del reporte no significaría nada. El precio se pone una vez desde
     * Catálogo y de ahí en más sale solo.
     */
    if (item.precio === null) {
      throw new ErrorDeNegocio(
        "ITEM_SIN_PRECIO",
        `"${p.nombreCompleto(item)}" todavía no tiene precio y no se puede vender.`,
        "Ponle precio desde Catálogo —ahí están juntos todos los que faltan— y vuelve a cobrarlo.",
      );
    }

    // Ajustar el precio de una línea SÍ se puede: es la cortesía puntual, y
    // queda registrada contra el precio de lista para poder reportarla.
    const precioUnitario = pedida.precioUnitario ?? item.precio;
    if (precioUnitario < 0) {
      throw new ErrorDeNegocio("DATO_INVALIDO", `El precio de "${item.nombre}" no puede ser negativo.`);
    }

    lineas.push({
      itemId: item.id,
      codigo: item.codigo,
      marca: item.marca || undefined,
      nombre: item.nombre,
      tipo: item.tipo,
      cantidad: pedida.cantidad,
      precioUnitario,
      precioLista: item.precio,
      // El costo se CONGELA acá: es el promedio ponderado que el producto tenía
      // al momento de vender. Si mañana sube el costo, la utilidad de esta
      // venta —y del mes al que pertenece— no se mueve.
      costoUnitario: item.tipo === "PRODUCTO" ? item.costo : null,
      barberoId: pedida.barberoId ?? null,
      total: multiplicar(precioUnitario, pedida.cantidad),
    });

    if (pedida.propina !== undefined) {
      if (!(pedida.propina > 0)) {
        throw new ErrorDeNegocio("DATO_INVALIDO", "La propina tiene que ser mayor a cero.");
      }
      if (!pedida.barberoId) {
        throw new ErrorDeNegocio(
          "DATO_INVALIDO",
          `No se puede anotar propina en "${item.nombre}" sin elegir a quién atendió.`,
        );
      }
      propinasPedidas.push({ lineaIndex: lineas.length - 1, barberoId: pedida.barberoId, monto: pedida.propina });
    }

    if (item.tipo === "PRODUCTO") {
      salidaPorProducto.set(item.id, (salidaPorProducto.get(item.id) ?? 0) + pedida.cantidad);
    }
  }

  // El stock insuficiente AVISA pero no bloquea. Negarse a cobrar porque el
  // sistema cree que no hay stock, con el cliente y el billete delante, es
  // peor problema que un inventario desfasado.
  for (const [itemId, saliendo] of salidaPorProducto) {
    const disponible = p.stockDe(itemId);
    if (disponible < saliendo) {
      const item = p.items.get(itemId)!;
      advertencias.push(
        `Stock de "${item.nombre}": hay ${disponible} y se están vendiendo ${saliendo}. ` +
          `Se cobra igual, pero conviene contar y ajustar.`,
      );
    }
  }

  const subtotal = lineas.reduce((a, l) => a + l.total, 0);
  const descuento = pedido.descuento ?? 0;
  if (descuento < 0) throw new ErrorDeNegocio("DATO_INVALIDO", "El descuento no puede ser negativo.");
  if (descuento > subtotal) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "El descuento no puede ser mayor que el subtotal.");
  }
  const total = subtotal - descuento;

  validarPagos(pedido.pagos, total);
  validarBarberos(p, pedido.lineas);

  if (pedido.clienteId && !p.clientes.has(pedido.clienteId)) {
    throw new ErrorDeNegocio("CLIENTE_NO_EXISTE", "El cliente indicado no existe.");
  }

  const ventaId = ulid();
  const correlativo = siguienteCorrelativo(p, opciones.correlativoInicial);
  const turnoId = p.turnoAbierto?.id ?? null;

  // Las propinas viajan en el MISMO lote que la venta: o se registran las
  // dos cosas, o ninguna. Entrarlas por separado dejaría, ante un corte de
  // luz entre medio, una venta cobrada sin la propina que el cajero ya vio
  // en pantalla.
  const eventosPropina: EventoNuevo[] = propinasPedidas.map((pp) => ({
    tipo: "venta.propina_registrada",
    datos: {
      propinaId: ulid(),
      ventaId,
      lineaIndex: pp.lineaIndex,
      barberoId: pp.barberoId,
      monto: pp.monto,
      turnoId,
    },
  }));

  return {
    ventaId,
    correlativo,
    total,
    advertencias,
    eventos: [
      {
        tipo: "venta.registrada",
        datos: {
          ventaId,
          correlativo,
          lineas,
          subtotal,
          descuento,
          total,
          pagos: pedido.pagos,
          clienteId: pedido.clienteId ?? null,
          // Si la caja está cerrada la venta se registra igual, con turno null.
          // Perder una venta por no haber abierto caja es inaceptable; el
          // arqueo lo reporta aparte.
          turnoId,
          claveIdempotencia: pedido.claveIdempotencia,
          notas: pedido.notas,
        },
      },
      ...eventosPropina,
    ],
  };
}

/**
 * Un barbero desactivado no puede aparecer en una venta nueva.
 *
 * No es capricho: si se aceptara, la producción por barbero del reporte
 * incluiría a alguien que ya no trabaja y nadie entendería de dónde salió.
 * Las ventas VIEJAS sí conservan su barbero aunque después lo desactiven —por
 * eso se desactiva en vez de borrar.
 */
export function validarBarberos(p: Proyeccion, lineas: LineaPedida[]): void {
  for (const linea of lineas) {
    if (!linea.barberoId) continue;
    const b = p.barberos.get(linea.barberoId);
    if (!b || !b.activo) {
      throw new ErrorDeNegocio(
        "BARBERO_INACTIVO",
        "Uno de los barberos elegidos ya no está activo.",
        "Elige otro barbero en esa línea o déjala sin barbero.",
      );
    }
  }
}

/**
 * Los pagos tienen que sumar EXACTAMENTE el total. Es la regla que hace que el
 * arqueo signifique algo: si se aceptara una diferencia "chica", el cajón
 * nunca cuadraría y nadie sabría por qué.
 */
export function validarPagos(pagos: Pago[], total: Centimos): void {
  if (!pagos || pagos.length === 0) {
    throw new ErrorDeNegocio("PAGOS_NO_CUADRAN", "Falta indicar cómo se paga.", "Elige efectivo, YAPE o tarjeta.");
  }

  const sumado = pagos.reduce((a, p) => a + p.monto, 0);
  if (sumado !== total) {
    const diferencia = sumado - total;
    throw new ErrorDeNegocio(
      "PAGOS_NO_CUADRAN",
      diferencia > 0
        ? `Los pagos suman ${moneda(diferencia)} de más.`
        : `Faltan ${moneda(-diferencia)} por cubrir.`,
      "La suma de los pagos tiene que dar exactamente el total.",
    );
  }

  for (const pago of pagos) {
    if (pago.monto <= 0) {
      throw new ErrorDeNegocio("PAGOS_NO_CUADRAN", "Hay un pago con monto cero o negativo.");
    }
    if (pago.medio === "EFECTIVO" && pago.recibido !== undefined && pago.recibido < pago.monto) {
      throw new ErrorDeNegocio(
        "EFECTIVO_INSUFICIENTE",
        `El cliente entregó ${moneda(pago.recibido)} y el pago en efectivo es de ${moneda(pago.monto)}.`,
      );
    }
  }
}

function moneda(c: Centimos): string {
  return `S/ ${(c / 100).toFixed(2)}`;
}
