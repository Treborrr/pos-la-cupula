/**
 * Catálogo de servicios y productos.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { coincide, normalizar } from "@cupula/contratos";
import {
  actualizarFotoDeItem,
  actualizarItem,
  crearItem,
  desactivarItem,
  reactivarItem,
  siguienteCodigo,
} from "../../dominio/catalogo/catalogo";
import { ErrorDeNegocio } from "../../dominio/errores";
import { importarCatalogo, planificarImportacion } from "../../dominio/catalogo/importar";
import { generarPlantilla, leerPlantilla } from "../../adaptadores/planilla/plantillaCatalogo";
import type { Dependencias } from "../app";

/** JPG, PNG y WEBP: lo que cualquier celular o cámara produce sin convertir nada. */
const EXTENSION_POR_TIPO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** 3 MB alcanza de sobra para una foto de producto y no castiga el respaldo. */
const MAX_BYTES_FOTO = 3 * 1024 * 1024;

/**
 * Booleano de query string.
 *
 * `z.coerce.boolean()` da VERDADERO para "false" y para "0", porque son
 * cadenas no vacías. Con `?incluirInactivos=false` se colaban los inactivos en
 * la pantalla de cobro.
 */
export const booleanoDeQuery = () =>
  z.preprocess((v) => (v === "false" || v === "0" ? false : v), z.coerce.boolean());

const esquemaItemNuevo = z.object({
  // Vacío u omitido: lo genera el servidor (ver `siguienteCodigo`).
  codigo: z.string().trim().max(24).optional(),
  marca: z.string().trim().max(40).optional(),
  nombre: z.string().trim().min(1).max(80),
  tipo: z.enum(["SERVICIO", "PRODUCTO"]),
  categoria: z.string().trim().min(1).max(40),
  /**
   * `null` u omitido = se crea sin precio y habrá que ponérselo antes de
   * venderlo. Se admite omitirlo porque "sin precio" es un estado válido del
   * catálogo, y obligar a mandar `precio: null` explícitamente sería pedirle
   * ceremonia a quien carga ítems desde un script.
   */
  precio: z.number().int().min(0).nullable().optional().default(null),
  costo: z.number().int().min(0).nullable().optional(),
  stockMinimo: z.number().min(0).optional(),
  stockInicial: z.number().min(0).optional(),
  orden: z.number().int().min(0).optional(),
});

/**
 * Cambios sobre un ítem. Campo ausente = no tocar; `null` en precio o costo =
 * dejarlo sin valor.
 *
 * La distinción importa: si `precio: null` se tratara como "no tocar", no habría
 * forma de quitarle el precio a un ítem, y si `undefined` se tratara como null,
 * un PATCH que solo cambia el nombre le borraría el precio.
 */
const esquemaCambios = z.object({
  codigo: z.string().trim().min(1).max(24).optional(),
  marca: z.string().trim().max(40).optional(),
  nombre: z.string().trim().min(1).max(80).optional(),
  categoria: z.string().trim().min(1).max(40).optional(),
  precio: z.number().int().min(0).nullable().optional(),
  costo: z.number().int().min(0).nullable().optional(),
  stockMinimo: z.number().min(0).optional(),
  orden: z.number().int().min(0).optional(),
  motivoPrecio: z.string().trim().max(200).optional(),
  motivoCosto: z.string().trim().max(200).optional(),
});

