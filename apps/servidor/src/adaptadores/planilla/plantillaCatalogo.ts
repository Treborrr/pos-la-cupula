/**
 * La plantilla de Excel que se le pasa al cliente para que cargue su catálogo,
 * y la lectura de esa misma plantilla cuando la devuelve llena.
 *
 * LA FORMA DE ESTA PLANILLA LA DEFINIÓ EL CLIENTE, no nosotros. La primera
 * versión que entregamos era `Código | Nombre | Tipo | Categoría | Precio |
 * Stock | Stock mínimo`, y volvió convertida en `MARCA | NOMBRE | TIPO |
 * CATEGORIA | PRECIO VENTA | PRECIO COMPRA | STOCK`: sin código, con dos
 * columnas nuevas y el stock corrido dos lugares. Eso no es un error de quien
 * la llenó — es información. Le faltaban dos campos que su negocio necesita
 * (de qué marca es cada cosa y a cuánto la compra) y le sobraba uno que no le
 * importa (un código que el sistema genera solo). La plantilla se adaptó a su
 * planilla, y el sistema aprendió los dos campos.
 *
 * Está pensada para alguien que no sabe de sistemas: encabezados en castellano,
 * filas de ejemplo ya cargadas para que se vea qué va en cada columna, y una
 * HOJA APARTE con las instrucciones. La hoja aparte importa: cuando el
 * instructivo vivía debajo de los datos, el lector tenía que adivinar con
 * heurísticas qué fila era un producto y qué fila una explicación.
 */

import { normalizar } from "@cupula/contratos";

import type { FilaDeCatalogo } from "../../dominio/catalogo/importar";
import { escribirLibro, leerXlsx } from "./xlsx";

/**
 * Los encabezados, en orden. Es el contrato entre la plantilla y el lector.
 *
 * El orden es FIJO y el lector lo verifica: es la decisión que hace que los
 * errores sean claros ("la columna C debería decir TIPO y dice PRECIO") en vez
 * de que el archivo cargue torcido y nadie se entere hasta que un precio
 * aparezca en la columna del stock.
 */
export const COLUMNAS = [
  "MARCA",
  "NOMBRE",
  "TIPO",
  "CATEGORÍA",
  "PRECIO VENTA",
  "PRECIO COMPRA",
  "STOCK",
  "STOCK MÍNIMO",
] as const;

/**
 * Cuántas columnas tienen que estar. Las que siguen son opcionales: STOCK
 * MÍNIMO se agregó después y la planilla que el cliente ya tiene llena no la
 * trae. Rechazar su archivo por una columna que nosotros agregamos sería
 * cobrarle a él nuestro cambio.
 */
const COLUMNAS_OBLIGATORIAS = 7;

/**
 * Cómo puede estar escrito cada encabezado, además de su nombre canónico.
 *
 * El orden sigue siendo fijo; esto solo perdona la ortografía. Hace falta de
 * verdad: el cliente escribió "CATEGORIA" sin tilde, y negarse por una tilde
 * en un encabezado es el tipo de rigidez que termina en una llamada telefónica.
 */
const SINONIMOS: Record<number, string[]> = {
  0: ["marca", "marca comercial"],
  1: ["nombre", "producto", "descripcion", "detalle"],
  2: ["tipo"],
  3: ["categoria", "rubro", "linea"],
  4: ["precio venta", "precio", "precio de venta", "pvp", "venta"],
  5: ["precio compra", "costo", "precio de compra", "compra"],
  6: ["stock", "cantidad", "existencia", "existencias"],
  7: ["stock minimo", "minimo", "stock min", "alerta"],
};

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

/**
 * Las formas de escribir "este ítem no lleva control de stock".
 *
 * Existe porque el cliente puso "ILIMITADO" en la columna STOCK de sus siete
 * servicios de barbería, y tiene toda la razón: un corte de pelo no se agota.
 * El sistema ya sabe que un SERVICIO no lleva stock, así que la palabra es
 * redundante — pero tratarla como un error haría que su planilla no cargara por
 * haber sido explícito.
 */
const SIN_CONTROL_DE_STOCK = new Set([
  "ilimitado",
  "ilimitada",
  "ilimitados",
  "ilimitadas",
  "infinito",
  "infinita",
  "n a",
  "no aplica",
  "no lleva",
  "sin stock",
]);

