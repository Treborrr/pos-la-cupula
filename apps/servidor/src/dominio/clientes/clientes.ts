/**
 * Clientes, y la identificación por tarjeta de fidelidad.
 *
 * El QR de la tarjeta de TarjetaCloud lleva UNA de dos cosas, según
 * `branding.qrContent` del programa:
 *
 *   · "serial"  → el serialNumber de la CustomerCard (un cuid). Identificación
 *                 EXACTA.
 *   · "nombre"  → el nombre del cliente en texto plano. Es como está La Cúpula
 *                 hoy, y es AMBIGUO: no hay forma de distinguir dos Carlos
 *                 Mendoza, porque esa información no está en el QR.
 *
 * Este módulo soporta los dos y deja explícito cuándo la identificación fue
 * exacta y cuándo fue un cotejo de texto que el cajero tuvo que confirmar.
 */

import { normalizar, type EventoNuevo } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import type { Cliente } from "../../proyecciones/tipos";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

/**
 * "  juan   pérez " → "JUAN PÉREZ".
 *
 * Todos los nombres se guardan igual para que la lista de clientes se vea
 * pareja y para que el mismo cliente no entre dos veces por haberlo tecleado
 * distinto. Va en mayúsculas porque es como se escribían en el Excel y como
 * salen en el ticket.
 */
