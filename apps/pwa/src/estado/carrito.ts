/**
 * El ticket en curso.
 *
 * Es el ÚNICO estado que la PWA guarda por su cuenta, y es efímero a
 * propósito: vive hasta que se cobra. No se persiste en localStorage porque un
 * ticket a medias recuperado de ayer, sin que nadie lo pidiera, es una fuente
 * de cobros equivocados.
 */

import { create } from "zustand";
import { ulid } from "ulid";

import type { Item } from "../lib/api";

export interface LineaDelTicket {
  itemId: string;
  codigo: string;
  marca: string;
  nombre: string;
  tipo: "SERVICIO" | "PRODUCTO";
  cantidad: number;
  /** Lo que se va a cobrar por unidad. Editable. */
  precioUnitario: number;
  /**
   * Lo que dice la lista. Si difieren, la pantalla lo marca.
   *
   * `null` = el ítem no tiene precio de lista y el de esta línea se escribió a
   * mano. No hay nada contra qué compararlo, así que la pantalla no lo marca
   * como "modificado" — no se modificó nada, se completó lo que faltaba.
   */
  precioLista: number | null;
}


interface EstadoCarrito {
  lineas: LineaDelTicket[];
  descuento: number;
  clienteId: string | null;
  nombreCliente: string | null;
  /**
   * Quién atendió, UNO para toda la venta: en La Cúpula el mismo barbero hace
   * todo el servicio de un cliente.
   *
   * Al cobrar se copia a cada línea de SERVICIO, porque el evento
   * `venta.registrada` guarda el barbero línea por línea. Mantener ahí el dato
   * —en vez de subirlo a la cabecera de la venta— evita cambiar la forma de un
   * evento ya escrito en disco, que dejaría ilegibles las ventas anteriores.
   */
  barberoId: string | null;
  notas: string;
  /**
   * Se genera al abrir la pantalla y se renueva DESPUÉS de cobrar. Es lo que
   * hace que un doble clic o un reintento tras un timeout devuelvan la misma
   * venta en vez de cobrar dos veces.
   */
  claveIdempotencia: string;

  /**
   * Un ítem sin precio de lista NO entra al ticket: no se puede vender hasta
   * que se le ponga precio desde Catálogo. La pantalla ni siquiera lo muestra
   * en la grilla, pero el guardia vive acá también por si llega por otro
   * camino —la pistola de escaneo, por ejemplo—.
   */
  agregar: (item: Item, cantidad?: number) => void;
  cambiarCantidad: (indice: number, cantidad: number) => void;
  cambiarPrecio: (indice: number, precio: number) => void;
  quitar: (indice: number) => void;
  ponerDescuento: (centimos: number) => void;
  ponerCliente: (id: string | null, nombre: string | null) => void;
  ponerBarbero: (barberoId: string | null) => void;
  ponerNotas: (notas: string) => void;
  vaciar: () => void;
  /** Tras un cobro exitoso: limpia y estrena clave de idempotencia. */
  reiniciar: () => void;
}

export const usarCarrito = create<EstadoCarrito>((set) => ({
  lineas: [],
  descuento: 0,
  clienteId: null,
  nombreCliente: null,
  barberoId: null,
  notas: "",
  claveIdempotencia: ulid(),

  agregar: (item, cantidad = 1) =>
    set((s) => {
      // Sin precio de lista no entra al ticket. El servidor lo rechaza igual
      // —la regla vive en el dominio—, pero frenarlo acá evita que el cajero
      // arme un ticket que después no va a poder cobrar.
      const precio = item.precio;
      if (precio === null) return s;

      // Si el ítem ya está AL MISMO PRECIO, suma cantidad en vez de crear una
      // línea repetida. El Excel creaba una fila por cada vez que se tecleaba el
      // código, y los tickets terminaban con "CORTE CLASICO" cuatro veces.
      const existente = s.lineas.findIndex((l) => l.itemId === item.id && l.precioUnitario === precio);

      if (existente >= 0) {
        const lineas = [...s.lineas];
        lineas[existente] = {
          ...lineas[existente],
          cantidad: redondear(lineas[existente].cantidad + cantidad),
        };
        return { lineas };
      }

      return {
        lineas: [
          ...s.lineas,
          {
            itemId: item.id,
            codigo: item.codigo,
            marca: item.marca ?? "",
            nombre: item.nombre,
            tipo: item.tipo,
            cantidad,
            precioUnitario: precio,
            precioLista: item.precio,
          },
        ],
      };
    }),

  cambiarCantidad: (indice, cantidad) =>
    set((s) => {
      if (cantidad <= 0) return { lineas: s.lineas.filter((_, i) => i !== indice) };
      const lineas = [...s.lineas];
      lineas[indice] = { ...lineas[indice], cantidad: redondear(cantidad) };
      return { lineas };
    }),

  cambiarPrecio: (indice, precio) =>
    set((s) => {
      const lineas = [...s.lineas];
      lineas[indice] = { ...lineas[indice], precioUnitario: Math.max(0, Math.round(precio)) };
      return { lineas };
    }),

  quitar: (indice) => set((s) => ({ lineas: s.lineas.filter((_, i) => i !== indice) })),

  ponerDescuento: (centimos) => set({ descuento: Math.max(0, Math.round(centimos)) }),

  ponerCliente: (clienteId, nombreCliente) => set({ clienteId, nombreCliente }),

  ponerBarbero: (barberoId) => set({ barberoId }),

  ponerNotas: (notas) => set({ notas }),

  vaciar: () =>
    set({
      lineas: [],
      descuento: 0,
      clienteId: null,
      nombreCliente: null,
      barberoId: null,
      notas: "",
      claveIdempotencia: ulid(),
    }),

  reiniciar: () =>
    set({
      lineas: [],
      descuento: 0,
      clienteId: null,
      nombreCliente: null,
      barberoId: null,
      notas: "",
      claveIdempotencia: ulid(),
    }),
}));

/** Las cantidades admiten hasta 3 decimales; sin esto se acumula basura. */
function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function subtotalDe(lineas: LineaDelTicket[]): number {
  return lineas.reduce((a, l) => a + Math.round(l.precioUnitario * l.cantidad), 0);
}

/** Nunca negativo: un descuento mayor que el subtotal deja el total en cero. */
export function totalDe(lineas: LineaDelTicket[], descuento: number): number {
  return Math.max(0, subtotalDe(lineas) - descuento);
}