export async function rutasCatalogo(app: FastifyInstance, { pos, carpetaDatos }: Dependencias) {
  /** Un ítem por su id, con `nombreCompleto` y `stock` resueltos. */
  const paraPantalla = (id: string) => {
    const item = pos.p.items.get(id);
    return item ? pos.p.itemParaPantalla(item) : undefined;
  };

  const carpetaFotos = join(carpetaDatos, "fotos");

  /** Borra cualquier archivo `<id>.*` que haya, sin importar la extensión vieja. */
  async function borrarFotoVieja(itemId: string): Promise<void> {
    let archivos: string[] = [];
    try {
      archivos = await readdir(carpetaFotos);
    } catch {
      return; // la carpeta todavía no existe: nada que borrar
    }
    for (const archivo of archivos) {
      if (archivo.startsWith(`${itemId}.`)) await rm(join(carpetaFotos, archivo), { force: true });
    }
  }

  app.get("/catalogo", { config: { rol: "CAJERO" } }, async (peticion) => {
    const { q, incluirInactivos, tipo, marca, soloSinPrecio } = z
      .object({
        q: z.string().optional(),
        incluirInactivos: booleanoDeQuery().optional(),
        tipo: z.enum(["SERVICIO", "PRODUCTO"]).optional(),
        marca: z.string().optional(),
        soloSinPrecio: booleanoDeQuery().optional(),
      })
      .parse(peticion.query);

    let items = [...pos.p.items.values()];
    if (!incluirInactivos) items = items.filter((i) => i.activo);
    if (tipo) items = items.filter((i) => i.tipo === tipo);
    if (marca) items = items.filter((i) => normalizar(i.marca) === normalizar(marca));
    if (soloSinPrecio) items = items.filter((i) => i.precio === null);
    // La marca entra en la búsqueda: quien escribe "forajido" espera ver las
    // pastas de FORAJIDO, aunque la palabra no esté en el nombre de ninguna.
    if (q) items = items.filter((i) => coincide(`${i.codigo} ${i.marca} ${i.nombre} ${i.categoria}`, q));

    // Orden de la grilla primero, después alfabético: el dueño puede poner los
    // servicios más vendidos adelante sin pelear con el orden alfabético.
    items.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));

    return {
      items: items.map((i) => ({
        ...i,
        nombreCompleto: pos.p.nombreCompleto(i),
        stock: i.tipo === "PRODUCTO" ? pos.p.stockDe(i.id) : null,
      })),
      categorias: [...new Set(items.map((i) => i.categoria))].sort((a, b) => a.localeCompare(b, "es")),
      // Las marcas salen del catálogo COMPLETO y no de `items`: si salieran del
      // resultado filtrado, al elegir una marca el desplegable se quedaría con
      // esa sola y no habría cómo volver a otra.
      marcas: pos.p.marcas(),
      /** Cuántos ítems activos no tienen precio, para el aviso de la pantalla. */
      sinPrecio: pos.p.sinPrecio().length,
      /** Cuántos productos no tienen costo: sin ellos, el margen queda en blanco. */
      sinCosto: pos.p.sinCosto().length,
    };
  });

  /**
   * Pone precio de venta y/o de compra a varios ítems de una sola vez.
   *
   * Existe por los 169 productos que el cliente cargó sin precio: hacerlo de a
   * uno son 169 idas y vueltas al servidor, y si la número 80 falla el usuario
   * no sabe cuáles quedaron hechas. Acá entran todos juntos en una sola tanda —
   * o entran todos o no entra ninguno— y cada uno deja su propio evento de
   * cambio, así que la historia queda igual de auditable.
   *
   * Los dos valores viajan juntos porque se cargan juntos: quien tiene el
   * producto en la mano sabe a cuánto lo compró y a cuánto lo vende. Separarlos
   * en dos pantallas obligaba a recorrer el catálogo dos veces, y por eso el
   * precio de compra quedaba sin cargar y todo el reporte de margen en blanco.
   *
   * Un campo AUSENTE no se toca; `null` lo deja sin valor.
   */
  app.post("/catalogo/precios", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { precios, motivo } = z
      .object({
        precios: z
          .array(
            z.object({
              itemId: z.string().min(1),
              precio: z.number().int().min(0).nullable().optional(),
              costo: z.number().int().min(0).nullable().optional(),
            }),
          )
          .min(1)
          .max(500),
        motivo: z.string().trim().max(200).optional(),
      })
      .parse(peticion.body);

    // Se validan TODOS antes de escribir uno: un id inexistente en la fila 40 no
    // puede dejar las 39 anteriores aplicadas y el resto no.
    for (const { itemId } of precios) {
      if (!pos.p.items.has(itemId)) {
        throw new ErrorDeNegocio("ITEM_NO_EXISTE", "Uno de los ítems de la lista ya no existe.");
      }
    }

    const porQue = motivo ?? "Carga de precios pendientes";
    await pos.escribir(
      () =>
        precios.flatMap(({ itemId, precio, costo }) =>
          actualizarItem(pos.p, itemId, {
            ...(precio !== undefined ? { precio, motivoPrecio: porQue } : {}),
            ...(costo !== undefined ? { costo, motivoCosto: porQue } : {}),
          }),
        ),
      peticion.actor,
    );

    return {
      actualizados: precios.length,
      sinPrecio: pos.p.sinPrecio().length,
      sinCosto: pos.p.sinCosto().length,
    };
  });

  /**
   * La plantilla de Excel para que el cliente cargue su catálogo.
   *
   * Se genera al vuelo en vez de servir un archivo guardado: así los
   * encabezados y las instrucciones nunca se despegan de lo que el lector
   * espera de verdad.
   */
  app.get("/catalogo/plantilla.xlsx", { config: { rol: "ADMIN" } }, async (_peticion, respuesta) => {
    return respuesta
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", 'attachment; filename="catalogo-la-cupula.xlsx"')
      .send(generarPlantilla());
  });

  /**
   * Importa el catálogo desde la planilla llena.
   *
   * En dos pasos a propósito. Con `revisar` no se escribe nada y se devuelve
   * exactamente qué va a pasar con cada fila; recién con `agregar` o
   * `reemplazar` se ejecuta. Autorizar una carga masiva sin ver antes qué
   * cambia es la diferencia entre cargar el catálogo y quedarse sin catálogo.
   *
   * El archivo viaja en base64 dentro del JSON para no sumar un plugin de
   * subida por un .xlsx de veinte kilobytes.
   */
  app.post("/catalogo/importar", { config: { rol: "ADMIN" } }, async (peticion) => {
    // `modo` y `aplicar` son independientes a propósito: revisar SIEMPRE se
    // hace sobre el modo elegido. Mezclarlos hacía que la vista previa de
    // "reemplazar" se calculara como "agregar" y no mostrara nada de lo que
    // se iba a desactivar, que es justo lo que hay que ver antes de aceptar.
    const { archivo, modo, aplicar } = z
      .object({
        archivo: z.string().min(1),
        modo: z.enum(["agregar", "reemplazar"]),
        aplicar: z.boolean().default(false),
      })
      .parse(peticion.body);

    let lectura;
    try {
      lectura = leerPlantilla(Buffer.from(archivo, "base64"));
    } catch (e) {
      throw new ErrorDeNegocio(
        "PLANILLA_ILEGIBLE",
        e instanceof Error ? e.message : "No se pudo leer el archivo.",
        "Tiene que ser el .xlsx de la plantilla, sin convertir a otro formato.",
      );
    }

    const plan = planificarImportacion(pos.p, lectura.filas, modo);

    if (!aplicar) {
      return { aplicado: false, problemas: lectura.problemas, filas: lectura.filas.length, plan };
    }

    // Una planilla con errores no se aplica a medias: se corrige y se sube de
    // nuevo. Importar solo las filas buenas dejaría un catálogo incompleto que
    // nadie sabría que lo está.
    if (lectura.problemas.length > 0) {
      throw new ErrorDeNegocio(
        "PLANILLA_CON_ERRORES",
        `La planilla tiene ${lectura.problemas.length} ${lectura.problemas.length === 1 ? "problema" : "problemas"} que hay que corregir antes de cargarla.`,
        "Revisa la lista, corrige el Excel y vuelve a subirlo.",
      );
    }
    if (lectura.filas.length === 0) {
      throw new ErrorDeNegocio("PLANILLA_VACIA", "La planilla no tiene ninguna fila con datos.");
    }

    await pos.escribir(() => importarCatalogo(pos.p, lectura.filas, modo), peticion.actor);

    return { aplicado: true, problemas: [], filas: lectura.filas.length, plan };
  });

  /** Lo consulta el formulario de alta para mostrar el código que va a tocar. */
  app.get("/catalogo/siguiente-codigo", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { tipo } = z.object({ tipo: z.enum(["SERVICIO", "PRODUCTO"]) }).parse(peticion.query);
    return { codigo: siguienteCodigo(pos.p, tipo) };
  });

  app.post("/catalogo", { config: { rol: "ADMIN" } }, async (peticion, respuesta) => {
    const datos = esquemaItemNuevo.parse(peticion.body);
    const itemId = await pos.transaccion(() => {
      const r = crearItem(pos.p, datos);
      return { eventos: r.eventos, resultado: r.itemId };
    }, peticion.actor);
    return respuesta.status(201).send({ item: paraPantalla(itemId) });
  });

  app.patch("/catalogo/:id", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const cambios = esquemaCambios.parse(peticion.body);
    await pos.escribir(() => actualizarItem(pos.p, id, cambios), peticion.actor);
    return { item: paraPantalla(id) };
  });

  app.post("/catalogo/:id/desactivar", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { motivo } = z.object({ motivo: z.string().trim().max(200).optional() }).parse(peticion.body ?? {});
    await pos.escribir(() => desactivarItem(pos.p, id, motivo), peticion.actor);
    return { item: paraPantalla(id) };
  });

  app.post("/catalogo/:id/reactivar", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    await pos.escribir(() => reactivarItem(pos.p, id), peticion.actor);
    return { item: paraPantalla(id) };
  });

  /**
   * Sube la foto de un ítem. El archivo va CRUDO en el cuerpo —no multipart,
   * no JSON— con el `Content-Type` real de la imagen; `app.ts` registra el
   * parser que lo deja pasar tal cual.
   */
  app.post(
    "/catalogo/:id/foto",
    { bodyLimit: MAX_BYTES_FOTO, config: { rol: "ADMIN" } },
    async (peticion, respuesta) => {
      const { id } = z.object({ id: z.string() }).parse(peticion.params);
      if (!pos.p.items.get(id)) throw new ErrorDeNegocio("ITEM_NO_EXISTE", "Ese ítem no existe.");

      const tipo = peticion.headers["content-type"] ?? "";
      const extension = EXTENSION_POR_TIPO[tipo];
      if (!extension) {
        throw new ErrorDeNegocio("DATO_INVALIDO", "La foto tiene que ser JPG, PNG o WEBP.");
      }

      const bytes = peticion.body as Buffer;
      await mkdir(carpetaFotos, { recursive: true });
      await borrarFotoVieja(id);
      const archivo = `${id}.${extension}`;
      await writeFile(join(carpetaFotos, archivo), bytes);

      await pos.escribir(() => actualizarFotoDeItem(pos.p, id, archivo), peticion.actor);
      return respuesta.status(201).send({ item: paraPantalla(id) });
    },
  );

  app.post("/catalogo/:id/foto/quitar", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    if (!pos.p.items.get(id)) throw new ErrorDeNegocio("ITEM_NO_EXISTE", "Ese ítem no existe.");

    await borrarFotoVieja(id);
    await pos.escribir(() => actualizarFotoDeItem(pos.p, id, null), peticion.actor);
    return { item: paraPantalla(id) };
  });
}