export function nombreDeCliente(texto: string): string {
  return String(texto ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("es");
}

export function registrarCliente(
  p: Proyeccion,
  datos: { nombre: string; telefono?: string; notas?: string; serial?: string; permitirHomonimo?: boolean },
): { eventos: EventoNuevo[]; clienteId: string; homonimos: Cliente[] } {
  const nombre = nombreDeCliente(datos.nombre);
  if (!nombre) throw new ErrorDeNegocio("DATO_INVALIDO", "El cliente necesita un nombre.");

  const homonimos = buscarPorNombreExacto(p, nombre);

  // Sin repetidos por accidente: "juan perez", "Juan Pérez" y "JUAN  PEREZ" son
  // el mismo cliente, y duplicarlo parte su historial en dos. Crear otro igual
  // sigue siendo posible —dos personas pueden llamarse igual de verdad— pero
  // hay que pedirlo a propósito.
  if (homonimos.length > 0 && !datos.permitirHomonimo) {
    throw new ErrorDeNegocio(
      "CLIENTE_REPETIDO",
      `Ya existe un cliente llamado ${homonimos[0].nombre}.`,
      "Elígelo de la lista en vez de crearlo de nuevo.",
    );
  }

  const clienteId = ulid();
  const eventos: EventoNuevo[] = [
    { tipo: "cliente.registrado", datos: { clienteId, nombre, telefono: datos.telefono?.trim(), notas: datos.notas?.trim() } },
  ];

  if (datos.serial) {
    eventos.push({
      tipo: "cliente.vinculado_fidelidad",
      datos: { clienteId, serial: datos.serial.trim(), origen: "manual" },
    });
  }

  return { eventos, clienteId, homonimos };
}

export function actualizarCliente(
  p: Proyeccion,
  clienteId: string,
  cambios: { nombre?: string; telefono?: string; notas?: string },
): EventoNuevo[] {
  if (!p.clientes.has(clienteId)) {
    throw new ErrorDeNegocio("CLIENTE_NO_EXISTE", "Ese cliente no existe.");
  }
  return [
    {
      tipo: "cliente.actualizado",
      datos: {
        clienteId,
        // `undefined` significa "no tocar el nombre"; cualquier otra cosa se
        // normaliza igual que en el alta.
        nombre: cambios.nombre === undefined ? undefined : nombreDeCliente(cambios.nombre),
        telefono: cambios.telefono?.trim(),
        notas: cambios.notas?.trim(),
      },
    },
  ];
}

export function vincularFidelidad(
  p: Proyeccion,
  clienteId: string,
  serial: string,
  origen: "serial" | "nombre" | "manual" = "manual",
): EventoNuevo[] {
  const cliente = p.clientes.get(clienteId);
  if (!cliente) throw new ErrorDeNegocio("CLIENTE_NO_EXISTE", "Ese cliente no existe.");

  const limpio = serial.trim();
  const yaDeOtro = p.clientesPorSerial.get(limpio);
  if (yaDeOtro && yaDeOtro !== clienteId) {
    const otro = p.clientes.get(yaDeOtro)!;
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      `Esa tarjeta ya está vinculada a "${otro.nombre}".`,
      "Si es la misma persona, unifica las fichas; si no, revisa el serial.",
    );
  }
  if (cliente.seriales.includes(limpio)) return [];

  return [{ tipo: "cliente.vinculado_fidelidad", datos: { clienteId, serial: limpio, origen } }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Identificación desde un escaneo
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoIdentificacion =
  | { estado: "exacto"; cliente: Cliente; porSerial: true }
  | { estado: "unico"; cliente: Cliente; porSerial: false }
  | { estado: "ambiguo"; candidatos: Cliente[]; nombreLeido: string }
  | { estado: "desconocido"; nombreLeido: string; serialLeido?: string };

/**
 * Resuelve lo que llegó por la pistola contra la base local de clientes.
 *
 * El orden importa: primero se intenta por serial (exacto), y solo si eso no
 * da nada se cae al cotejo por nombre (ambiguo). Nunca al revés.
 */
export function identificarPorEscaneo(p: Proyeccion, leido: string): ResultadoIdentificacion {
  const texto = leido.trim();

  // 1. ¿Es un serial que ya conocemos? Identificación exacta, sin dudas.
  const porSerial = p.clientesPorSerial.get(texto);
  if (porSerial) {
    const cliente = p.clientes.get(porSerial);
    if (cliente) return { estado: "exacto", cliente, porSerial: true };
  }

  // 2. ¿Tiene forma de cuid de TarjetaCloud y no lo conocemos? Entonces es una
  //    tarjeta nueva: no hay cliente al que asociarla todavía.
  if (pareceSerialDeTarjetaCloud(texto)) {
    return { estado: "desconocido", nombreLeido: "", serialLeido: texto };
  }

  // 3. Cotejo por nombre. Aquí vive la ambigüedad de los homónimos.
  const candidatos = buscarPorNombreExacto(p, texto);
  if (candidatos.length === 1) return { estado: "unico", cliente: candidatos[0], porSerial: false };
  if (candidatos.length > 1) return { estado: "ambiguo", candidatos, nombreLeido: texto };

  return { estado: "desconocido", nombreLeido: texto };
}

/**
 * Los serialNumber de TarjetaCloud son cuid: empiezan con "c", siguen con
 * minúsculas y dígitos, y miden entre 24 y 27 caracteres. Un nombre de persona
 * no tiene esa forma (lleva espacios y mayúsculas), así que la distinción es
 * confiable en la práctica.
 */
export function pareceSerialDeTarjetaCloud(texto: string): boolean {
  return /^c[a-z0-9]{23,26}$/.test(texto);
}

export function buscarPorNombreExacto(p: Proyeccion, nombre: string): Cliente[] {
  const ids = p.clientesPorNombre.get(normalizar(nombre)) ?? [];
  return ids.map((id) => p.clientes.get(id)).filter((c): c is Cliente => c !== undefined);
}

/** Búsqueda por fragmento, para el buscador del mostrador. */
export function buscarClientes(p: Proyeccion, termino: string, limite = 20): Cliente[] {
  const palabras = normalizar(termino).split(" ").filter(Boolean);
  if (palabras.length === 0) return [];

  const encontrados: Cliente[] = [];
  for (const cliente of p.clientes.values()) {
    const objetivo = normalizar(cliente.nombre) + " " + (cliente.telefono ?? "");
    if (palabras.every((palabra) => objetivo.includes(palabra))) {
      encontrados.push(cliente);
      if (encontrados.length >= limite * 3) break;
    }
  }

  // Los que vinieron más recientemente, primero: en el mostrador casi siempre
  // el que estás buscando es alguien que ya vino hace poco.
  return encontrados
    .sort((a, b) => (b.ultimaVisita ?? "").localeCompare(a.ultimaVisita ?? ""))
    .slice(0, limite);
}
