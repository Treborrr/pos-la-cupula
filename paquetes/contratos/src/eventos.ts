/**
 * El contrato de eventos. Esto es lo que queda escrito en disco PARA SIEMPRE.
 *
 * Reglas duras, en orden de importancia:
 *
 *  1. Un evento escrito NUNCA se modifica ni se borra. Si el negocio cambia,
 *     se sube `v` y se escribe un upcaster en `upcasters.ts`.
 *  2. Todo monto va en céntimos enteros (ver `dinero.ts`).
 *  3. Las líneas de venta desnormalizan código, nombre y tipo del ítem: si
 *     mañana el producto se renombra, el ticket de ayer sigue diciendo lo que
 *     decía. El Excel hacía esto bien y hay que conservarlo.
 *  4. Agregar un campo OPCIONAL a un evento no requiere subir `v`.
 *     Quitar un campo, renombrarlo o cambiar su significado, sí.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Piezas comunes
// ─────────────────────────────────────────────────────────────────────────────

/** ULID en canónico Crockford base32: ordenable por tiempo, 26 caracteres. */
export const esquemaUlid = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "no es un ULID válido");

/**
 * ISO 8601 CON offset explícito (`-05:00`). Nunca hora local ambigua: el día
 * que esto corra en un servidor en la nube, la zona tiene que venir en el dato
 * y no deducirse de dónde está corriendo el proceso.
 */
export const esquemaFecha = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?([+-]\d{2}:\d{2}|Z)$/,
    "la fecha debe ser ISO 8601 con offset",
  );

/** Monto en céntimos. Entero, con un techo absurdo a propósito. */
export const esquemaCentimos = z
  .number()
  .int("los montos van en céntimos enteros")
  .min(-100_000_000)
  .max(100_000_000);

export const esquemaCentimosPositivo = esquemaCentimos.min(0);

/**
 * Quién hizo la cosa. Hoy siempre `{tipo:"operador", id:"mostrador"}` porque
 * hay un solo usuario, pero existe desde el día 1: agregar usuarios después no
 * puede obligar a migrar el histórico.
 */
export const esquemaActor = z.object({
  tipo: z.enum(["operador", "sistema", "migracion"]),
  id: z.string().min(1).max(64),
});
export type Actor = z.infer<typeof esquemaActor>;

export const ACTOR_MOSTRADOR: Actor = { tipo: "operador", id: "mostrador" };
export const ACTOR_SISTEMA: Actor = { tipo: "sistema", id: "servidor" };

/**
 * Medios de pago. Agregar un valor a este enum es un cambio ADITIVO: no rompe
 * eventos viejos y no requiere subir `v`. (PLIN y transferencia entran aquí el
 * día que hagan falta.)
 */
/**
 * ADELANTO: el barbero se lleva el producto o servicio, pero no paga — se le
 * descuenta de lo que le corresponde cobrar esa semana (ver §4 de
 * dominio/barberos). No es efectivo cobrado: el arqueo lo deja fuera a
 * propósito, así el cajón no espera una plata que nunca entró.
 */
export const esquemaMedioPago = z.enum(["EFECTIVO", "YAPE", "TARJETA", "ADELANTO"]);
export type MedioPago = z.infer<typeof esquemaMedioPago>;

export const esquemaTipoItem = z.enum(["SERVICIO", "PRODUCTO"]);
export type TipoItem = z.infer<typeof esquemaTipoItem>;

/**
 * Cantidad vendida. Acepta fracciones (media hora de tatuaje) pero acotadas a
 * 3 decimales para que nunca aparezca un 0.30000000000000004 en un ticket.
 */
export const esquemaCantidad = z
  .number()
  .positive("la cantidad debe ser mayor a cero")
  .max(100_000)
  .refine((n) => Number.isFinite(n) && Math.round(n * 1000) === n * 1000, {
    message: "la cantidad admite hasta 3 decimales",
  });

const texto = (max: number) => z.string().trim().min(1).max(max);
const textoOpcional = (max: number) => z.string().trim().max(max).optional();

/**
 * Código de ítem. Se normaliza a MAYÚSCULAS siempre, porque en el Excel
 * convivían `cor d` y `COR D` como si fueran cosas distintas y en el registro
 * de ventas quedaron las dos formas.
 */
