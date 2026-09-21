/**
 * La plantilla de Excel que se le pasa al cliente para que cargue su catálogo,
 * y la lectura de esa misma plantilla cuando la devuelve llena.
 *
 * Está pensada para alguien que no sabe de sistemas: encabezados en castellano,
 * dos filas de ejemplo ya cargadas para que se vea qué va en cada columna, y
 * una hoja aparte con las instrucciones. Todo lo que el archivo no explique va
 * a terminar en una llamada telefónica.
 */

import type { FilaDeCatalogo } from "../../dominio/catalogo/importar";
import { escribirXlsx, leerXlsx } from "./xlsx";

/** Los encabezados, en orden. Es el contrato entre la plantilla y el lector. */
export const COLUMNAS = ["Código", "Nombre", "Tipo", "Categoría", "Precio", "Stock", "Stock mínimo"] as const;

export type { FilaDeCatalogo };

export interface ProblemaEnFila {
  fila: number;
  columna: string;
  problema: string;
}

export interface LecturaDeCatalogo {
  filas: FilaDeCatalogo[];
  problemas: ProblemaEnFila[];
}

export function generarPlantilla(): Buffer {
  return escribirXlsx({
    nombre: "Catálogo",
    anchos: [14, 42, 14, 20, 12, 12, 14],
    filas: [
      [...COLUMNAS],
      ["", "CORTE CLASICO", "SERVICIO", "Barbería", 20, "", ""],
      ["", "BARBA", "SERVICIO", "Barbería", 10, "", ""],
      ["", "CERA MODELADORA", "PRODUCTO", "Productos", 25, 12, 3],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      [""],
      ["CÓMO LLENAR ESTA PLANILLA"],
      [""],
      ["Código", "Déjalo VACÍO y el sistema lo genera solo (P0001, S0001…)."],
      ["", "Solo escríbelo si ya usas un código propio y lo quieres conservar."],
      ["Nombre", "Obligatorio. Es lo que sale en el ticket y en la pantalla de cobro."],
      ["Tipo", "SERVICIO o PRODUCTO. Un SERVICIO no lleva stock; un PRODUCTO sí."],
      ["Categoría", "Agrupa los botones en la pantalla de cobro. Por ejemplo: Barbería, Productos."],
      ["Precio", "En soles. Usa punto o coma para los decimales: 25.50 o 25,50."],
      ["Stock", "Solo para PRODUCTO: cuántas unidades hay hoy. Déjalo vacío en los servicios."],
      ["Stock mínimo", "Solo para PRODUCTO: por debajo de esa cantidad el sistema avisa."],
      [""],
      ["Borra las filas de ejemplo antes de cargar el archivo."],
      ["No cambies los encabezados ni el orden de las columnas."],
    ],
  });
}

/**
 * Convierte un precio escrito por una persona a céntimos.
 *
 * Acepta "25", "25.50", "25,50" y "S/ 25.50". La coma decimal es lo normal en
 * Perú y Excel la usa según la configuración regional, así que rechazarla
 * sería rechazar la mitad de los archivos.
 */
function aCentimos(texto: string): number | null {
  const limpio = texto
    .replace(/\s/g, "")
    .replace(/^S\/\.?/i, "")
    .replace(",", ".");
  if (limpio === "") return null;
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  return Math.round(Number(limpio) * 100);
}

function aNumero(texto: string): number | null {
  const limpio = texto.replace(/\s/g, "").replace(",", ".");
  if (limpio === "") return null;
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  return Number(limpio);
}

/**
 * Lee la plantilla llena.
 *
 * Nunca lanza por una fila mala: junta TODOS los problemas y los devuelve con
 * su número de fila. Cortar en el primer error obligaría a subir el archivo
 * diez veces para descubrir diez errores.
 */