/**
 * ¿Esta celda de STOCK dice "no lleva control de stock"?
 *
 * Se mira en dos pasos porque `normalizar` borra todo lo que no sea letra o
 * número: "∞", "-" y "—" quedan en cadena vacía. Un símbolo suelto en la celda
 * es justamente alguien diciendo "acá no va un número", así que se acepta.
 */
function sinControlDeStock(celda: string): boolean {
  const crudo = celda.trim();
  if (crudo === "") return false; // vacío ya se trata aparte
  const clave = normalizar(crudo);
  if (clave === "") return true; // puros símbolos: ∞, -, —, /
  return SIN_CONTROL_DE_STOCK.has(clave);
}

export function generarPlantilla(): Buffer {
  return escribirLibro([
    {
      nombre: "Catálogo",
      anchos: [20, 42, 12, 16, 14, 14, 10, 14],
      filas: [
        [...COLUMNAS],
        ["", "CORTE CLASICO", "SERVICIO", "Barbería", 20, "", "ILIMITADO", ""],
        ["", "BARBA", "SERVICIO", "Barbería", 10, "", "ILIMITADO", ""],
        ["NIVEL TRES", "PASTA MATE FIRME", "PRODUCTO", "Barbería", 45, 28, 2, 1],
        ["VIDA POD", "CARTUCHO VP FRAMBUESA", "PRODUCTO", "Vapes", 25, 16, 2, 4],
        ...Array.from({ length: 14 }, () => ["", "", "", "", "", "", "", ""]),
      ],
    },
    {
      nombre: "Cómo llenarla",
      anchos: [18, 96],
      filas: [
        ["CÓMO LLENAR LA PLANILLA DEL CATÁLOGO"],
        [""],
        ["Escribe los productos y servicios en la hoja «Catálogo», una fila cada uno."],
        ["No cambies los encabezados ni el orden de las columnas. Borra las filas de ejemplo antes de cargarla."],
        [""],
        ["COLUMNA", "QUÉ VA"],
        [
          "MARCA",
          "La marca del producto. Déjala vacía en los servicios que hace la barbería.",
        ],
        ["", "Sirve para dos cosas: filtrar el catálogo por marca y saber cuánto se vende de cada una."],
        [
          "",
          "También distingue dos productos con el mismo nombre: un TALCO de una marca y el TALCO de otra.",
        ],
        ["NOMBRE", "Obligatorio. Es lo que sale en el ticket y en la pantalla de cobro, después de la marca."],
        ["TIPO", "SERVICIO o PRODUCTO. Un SERVICIO no lleva stock; un PRODUCTO sí."],
        ["CATEGORÍA", "Agrupa los botones en la pantalla de cobro: es cada pestaña de arriba."],
        ["", "Por ejemplo: Barbería, Vapes, Tatuajes, Bebidas, Snacks."],
        ["", "Si la dejas vacía, el sistema los pone todos juntos en una pestaña «Productos». Funciona,"],
        ["", "pero conviene llenarla: con muchos productos en una sola pestaña, encontrarlos al cobrar cuesta."],
        ["PRECIO VENTA", "En soles, a cuánto lo vendes. Usa punto o coma para los decimales: 25.50 o 25,50."],
        ["", "Si todavía no le pusiste precio, déjalo VACÍO. El producto se carga igual y su stock se lleva,"],
        ["", "pero NO SE VA A PODER VENDER hasta que le pongas precio desde el sistema (Catálogo)."],
        ["", "No escribas 0: un 0 significaría que es gratis y el sistema lo cobraría a cero."],
        ["PRECIO COMPRA", "En soles, a cuánto TÚ lo compras. Con esto el sistema calcula cuánto ganas de verdad,"],
        ["", "el margen de cada producto y cuánta plata tienes parada en el inventario."],
        ["", "Si no lo sabes, déjalo vacío: el reporte dirá «costo no registrado» en vez de inventar una ganancia."],
        [""],
        ["IMPORTANTE", "Una celda de precio VACÍA no borra nada. Si le pusiste precio a un producto desde el"],
        ["", "sistema y en esta planilla su celda sigue vacía, el precio del sistema se conserva."],
        ["", "Puedes volver a subir siempre la misma planilla sin miedo a perder lo que corregiste."],
        ["", "Para quitarle el precio a un producto, hazlo desde la pantalla Catálogo del sistema."],
        ["STOCK", "Solo para PRODUCTO: cuántas unidades tienes HOY. Puede ser 0."],
        ["", "En los servicios déjalo vacío o escribe ILIMITADO; el sistema entiende las dos cosas."],
        ["STOCK MÍNIMO", "Opcional, solo para PRODUCTO: por debajo de esa cantidad el sistema avisa que se está acabando."],
        ["", "Si lo dejas vacío, avisa recién cuando llegue a 0."],
        [""],
        ["SOBRE VOLVER A CARGARLA"],
        ["Puedes cargar la planilla las veces que quieras: el sistema reconoce cada ítem por su MARCA y su NOMBRE,"],
        ["así que actualiza los que ya existen en vez de duplicarlos. Si le cambias el nombre a un producto,"],
        ["el sistema lo toma como uno nuevo — para renombrar algo, hazlo desde el catálogo del sistema."],
      ],
    },
  ]);
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

/** Espacios colapsados y bordes limpios, conservando tildes y mayúsculas. */
function limpiar(texto: string): string {
  return texto.trim().replace(/\s+/g, " ");
}

/**
 * Verifica los encabezados y devuelve el problema si no cuadran.
 *
 * Señala LA columna concreta que está mal en vez de un "los encabezados no
 * coinciden" genérico: con ocho columnas, el mensaje genérico obliga a
 * compararlas a ojo una por una.
 */
function revisarEncabezado(crudas: string[][]): ProblemaEnFila | null {
  const fila = (crudas[0] ?? []).map((c) => normalizar(c));

  if (fila.length < COLUMNAS_OBLIGATORIAS) {
    return {
      fila: 1,
      columna: "",
      problema:
        `La planilla tiene ${fila.length} columna(s) y hacen falta ${COLUMNAS_OBLIGATORIAS}: ` +
        `${COLUMNAS.slice(0, COLUMNAS_OBLIGATORIAS).join(", ")}. ` +
        "Descarga la plantilla de nuevo y copia tus datos ahí.",
    };
  }

  for (let c = 0; c < COLUMNAS_OBLIGATORIAS; c++) {
    const esperados = SINONIMOS[c] ?? [normalizar(COLUMNAS[c])];
    if (esperados.includes(fila[c] ?? "")) continue;
    return {
      fila: 1,
      columna: letraDeColumna(c),
      problema:
        `La columna ${letraDeColumna(c)} debería decir "${COLUMNAS[c]}" y dice "${crudas[0]?.[c] ?? ""}". ` +
        "No cambies los encabezados ni el orden de las columnas.",
    };
  }

  return null;
}

function letraDeColumna(indice: number): string {
  return String.fromCharCode(65 + indice);
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

  const malEncabezado = revisarEncabezado(crudas);
  if (malEncabezado) return { filas, problemas: [malEncabezado] };

  /** clave marca+nombre+tipo → fila donde apareció primero. */
  const vistos = new Map<string, number>();

  for (let i = 1; i < crudas.length; i++) {
    const c = crudas[i];
    const numeroDeFila = i + 1;
    const [
      marca = "",
      nombre = "",
      tipo = "",
      categoria = "",
      precioVenta = "",
      precioCompra = "",
      stock = "",
      stockMinimo = "",
    ] = c;

    const celdas = [marca, nombre, tipo, categoria, precioVenta, precioCompra, stock, stockMinimo];
    // Fila totalmente vacía: es el relleno de la plantilla, no un error.
    if (!celdas.some((v) => v.trim() !== "")) continue;

    const anotar = (columna: string, problema: string) => problemas.push({ fila: numeroDeFila, columna, problema });

    const nombreLimpio = limpiar(nombre);
    if (nombreLimpio === "") anotar("NOMBRE", "Falta el nombre.");

    const tipoNormalizado = tipo.trim().toUpperCase();
    const tipoValido = tipoNormalizado === "SERVICIO" || tipoNormalizado === "PRODUCTO";
    if (!tipoValido) {
      anotar("TIPO", `"${tipo}" no es válido: tiene que decir SERVICIO o PRODUCTO.`);
    }
    const esProducto = tipoNormalizado === "PRODUCTO";

    // PRECIO VENTA vacío NO es un error: es un ítem al que todavía no le
    // pusieron precio, y se carga igual. Lo que sí es un error es que tenga
    // algo escrito que no sea un número.
    let precio: number | null = null;
    if (precioVenta.trim() !== "") {
      precio = aCentimos(precioVenta);
      if (precio === null) {
        anotar("PRECIO VENTA", `"${precioVenta}" no es un precio. Escribe solo el número, por ejemplo 25.50`);
      }
    }

    let costo: number | null = null;
    if (precioCompra.trim() !== "") {
      costo = aCentimos(precioCompra);
      if (costo === null) {
        anotar("PRECIO COMPRA", `"${precioCompra}" no es un precio. Escribe solo el número, por ejemplo 28.00`);
      }
    }

    // Un producto que se vende por debajo de lo que cuesta casi siempre es un
    // dedo, no una decisión. Se avisa sin frenar la carga: a veces es una
    // liquidación de verdad, y no nos toca decidirlo.
    if (precio !== null && costo !== null && precio < costo) {
      anotar(
        "PRECIO VENTA",
        `El precio de venta (${soles(precio)}) es menor que el de compra (${soles(costo)}). ` +
          "Revisa que no estén invertidos. Si es una liquidación a propósito, ignora este aviso: el ítem se carga igual.",
      );
    }

    // "ILIMITADO" y compañía: el cliente fue explícito en que no lleva stock.
    const stockSinControl = sinControlDeStock(stock);
    let stockNumero: number | null = null;
    if (!stockSinControl && stock.trim() !== "") {
      stockNumero = aNumero(stock);
      if (stockNumero === null) {
        anotar("STOCK", `"${stock}" no es una cantidad. Escribe un número, o ILIMITADO si no lleva control de stock.`);
      }
    }
    // Solo si el tipo se entendió: con un tipo inválido, quejarse además del
    // stock manda a la persona a corregir una celda que no tiene nada de malo.
    if (tipoValido && !esProducto && stockNumero !== null && stockNumero > 0) {
      anotar("STOCK", "Un SERVICIO no lleva stock. Deja la celda vacía o escribe ILIMITADO.");
    }

    let minimoNumero: number | null = null;
    if (stockMinimo.trim() !== "") {
      minimoNumero = aNumero(stockMinimo);
      if (minimoNumero === null) anotar("STOCK MÍNIMO", `"${stockMinimo}" no es una cantidad.`);
    }

    const marcaLimpia = limpiar(marca);

    // La identidad de una fila es MARCA + NOMBRE + TIPO, porque la planilla ya
    // no trae código. Sin la marca en la clave, el TALCO de una marca y el de
    // otra serían la misma fila repetida.
    if (nombreLimpio !== "" && tipoValido) {
      const clave = `${normalizar(marcaLimpia)}|${normalizar(nombreLimpio)}|${tipoNormalizado}`;
      const antes = vistos.get(clave);
      if (antes) {
        anotar(
          "NOMBRE",
          `"${marcaLimpia ? `${marcaLimpia} ${nombreLimpio}` : nombreLimpio}" ya está en la fila ${antes}. ` +
            "Si son dos productos distintos, diferéncialos en el nombre o en la marca.",
        );
      } else {
        vistos.set(clave, numeroDeFila);
      }
    }

    // Sin nombre o sin tipo válido no hay ítem que crear. El precio ya NO es
    // condición para entrar: un catálogo sin precios sigue siendo un catálogo.
    if (nombreLimpio === "" || !tipoValido) continue;

    filas.push({
      fila: numeroDeFila,
      marca: marcaLimpia,
      nombre: nombreLimpio,
      tipo: tipoNormalizado,
      // Vacía se deja VACÍA: el valor por defecto lo pone el dominio al crear.
      // Resolverlo acá escondía el dato de que la fila no traía categoría, y
      // entonces el plan de importación no podía avisarlo antes de aplicar.
      categoria: limpiar(categoria),
      precio,
      costo: esProducto ? costo : null,
      stock: esProducto && !stockSinControl ? stockNumero : null,
      stockMinimo: esProducto ? minimoNumero : null,
    });
  }

  return { filas, problemas };
}

function soles(centimos: number): string {
  return `S/ ${(centimos / 100).toFixed(2)}`;
}