export const esquemaCodigo = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9._-]+$/, "el código admite letras, números, punto, guion y guion bajo")
  .transform((s) => s.toUpperCase());

// ─────────────────────────────────────────────────────────────────────────────
// Sobre del evento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye el esquema completo de un tipo de evento: el sobre + sus datos.
 *
 * El sobre lo llena el almacén, no el que llama. `seq`, `id`, `ts` y `h` no son
 * decisión del dominio: son propiedades del hecho de haber sido escrito.
 */
function definir<T extends string, D extends z.ZodTypeAny>(tipo: T, datos: D) {
  return z.object({
    /** Entero monótono. Un hueco en la secuencia es corrupción, y se detecta. */
    seq: z.number().int().positive(),
    /** ULID. Es la PRIMARY KEY el día de Postgres. */
    id: esquemaUlid,
    ts: esquemaFecha,
    tipo: z.literal(tipo),
    /** Versión de ESTE tipo de evento. Ver `upcasters.ts`. */
    v: z.number().int().positive(),
    actor: esquemaActor,
    /**
     * Cadena de hash: sha256(h_anterior + evento_canónico), 16 hex.
     * Si alguien edita una línea con el Bloc de notas, todas las posteriores
     * dejan de validar. Cuesta microsegundos y hace el log a prueba de
     * manoseo.
     */
    h: z.string().regex(/^[0-9a-f]{16}$/),
    datos,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo
// ─────────────────────────────────────────────────────────────────────────────

export const itemCreado = definir(
  "item.creado",
  z.object({
    itemId: esquemaUlid,
    codigo: esquemaCodigo,
    /**
     * La marca comercial, aparte del nombre.
     *
     * Va en su propio campo y no pegada al nombre porque el catálogo real trae
     * nombres que se repiten entre marcas —dos marcas pueden vender cada una su
     * TALCO— y con un solo campo de texto esos dos productos son
     * indistinguibles en la pantalla de cobro. Además permite preguntar cuánto
     * se vendió de cada marca, que con 40 marcas es una pregunta de negocio.
     */
    marca: textoOpcional(40),
    nombre: texto(80),
    tipo: esquemaTipoItem,
    categoria: texto(40),
    /**
     * `null` = el ítem existe pero todavía NO tiene precio de lista.
     *
     * No es un caso raro: el catálogo con el que arrancó La Cúpula traía 119 de
     * 137 productos sin precio. Representarlo como `null` y no como 0 es la
     * diferencia entre "falta ponerle precio" y "es gratis" — un 0 se cobraría
     * en silencio, y un ítem sin precio hay que pedirlo al cobrar.
     */
    precio: esquemaCentimosPositivo.nullable(),
    /**
     * Costo unitario de partida, en céntimos. Siembra el promedio ponderado
     * (ver `stock.entrada`); `null` = todavía no se sabe a cuánto se compra.
     */
    costo: esquemaCentimosPositivo.nullable().optional(),
    /** Solo tiene sentido en PRODUCTO. En SERVICIO se ignora. */
    stockMinimo: z.number().min(0).max(100_000).optional(),
    /** Posición en la grilla de la pantalla de cobro. */
    orden: z.number().int().min(0).max(9999).optional(),
  }),
);

export const itemActualizado = definir(
  "item.actualizado",
  z.object({
    itemId: esquemaUlid,
    /**
     * Cambiar el código es válido y a veces necesario (dos ítems que quedaron
     * peleando el mismo). El dominio verifica que el nuevo esté libre; las
     * ventas viejas no se ven afectadas porque guardan el código que tenían
     * al momento de venderse.
     */
    codigo: esquemaCodigo.optional(),
    /** Cadena vacía = borrarle la marca. Ausente = no tocarla. */
    marca: textoOpcional(40),
    nombre: textoOpcional(80),
    categoria: textoOpcional(40),
    stockMinimo: z.number().min(0).max(100_000).optional(),
    orden: z.number().int().min(0).max(9999).optional(),
  }),
);

/**
 * El precio va en su propio evento y no dentro de `item.actualizado` a
 * propósito: así se puede responder "¿desde cuándo el corte cuesta 25?" sin
 * escarbar diffs.
 *
 * Los dos extremos son anulables porque ponerle precio por primera vez a un
 * ítem que no tenía (null → 2500) y quitárselo son cambios de precio como
 * cualquier otro, y tienen que quedar en la misma historia.
 */
export const itemPrecioCambiado = definir(
  "item.precio_cambiado",
  z.object({
    itemId: esquemaUlid,
    precioAnterior: esquemaCentimosPositivo.nullable(),
    precioNuevo: esquemaCentimosPositivo.nullable(),
    motivo: textoOpcional(200),
  }),
);

/**
 * El costo cambió por una decisión humana, no por una compra.
 *
 * Normalmente el costo lo mueve `stock.entrada` con su `costoUnitario`, y el
 * promedio ponderado se recalcula solo. Este evento es para las dos veces en
 * que eso no aplica: la carga inicial desde la planilla (hay costo declarado
 * pero no hubo compra que registrar) y la corrección a mano de un costo mal
 * cargado. Se guarda el anterior al lado por la misma razón que en el precio:
 * sin eso, un costo corregido no se puede auditar después.
 */
export const itemCostoCambiado = definir(
  "item.costo_cambiado",
  z.object({
    itemId: esquemaUlid,
    costoAnterior: esquemaCentimosPositivo.nullable(),
    costoNuevo: esquemaCentimosPositivo.nullable(),
    motivo: textoOpcional(200),
  }),
);

/** Nunca se borra un ítem: las ventas viejas quedarían apuntando al vacío. */
export const itemDesactivado = definir(
  "item.desactivado",
  z.object({ itemId: esquemaUlid, motivo: textoOpcional(200) }),
);

export const itemReactivado = definir(
  "item.reactivado",
  z.object({ itemId: esquemaUlid }),
);

/**
 * La foto vive como ARCHIVO en `datos/fotos/`, nunca en el log: una imagen en
 * base64 adentro de un evento lo infla sin sentido, y cada cambio de foto
 * quedaría escrito para siempre aunque la vieja ya no sirva para nada. Acá
 * solo se guarda el NOMBRE del archivo — la referencia, no el contenido.
 */
export const itemFotoActualizada = definir(
  "item.foto_actualizada",
  z.object({
    itemId: esquemaUlid,
    /** Null = se quitó la foto. */
    archivo: z.string().max(80).nullable(),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Inventario (solo ítems tipo PRODUCTO)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entró mercadería.
 *
 * `costoUnitario` es lo que alimenta el COSTO PROMEDIO PONDERADO del producto:
 * si había 6 unidades a 28 y entran 4 a 34, el costo pasa a 30.40, y es contra
 * ese número que se mide la utilidad de las ventas siguientes. Una entrada sin
 * costo declarado no ensucia el promedio —se asume que entró al costo que ya
 * tenía—, pero tampoco lo mejora: si nunca se declara ninguno, el producto
 * queda sin costo conocido y sus ventas se reportan como "costo no registrado"
 * en vez de fingir un margen del 100%.
 */
export const stockEntrada = definir(
  "stock.entrada",
  z.object({
    itemId: esquemaUlid,
    cantidad: esquemaCantidad,
    costoUnitario: esquemaCentimosPositivo.optional(),
    motivo: texto(200),
    referencia: textoOpcional(80),
  }),
);

/**
 * Conté y hay 10, el sistema decía 12. Se guardan LAS DOS cifras, no solo la
 * diferencia: sin el valor que el sistema creía tener, un ajuste no se puede
 * auditar después.
 */
export const stockAjustado = definir(
  "stock.ajustado",
  z.object({
    itemId: esquemaUlid,
    cantidadContada: z.number().min(0).max(1_000_000),
    cantidadSistema: z.number().min(-1_000_000).max(1_000_000),
    motivo: texto(200),
  }),
);

export const stockMerma = definir(
  "stock.merma",
  z.object({
    itemId: esquemaUlid,
    cantidad: esquemaCantidad,
    motivo: texto(200),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Ventas
// ─────────────────────────────────────────────────────────────────────────────

export const esquemaLineaVenta = z.object({
  itemId: esquemaUlid,
  /** Desnormalizado a propósito — ver regla 3 arriba. */
  codigo: esquemaCodigo,
  /** También desnormalizada: el ticket de ayer conserva la marca de ayer. */
  marca: textoOpcional(40),
  nombre: texto(80),
  tipo: esquemaTipoItem,
  cantidad: esquemaCantidad,
  /** Lo que se cobró de verdad por unidad. */
  precioUnitario: esquemaCentimosPositivo,
  /**
   * Lo que decía la lista en ese momento. Si difiere del cobrado, hubo un
   * ajuste manual — y eso es exactamente lo que se quiere poder reportar.
   *
   * `null` = el ítem no tenía precio de lista y el precio se escribió al
   * cobrar. Distinguirlo de "la lista decía 0" importa: lo primero es un
   * catálogo incompleto, lo segundo sería un regalo.
   */
  precioLista: esquemaCentimosPositivo.nullable(),
  /**
   * El costo promedio ponderado del ítem AL MOMENTO DE VENDER, congelado acá.
   *
   * Es lo que hace que la utilidad de un mes cerrado no se mueva nunca: si en
   * octubre sube el costo de la cera, el reporte de septiembre sigue diciendo
   * lo que decía en septiembre. Calcularla contra el costo de hoy haría que
   * ningún mes se pudiera cerrar.
   *
   * `null` = no se conocía el costo (ventas anteriores a que existiera este
   * campo, o productos que nunca tuvieron costo cargado). Se reporta como
   * "costo no registrado"; tratarlo como 0 inventaría un margen del 100%.
   */
  costoUnitario: esquemaCentimosPositivo.nullable().optional(),
  /** Quién atendió. Solo dato: NO hay cálculo de comisiones (sueldo fijo). */
  barberoId: esquemaUlid.nullable(),
  /** cantidad × precioUnitario, ya redondeado. Se guarda para no recalcular. */
  total: esquemaCentimosPositivo,
});
export type LineaVenta = z.infer<typeof esquemaLineaVenta>;

/**
 * Una venta admite VARIOS pagos: parte en efectivo y parte en YAPE pasa a
 * diario en una barbería y el Excel no lo permitía. La suma debe dar el total;
 * eso lo valida el dominio, no el esquema, porque necesita ver las líneas.
 */
export const esquemaPago = z.object({
  medio: esquemaMedioPago,
  monto: esquemaCentimosPositivo,
  /** Solo en efectivo: con cuánto pagó, para dejar registro del vuelto. */
  recibido: esquemaCentimosPositivo.optional(),
  vuelto: esquemaCentimosPositivo.optional(),
  /** Obligatorio cuando medio es ADELANTO: a quién se le descuenta. */
  barberoId: esquemaUlid.optional(),
});
export type Pago = z.infer<typeof esquemaPago>;

export const ventaRegistrada = definir(
  "venta.registrada",
  z.object({
    ventaId: esquemaUlid,
    /** `NV000030`. Asignado por el servidor dentro de la sección crítica. */
    correlativo: z.string().regex(/^NV\d{6}$/),
    lineas: z.array(esquemaLineaVenta).min(1, "una venta sin líneas no existe"),
    subtotal: esquemaCentimosPositivo,
    /** Descuento a nivel de venta, aparte del ajuste línea por línea. */
    descuento: esquemaCentimosPositivo,
    total: esquemaCentimosPositivo,
    pagos: z.array(esquemaPago).min(1),
    clienteId: esquemaUlid.nullable(),
    /** Turno de caja en el que cayó. Null si se cobró con la caja cerrada. */
    turnoId: esquemaUlid.nullable(),
    /**
     * La que manda el navegador. Si el mismo POST llega dos veces (doble clic,
     * timeout y reintento), el servidor devuelve la venta ya creada en vez de
     * cobrar dos veces. Es el arreglo del peor riesgo del Excel.
     */
    claveIdempotencia: esquemaUlid,
    notas: textoOpcional(500),
  }),
);

/**
 * Anular no borra: escribe este evento. El stock vuelve, el correlativo queda
 * consumido (un salto sin explicación en la numeración es justo lo que un
 * contador no quiere ver) y la venta aparece tachada en el historial.
 */
export const ventaAnulada = definir(
  "venta.anulada",
  z.object({
    ventaId: esquemaUlid,
    correlativo: z.string().regex(/^NV\d{6}$/),
    motivo: texto(200),
  }),
);

export const ventaReimpresa = definir(
  "venta.reimpresa",
  z.object({ ventaId: esquemaUlid, correlativo: z.string().regex(/^NV\d{6}$/) }),
);

/**
 * Propina que el cliente le dio a un barbero por un servicio puntual.
 *
 * NO es parte del cobro: el dinero no pasa por el cajón, no cuenta para el
 * arqueo y no cambia el total de la venta (D6: sueldo fijo, sin comisiones).
 * Es un registro aparte para que el dueño sepa cuánto recibe cada barbero y
 * pueda conversarlo con ellos — nunca para calcular ni liquidar nada.
 *
 * Se referencia por POSICIÓN de línea (`lineaIndex`) y no por un id propio: una
 * línea de venta no tiene uno, y el arreglo de líneas de una venta ya
 * registrada no cambia.
 */
export const ventaPropinaRegistrada = definir(
  "venta.propina_registrada",
  z.object({
    propinaId: esquemaUlid,
    ventaId: esquemaUlid,
    lineaIndex: z.number().int().min(0),
    barberoId: esquemaUlid,
    monto: esquemaCentimosPositivo.min(1),
    /** Null si se cobró, o se corrigió después, con la caja cerrada. */
    turnoId: esquemaUlid.nullable(),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Caja
// ─────────────────────────────────────────────────────────────────────────────

export const cajaTurnoAbierto = definir(
  "caja.turno_abierto",
  z.object({
    turnoId: esquemaUlid,
    montoInicial: esquemaCentimosPositivo,
    notas: textoOpcional(500),
  }),
);

/**
 * Para qué salió. Todas representan plata que salió DE VERDAD del cajón
 * físico —incluida YAPE/DEPOSITO: es efectivo convertido a saldo digital o
 * llevado al banco, no un pago que nunca tocó el cajón— así que las cuatro
 * se restan igual del efectivo esperado. La categoría es para poder
 * reportarlas por separado, no para cambiar esa cuenta.
 *
 * ADELANTO es la única que además liga el egreso a un barbero: es plata que
 * se le descuenta de su sueldo más adelante, y por eso la sección Barberos
 * necesita saber a quién.
 */
export const CATEGORIAS_EGRESO = ["ADELANTO", "COMPRA", "YAPE", "DEPOSITO", "OTRO"] as const;
export const esquemaCategoriaEgreso = z.enum(CATEGORIAS_EGRESO);
export type CategoriaEgreso = (typeof CATEGORIAS_EGRESO)[number];

/**
 * Salió plata del cajón que no es una venta: insumos, un adelanto, el taxi.
 *
 * Es el evento que hace que el arqueo signifique algo. Sin él, el sistema
 * calculaba el efectivo esperado como "inicial + cobrado en efectivo" e
 * ignoraba todo lo que salió, así que decía S/ 480 cuando en el cajón había
 * S/ 430 y nadie podía explicar la diferencia. Una caja que nunca cuadra es
 * una caja que nadie mira, y entonces un faltante de verdad pasa inadvertido.
 *
 * El MOTIVO es obligatorio y no tiene valor por defecto: un egreso sin motivo
 * es indistinguible de plata que falta, que es exactamente lo que esto viene a
 * resolver.
 */
export const cajaEgresoRegistrado = definir(
  "caja.egreso_registrado",
  z.object({
    egresoId: esquemaUlid,
    /**
     * El turno del que sale la plata. Puede ser null si la caja estaba
     * cerrada: igual que con las ventas, negarse a registrarlo haría que el
     * dato se pierda, y un egreso no registrado es peor que uno sin turno.
     */
    turnoId: esquemaUlid.nullable(),
    monto: esquemaCentimosPositivo.min(1),
    motivo: texto(200),
    /** Número de boleta o factura del gasto, si lo hay. */
    comprobante: textoOpcional(80),
    /**
     * Opcional: los egresos escritos antes de esto no la traen, y se leen
     * como "OTRO" (ver Proyeccion.ts). Campo nuevo y opcional no sube `v`.
     */
    categoria: esquemaCategoriaEgreso.optional(),
    /** Obligatorio cuando categoria es ADELANTO; ausente en cualquier otra. */
    barberoId: esquemaUlid.optional(),
  }),
);

export const cajaTurnoCerrado = definir(
  "caja.turno_cerrado",
  z.object({
    turnoId: esquemaUlid,
    /** Lo que el sistema calculó que debería haber. */
    esperado: z.object({
      montoInicial: esquemaCentimosPositivo,
      efectivo: esquemaCentimosPositivo,
      yape: esquemaCentimosPositivo,
      tarjeta: esquemaCentimosPositivo,
      totalVendido: esquemaCentimosPositivo,
      /** Lo que salió del cajón en el turno. Opcional: los cierres anteriores
       *  a que existieran los egresos no lo traen. */
      egresos: esquemaCentimosPositivo.optional(),
      /**
       * Puede dar negativo: si los egresos del turno superan lo que había más
       * lo cobrado en efectivo, lo que "debería haber" es un faltante, no
       * cero. Una compra grande pagada con la caja del día alcanza para esto.
       */
      efectivoEnCajon: esquemaCentimos,
    }),
    /** Lo que la persona contó de verdad. */
    contadoEfectivo: esquemaCentimosPositivo,
    /** contado − esperado. Negativo = falta dinero. */
    diferencia: esquemaCentimos,
    cantidadVentas: z.number().int().min(0),
    notas: textoOpcional(500),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Clientes y barberos
// ─────────────────────────────────────────────────────────────────────────────

export const clienteRegistrado = definir(
  "cliente.registrado",
  z.object({
    clienteId: esquemaUlid,
    nombre: texto(80),
    telefono: textoOpcional(20),
    notas: textoOpcional(500),
  }),
);

export const clienteActualizado = definir(
  "cliente.actualizado",
  z.object({
    clienteId: esquemaUlid,
    nombre: textoOpcional(80),
    telefono: textoOpcional(20),
    notas: textoOpcional(500),
  }),
);

/**
 * Vincula un cliente local con su tarjeta de fidelidad de TarjetaCloud.
 *
 * `origen` importa: si el QR del programa está configurado en modo "nombre"
 * (que es como está La Cúpula hoy), la identificación pasó por un cotejo de
 * texto y puede haberse equivocado con un homónimo. Si vino por "serial", es
 * exacta. Guardar cómo se supo permite auditar los vínculos dudosos después.
 */
export const clienteVinculadoFidelidad = definir(
  "cliente.vinculado_fidelidad",
  z.object({
    clienteId: esquemaUlid,
    serial: z.string().trim().min(3).max(64),
    origen: z.enum(["serial", "nombre", "manual"]),
  }),
);

export const barberoCreado = definir(
  "barbero.creado",
  z.object({ barberoId: esquemaUlid, nombre: texto(80) }),
);

export const barberoActualizado = definir(
  "barbero.actualizado",
  z.object({ barberoId: esquemaUlid, nombre: textoOpcional(80) }),
);

export const barberoDesactivado = definir(
  "barbero.desactivado",
  z.object({ barberoId: esquemaUlid }),
);

/**
 * El dueño le pagó al barbero y los adelantos pendientes quedan en cero para
 * seguir la semana que entra. NO calcula ni paga sueldo —D6 sigue intacta,
 * sueldo fijo sin comisiones—, solo limpia la cuenta de lo que se le había
 * adelantado. `monto` es una FOTO de cuánto se liquidó en ese momento, para
 * el historial; el saldo pendiente real se recalcula siempre desde los
 * adelantos con fecha posterior a esta liquidación.
 */
export const barberoLiquidado = definir(
  "barbero.liquidado",
  z.object({
    liquidacionId: esquemaUlid,
    barberoId: esquemaUlid,
    monto: esquemaCentimosPositivo.min(1),
    notas: textoOpcional(500),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────────────────────

export const configActualizada = definir(
  "config.actualizada",
  z.object({
    /** Ruta con puntos: "negocio.direccion", "impresora.anchoPuntos". */
    clave: z.string().min(1).max(80),
    valor: z.unknown(),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// La unión
// ─────────────────────────────────────────────────────────────────────────────

export const esquemaEvento = z.discriminatedUnion("tipo", [
  itemCreado,
  itemActualizado,
  itemPrecioCambiado,
  itemCostoCambiado,
  itemDesactivado,
  itemReactivado,
  itemFotoActualizada,
  stockEntrada,
  stockAjustado,
  stockMerma,
  ventaRegistrada,
  ventaAnulada,
  ventaReimpresa,
  ventaPropinaRegistrada,
  cajaTurnoAbierto,
  cajaEgresoRegistrado,
  cajaTurnoCerrado,
  clienteRegistrado,
  clienteActualizado,
  clienteVinculadoFidelidad,
  barberoCreado,
  barberoActualizado,
  barberoDesactivado,
  barberoLiquidado,
  configActualizada,
]);

export type Evento = z.infer<typeof esquemaEvento>;
export type TipoEvento = Evento["tipo"];

/** Un evento tal como lo entrega el dominio, antes de que el almacén lo selle. */
export type EventoNuevo = {
  [T in TipoEvento]: {
    tipo: T;
    v?: number;
    actor?: Actor;
    datos: Extract<Evento, { tipo: T }>["datos"];
  };
}[TipoEvento];

/** Estrecha un evento a un tipo concreto, con los tipos bien puestos. */
export function esDeTipo<T extends TipoEvento>(
  e: Evento,
  tipo: T,
): e is Extract<Evento, { tipo: T }> {
  return e.tipo === tipo;
}

/**
 * Versión actual de cada tipo. El almacén la pone sola si el dominio no la
 * especifica. Subir un número aquí OBLIGA a escribir el upcaster correspondiente.
 *
 * POR QUÉ `item.creado` SIGUE EN 1 después de sumarle marca, costo y precio
 * anulable. Los tres son cambios que un evento viejo sobrevive sin traducción:
 * `marca` y `costo` son opcionales, y `precio` pasó de "número" a "número o
 * null" — todo evento ya escrito trae un número, que sigue siendo válido. No
 * hay nada que un upcaster pudiera hacer: un ítem creado en agosto no tenía
 * marca, y ponerle una sería inventarla. Lo que cambió es qué se puede
 * expresar de hoy en adelante, no qué significa lo ya escrito (regla 4).
 */
export const VERSION_ACTUAL: Record<TipoEvento, number> = {
  "item.creado": 1,
  "item.actualizado": 1,
  "item.precio_cambiado": 1,
  "item.costo_cambiado": 1,
  "item.desactivado": 1,
  "item.reactivado": 1,
  "item.foto_actualizada": 1,
  "stock.entrada": 1,
  "stock.ajustado": 1,
  "stock.merma": 1,
  "venta.registrada": 1,
  "venta.anulada": 1,
  "venta.reimpresa": 1,
  "venta.propina_registrada": 1,
  "caja.turno_abierto": 1,
  "caja.egreso_registrado": 1,
  "caja.turno_cerrado": 1,
  "cliente.registrado": 1,
  "cliente.actualizado": 1,
  "cliente.vinculado_fidelidad": 1,
  "barbero.creado": 1,
  "barbero.actualizado": 1,
  "barbero.desactivado": 1,
  "barbero.liquidado": 1,
  "config.actualizada": 1,
};

/**
 * Reservados: NO están implementados (decisión de alcance), pero el nombre
 * queda apartado para que encenderlos mañana no obligue a cambiar el formato
 * del log.
 *
 * `caja.egreso_registrado` salió de esta lista en la v0.6.0, y
 * `venta.propina_registrada` en la v0.7.0: los dos eran los que más falta
 * hacían y ya están implementados. Reservarlos desde el día 1 fue lo que
 * permitió encenderlos sin tocar nada de lo ya escrito en disco.
 *
 * Nada reservado por ahora.
 */
export const EVENTOS_RESERVADOS = [] as const;