export function leerPlantilla(datos: Buffer): LecturaDeCatalogo {
  const crudas = leerXlsx(datos);
  const filas: FilaDeCatalogo[] = [];
  const problemas: ProblemaEnFila[] = [];

  if (crudas.length === 0) {
    return { filas, problemas: [{ fila: 0, columna: "", problema: "El archivo está vacío." }] };
  }

  const encabezado = (crudas[0] ?? []).map((c) => c.toLowerCase().trim());
  if (!encabezado[1]?.startsWith("nombre")) {
    return {
      filas,
      problemas: [
        {
          fila: 1,
          columna: "",
          problema:
            "Los encabezados no coinciden con la plantilla. Descarga la plantilla de nuevo y copia tus datos ahí, sin cambiar el orden de las columnas.",
        },
      ],
    };
  }

  const vistos = new Map<string, number>();

  for (let i = 1; i < crudas.length; i++) {
    const c = crudas[i];
    const numeroDeFila = i + 1;
    const [codigo = "", nombre = "", tipo = "", categoria = "", precio = "", stock = "", stockMinimo = ""] = c;

    // Fila totalmente vacía: es el relleno de la plantilla, no un error.
    if (![codigo, nombre, tipo, categoria, precio, stock, stockMinimo].some((v) => v.trim() !== "")) continue;

    // Las instrucciones del pie tienen texto en la primera columna y el resto
    // vacío: se saltean para que no aparezcan como filas rotas.
    if (nombre.trim() === "" && codigo.trim() !== "" && tipo.trim() === "" && precio.trim() === "") continue;
    if (/^(cómo llenar|borra las filas|no cambies)/i.test(codigo.trim())) continue;

    const anotar = (columna: string, problema: string) => problemas.push({ fila: numeroDeFila, columna, problema });

    if (nombre.trim() === "") anotar("Nombre", "Falta el nombre.");

    const tipoNormalizado = tipo.trim().toUpperCase();
    if (tipoNormalizado !== "SERVICIO" && tipoNormalizado !== "PRODUCTO") {
      anotar("Tipo", `"${tipo}" no es válido: tiene que decir SERVICIO o PRODUCTO.`);
    }

    const centimos = aCentimos(precio);
    if (centimos === null) anotar("Precio", `"${precio}" no es un precio. Escribe solo el número, por ejemplo 25.50`);

    const codigoLimpio = codigo.trim().toUpperCase();
    if (codigoLimpio !== "" && !/^[A-Z0-9._-]+$/.test(codigoLimpio)) {
      anotar("Código", `"${codigo}" tiene caracteres que no se admiten. Usa letras, números, punto, guion o guion bajo.`);
    }
    if (codigoLimpio !== "") {
      const antes = vistos.get(codigoLimpio);
      if (antes) anotar("Código", `El código "${codigoLimpio}" ya está en la fila ${antes}.`);
      else vistos.set(codigoLimpio, numeroDeFila);
    }

    const tipoValido = tipoNormalizado === "SERVICIO" || tipoNormalizado === "PRODUCTO";
    const esProducto = tipoNormalizado === "PRODUCTO";
    const stockNumero = aNumero(stock);
    if (stock.trim() !== "" && stockNumero === null) anotar("Stock", `"${stock}" no es una cantidad.`);
    // Solo si el tipo se entendió: con un tipo inválido, quejarse además del
    // stock manda a la persona a corregir una celda que no tiene nada de malo.
    if (tipoValido && !esProducto && stockNumero !== null && stockNumero > 0) {
      anotar("Stock", "Un SERVICIO no lleva stock. Deja la celda vacía.");
    }

    const minimoNumero = aNumero(stockMinimo);
    if (stockMinimo.trim() !== "" && minimoNumero === null) anotar("Stock mínimo", `"${stockMinimo}" no es una cantidad.`);

    if (nombre.trim() === "" || centimos === null || (tipoNormalizado !== "SERVICIO" && tipoNormalizado !== "PRODUCTO")) {
      continue;
    }

    filas.push({
      fila: numeroDeFila,
      codigo: codigoLimpio,
      nombre: nombre.trim(),
      tipo: tipoNormalizado,
      categoria: categoria.trim() || (esProducto ? "Productos" : "Servicios"),
      precio: centimos,
      stock: esProducto ? stockNumero : null,
      stockMinimo: esProducto ? minimoNumero : null,
    });
  }

  return { filas, problemas };
}
