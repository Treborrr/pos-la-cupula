/**
 * El servicio de aplicación: une el almacén de eventos con la proyección.
 *
 * Su responsabilidad central es una sola y es crítica: garantizar que
 * CONSTRUIR los eventos (leyendo la proyección) y ESCRIBIRLOS ocurra sin que
 * nadie se meta en el medio.
 *
 * Sin eso habría una ventana real: dos cobros simultáneos leen
 * `ultimoCorrelativo = 29`, los dos arman la venta NV000030 y los dos la
 * escriben. El almacén serializa sus propias escrituras, pero para cuando la
 * segunda llega ya venía con el correlativo mal calculado. Es exactamente el
 * bug que tenía el Excel con `=MAX(NotaVenta[ID])+1`, y por eso la sección
 * crítica tiene que abarcar las dos cosas, no solo la escritura.
 */

import { z } from "zod";

import { ACTOR_SISTEMA, type Actor, type EventoNuevo } from "@cupula/contratos";

import type { AlmacenDeEventos } from "../puertos/AlmacenDeEventos";
import { Proyeccion } from "../proyecciones/Proyeccion";
import { ErrorDeNegocio } from "../dominio/errores";
import { registrarVenta, type PedidoDeVenta } from "../dominio/venta/registrar";
import { anularVenta, marcarReimpresion } from "../dominio/venta/anular";
import { sembrarSedePrincipal } from "../dominio/sedes/sedes";
import type { Venta } from "../proyecciones/tipos";

/** Cada cuántos eventos se toma una instantánea, para acotar el arranque. */
const EVENTOS_POR_INSTANTANEA = 5_000;

export const CONFIG_POR_DEFECTO: Record<string, unknown> = {
  /**
   * Los datos del negocio arrancan VACÍOS y se cargan en Ajustes al instalar.
   *
   * Estaban escritos acá con los valores reales del primer cliente —nombre,
   * dirección y RUC— y eso estaba mal por dos razones. La chica: cualquier otra
   * instalación arrancaba imprimiendo tickets con los datos de otro negocio
   * hasta que alguien se diera cuenta. La grande: un RUC peruano que empieza
   * con 10 es de persona natural y lleva el DNI del dueño adentro, así que era
   * un documento de identidad viviendo en el código fuente.
   *
   * La configuración de un negocio es un dato de la instalación, no del
   * programa. Vacío, además, es lo que hace que el asistente de primeros pasos
   * los pida en vez de dejarlos pasar.
   */
  "negocio.nombre": "",
  "negocio.direccion": "",
  "negocio.ciudad": "",
  "negocio.ruc": "",
  "negocio.pie": "¡GRACIAS POR TU VISITA!",

  /**
   * Arranca en 30 para continuar la numeración que el cliente ya vio: el Excel
   * quedó en NV000029. Cambiarlo después de haber emitido ventas no tiene
   * efecto hacia atrás — el correlativo siempre avanza.
   */
  "ventas.correlativoInicial": 30,

  /**
   * En true a pedido explícito del dueño: prefiere que el mostrador no pueda
   * cobrar sin abrir la caja antes, aunque eso signifique un cliente parado
   * esperando un minuto mientras alguien abre el turno. Sigue siendo una
   * variable de configuración — no una regla fija — para la instalación que
   * prefiera la otra prioridad (nunca perder una venta) puede apagarla desde
   * Ajustes. Apagada, las ventas se registran con turno null y el arqueo las
   * reporta aparte.
   */
  "ventas.exigirTurnoAbierto": true,

  /**
   * Cada venta queda a nombre de un cliente: es lo que arma el historial, las
   * visitas y "lo que más pide". En true porque escribir el nombre cuesta dos
   * segundos y sin él la mitad de las pantallas de clientes no sirven de nada.
   */
  "ventas.exigirCliente": true,

  "fidelidad.activo": false,
  "fidelidad.urlApi": "https://api.tarjetacloud.com",

  /**
   * Impresora. Arranca en "vistaPrevia": hasta que alguien configure la
   * ticketera de verdad, el POS no intenta escribir a un dispositivo que no
   * existe ni hace esperar al cajero por un timeout.
   */
  "impresora.modo": "vistaPrevia",
  "impresora.perfil": "advance80",
  "impresora.nombreCompartido": "TICKETERA",
  "impresora.host": "192.168.1.100",
  "impresora.puerto": 9100,
  "impresora.carpeta": "",
  "impresora.conLogo": true,
  /** Cajón de dinero colgado del RJ11 de la impresora. */
  "impresora.abrirCajon": false,
  "impresora.plantilla": null,

  /**
   * Carpeta externa para los respaldos: OneDrive, un USB fijo. Vacío significa
   * que la única copia vive en el mismo disco que los datos — que es
   * exactamente lo que no sirve el día que el disco se quema.
   */
  "respaldos.destinoExterno": "",

  /**
   * Correo del dueño del negocio, para las alertas técnicas, la caja no
   * cuadrada y el reporte de cierre del día. Vacío = todavía no se configuró
   * en esta instalación (arranca vacío por la misma razón que `negocio.ruc`:
   * es un dato de la instalación, no del programa). Sin esto, el servicio de
   * notificaciones simplemente no tiene a quién mandarle nada.
   */
  "negocio.correoDueno": "",

  /**
   * Correo de soporte técnico (el del desarrollador/distribuidor del
   * sistema). Config de la instalación, igual que `negocio.correoDueno` —
   * NO una variable de entorno: así se asigna desde Ajustes como cualquier
   * otro dato, sin que el correo de una persona viva escrito en un lugar
   * aparte (infraestructura) que haya que recordar configurar en cada
   * instalación nueva.
   */
  "negocio.correoDev": "",

  /**
   * Cuántos correos de ALERTAS TÉCNICAS + reporte diario se permiten por día,
   * como máximo. El plan gratis de Resend da 100/día en total
   * (`notificaciones.topeTotalDiario`); este tope más chico reserva cupo para
   * que las alertas nunca se coman el presupuesto que hace falta para mandar
   * recibos de venta por correo.
   */
  "notificaciones.topeAlertasDiario": 10,

  /**
   * Tope total de correos del día, de cualquier tipo (alertas, reporte,
   * recibos de venta). Por defecto el límite del plan gratis de Resend —
   * subirlo acá es lo que hay que tocar el día que se pase a un plan pago.
   */
  "notificaciones.topeTotalDiario": 100,

  /**
   * Lista de IPs/CIDR permitidas para el login de CAJERO, separadas por coma
   * ("181.64.123.45,100.64.0.0/10"). El de ADMIN nunca tiene esta
   * restricción: tiene que poder entrar desde cualquier lado. Vacío = sin
   * restricción — mismo "apagado por defecto, bien visible si nadie lo
   * configuró" que ya usaba el candado único que este sistema tenía antes.
   */
  "seguridad.redesCajero": "",
};

const esquemaCorreo = z.union([z.literal(""), z.string().trim().toLowerCase().email().max(160)]);

/**
 * QUÉ se puede guardar en CADA clave de configuración.
 *
 * Es la lista blanca, y vive al lado de los valores por defecto porque son las
 * dos caras del mismo contrato: lo que el POS sabe leer es exactamente lo que
 * se puede escribir.
 *
 * POR QUÉ NO ALCANZABA CON `z.record(z.string(), z.unknown())` EN LA RUTA. Cada
 * cambio de configuración es un evento en un log APPEND-ONLY con cadena de
 * hash: no hay DELETE, y editar la línea a mano invalida todos los hashes
 * posteriores. Una clave inventada ("x.y") o un valor con el tipo equivocado
 * —`seguridad.redesCajero: 0`, que hace estallar `lista.split()` en CADA
 * pedido de cualquier cajero— se quedaba ahí para siempre: se reaplicaba en
 * cada arranque y viajaba en cada instantánea. Medido: un solo PUT podía dejar
 * 84.259 claves basura en el log. En un log que no se puede limpiar, la
 * validación de entrada no es una comodidad, es la única defensa.
 *
 * `impresora.plantilla` se valida solo como "null o un arreglo acotado de
 * bloques": la PWA nunca la escribe (es config cruda avanzada) y su estructura
 * recursiva tiene muchas formas válidas; lo que de verdad hay que impedir —un
 * anidamiento que desborde la pila al serializar el log— lo corta el tope de
 * profundidad del propio evento (ver `config.actualizada` en el contrato).
 */
export const ESQUEMA_CONFIG: Record<string, z.ZodType> = {
  "negocio.nombre": z.string().max(80),
  "negocio.direccion": z.string().max(120),
  "negocio.ciudad": z.string().max(80),
  "negocio.ruc": z.string().max(20),
  "negocio.pie": z.string().max(200),
  "negocio.correoDueno": esquemaCorreo,
  "negocio.correoDev": esquemaCorreo,

  "ventas.correlativoInicial": z.number().int().min(1).max(999_999),
  "ventas.exigirTurnoAbierto": z.boolean(),
  "ventas.exigirCliente": z.boolean(),

  "fidelidad.activo": z.boolean(),
  "fidelidad.urlApi": z.string().url().max(200),

  "impresora.modo": z.enum(["vistaPrevia", "windows", "red", "archivo"]),
  "impresora.perfil": z.enum(["advance80", "advance58", "generico80", "generico58", "epson80"]),
  "impresora.nombreCompartido": z.string().max(80),
  "impresora.host": z.string().max(120),
  "impresora.puerto": z.number().int().min(1).max(65_535),
  "impresora.carpeta": z.string().max(260),
  "impresora.conLogo": z.boolean(),
  "impresora.abrirCajon": z.boolean(),
  "impresora.plantilla": z.union([z.null(), z.array(z.record(z.string(), z.unknown())).max(200)]),

  "respaldos.destinoExterno": z.string().max(260),

  "notificaciones.topeAlertasDiario": z.number().int().min(0).max(1_000),
  "notificaciones.topeTotalDiario": z.number().int().min(0).max(10_000),

  "seguridad.redesCajero": z.string().max(500),
};

export interface ResultadoCobro {
  venta: Venta;
  advertencias: string[];
  /** true si este pedido ya se había cobrado y se devolvió el mismo. */
  duplicada: boolean;
}

export class ServicioPos {
  private cola: Promise<unknown> = Promise.resolve();
  private eventosDesdeInstantanea = 0;

  private constructor(
    readonly almacen: AlmacenDeEventos,
    readonly p: Proyeccion,
  ) {}

  /**
   * Reconstruye el estado: instantánea más reciente + los eventos posteriores.
   * Un año de operación de esta barbería reproduce en menos de un segundo.
   */
  static async abrir(almacen: AlmacenDeEventos): Promise<ServicioPos> {
    let proyeccion: Proyeccion | null = null;

    const instantanea = await almacen.cargarInstantanea();
    if (instantanea) {
      // Devuelve null si la instantánea es de otro formato. Entonces se
      // reconstruye desde el log, que nunca queda desactualizado.
      proyeccion = Proyeccion.hidratar(instantanea.estado);
    }
    if (!proyeccion) proyeccion = new Proyeccion();

    for await (const evento of almacen.leer({ desdeSeq: proyeccion.seq })) {
      proyeccion.aplicar(evento);
    }

    const servicio = new ServicioPos(almacen, proyeccion);

    /**
     * Si el log no trae ninguna sucursal, es una instalación anterior a
     * multisucursal (o una recién nacida): se siembra la principal con los
     * datos de `negocio.*`, que es exactamente lo que describían cuando había
     * un solo local.
     *
     * Va acá y no en una migración aparte porque tiene que pasar UNA vez y
     * antes de que nadie pueda cobrar: una venta sin sucursal a la que
     * pertenecer no se puede registrar. Al quedar escrito como evento, la
     * segunda vez que arranque ya la encuentra y no hace nada.
     */
    if (proyeccion.sedes.size === 0) {
      await servicio.escribir(() => [
        sembrarSedePrincipal({
          nombre: servicio.config<string>("negocio.nombre"),
          direccion: servicio.config<string>("negocio.direccion"),
          ciudad: servicio.config<string>("negocio.ciudad"),
          pie: servicio.config<string>("negocio.pie"),
        }),
      ]);
    }

    return servicio;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sección crítica
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Corre `fn` en exclusión mutua con cualquier otra transacción. `fn` lee la
   * proyección y devuelve los eventos a escribir; aquí se escriben y se
   * aplican. Nadie ve un estado intermedio.
   *
   * `actor` identifica a quién hacer responsable de estos eventos en el log.
   * Opcional y no al revés —a propósito—: exigirlo en todos lados habría
   * obligado a tocar cada prueba existente que llama `transaccion`/`escribir`
   * solo para armar su estado inicial. La única ruta que de verdad NO puede
   * olvidarse de pasarlo es la HTTP, y esa la cubre
   * `herramientas/verificar-actor.mjs`, no el tipo. Sin `actor`, el evento
   * queda a nombre de `ACTOR_SISTEMA` — nunca del viejo "mostrador" genérico.
   */
  async transaccion<T>(fn: () => { eventos: EventoNuevo[]; resultado: T }, actor?: Actor): Promise<T> {
    const corrida = this.cola.then(
      () => this.correr(fn, actor),
      () => this.correr(fn, actor),
    );
    // La cola no muere si una transacción falla: un error de validación no
    // puede dejar el POS trabado hasta que alguien lo reinicie.
    this.cola = corrida.then(
      () => undefined,
      () => undefined,
    );
    return corrida;
  }

  private async correr<T>(fn: () => { eventos: EventoNuevo[]; resultado: T }, actor?: Actor): Promise<T> {
    const { eventos, resultado } = fn();
    if (eventos.length === 0) return resultado;

    // Un evento que ya trae su propio `actor` (poco común, pero el tipo lo
    // permite) no se pisa.
    const conActor = eventos.map((e) => (e.actor ? e : { ...e, actor: actor ?? ACTOR_SISTEMA }));
    const escritos = await this.almacen.agregar(conActor);

    // Recién aquí la proyección se entera. Si `agregar` falla, el estado en
    // memoria queda igual que el disco: coherentes, aunque la operación se
    // haya perdido.
    for (const evento of escritos) this.p.aplicar(evento);

    this.eventosDesdeInstantanea += escritos.length;
    if (this.eventosDesdeInstantanea >= EVENTOS_POR_INSTANTANEA) {
      this.eventosDesdeInstantanea = 0;
      // Sin await: que el cobro no espere a que se escriba la instantánea.
      // Si falla, no pasa nada grave — se reconstruye desde el log.
      void this.almacen
        .guardarInstantanea(this.p.seq, this.p.serializar())
        .catch(() => undefined);
    }

    return resultado;
  }

  /** Atajo para operaciones que solo escriben y no devuelven nada útil. */
  async escribir(construir: () => EventoNuevo[], actor?: Actor): Promise<void> {
    await this.transaccion(() => ({ eventos: construir(), resultado: undefined }), actor);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Configuración
  // ───────────────────────────────────────────────────────────────────────────

  config<T = unknown>(clave: string): T {
    return (this.p.config.has(clave) ? this.p.config.get(clave) : CONFIG_POR_DEFECTO[clave]) as T;
  }

  configCompleta(): Record<string, unknown> {
    return { ...CONFIG_POR_DEFECTO, ...Object.fromEntries(this.p.config) };
  }

  async guardarConfig(clave: string, valor: unknown, actor?: Actor): Promise<void> {
    await this.guardarConfigs([[clave, valor]], actor);
  }

  /**
   * Varias claves en UN SOLO lote, y validadas TODAS antes de escribir NINGUNA.
   *
   * Lo primero (validar) es lo que frena el ataque: la primera clave fuera de
   * la lista blanca, o con el tipo equivocado, corta el lote entero antes de
   * tocar el disco, así que nada basura entra al log inmutable.
   *
   * Lo segundo (un solo lote) es por rendimiento y por coherencia: la cola de
   * `transaccion()` es la MISMA por la que pasan los cobros. Guardar 20 claves
   * de a una eran 20 `fsync` y 20 turnos en esa cola con el mostrador
   * esperando; un cuerpo de 1 MB con claves sueltas llegaba a bloquearla
   * minutos. Además, o entran todas o no entra ninguna.
   */
  async guardarConfigs(cambios: [string, unknown][], actor?: Actor): Promise<void> {
    const eventos: EventoNuevo[] = cambios.map(([clave, crudo]) => {
      const esquema = ESQUEMA_CONFIG[clave];
      if (!esquema) {
        throw new ErrorDeNegocio(
          "DATO_INVALIDO",
          `"${clave}" no es una opción de configuración de este sistema.`,
          "Revisa el nombre. Las opciones válidas son las que muestra Ajustes.",
        );
      }

      const revisado = esquema.safeParse(crudo);
      if (!revisado.success) {
        throw new ErrorDeNegocio(
          "DATO_INVALIDO",
          `El valor de "${clave}" no sirve: ${revisado.error.issues[0].message}`,
          "Corrígelo e intenta de nuevo.",
        );
      }

      // Se guarda el valor NORMALIZADO por el esquema (correos en minúscula,
      // textos sin espacios al borde), no el crudo: lo que queda en el log es
      // exactamente lo que el sistema va a leer.
      return { tipo: "config.actualizada", datos: { clave, valor: revisado.data } };
    });

    await this.escribir(() => eventos, actor);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cobrar
  // ───────────────────────────────────────────────────────────────────────────

  async cobrar(sedeId: string, pedido: PedidoDeVenta, actor?: Actor): Promise<ResultadoCobro> {
    const { ventaId, advertencias, duplicada } = await this.transaccion(() => {
      // La idempotencia se revisa DENTRO de la sección crítica. Si se revisara
      // fuera, dos envíos simultáneos del mismo pedido pasarían los dos el
      // control y cobrarían dos veces — que es justo lo que esto evita.
      const yaCobrada = this.p.porIdempotencia.get(pedido.claveIdempotencia);
      if (yaCobrada) {
        return {
          eventos: [],
          resultado: { ventaId: yaCobrada, advertencias: [] as string[], duplicada: true },
        };
      }

      if (this.config<boolean>("ventas.exigirTurnoAbierto") && !this.p.turnoAbiertoDe(sedeId)) {
        throw new ErrorDeNegocio(
          "TURNO_NO_ABIERTO",
          "La caja está cerrada.",
          "Abre el turno desde la pantalla de Caja para poder cobrar.",
        );
      }

      if (pedido.clienteId && !this.p.clientes.has(pedido.clienteId)) {
        throw new ErrorDeNegocio("CLIENTE_NO_EXISTE", "El cliente elegido no existe.", "Vuelve a escribir su nombre.");
      }
      if (this.config<boolean>("ventas.exigirCliente") !== false && !pedido.clienteId) {
        throw new ErrorDeNegocio(
          "CLIENTE_REQUERIDO",
          "Falta el nombre del cliente.",
          "Escríbelo o elígelo en la venta antes de cobrar.",
        );
      }

      const preparada = registrarVenta(this.p, sedeId, pedido, {
        correlativoInicial: this.config<number>("ventas.correlativoInicial") ?? 1,
      });

      return {
        eventos: preparada.eventos,
        resultado: {
          ventaId: preparada.ventaId,
          advertencias: preparada.advertencias,
          duplicada: false,
        },
      };
    }, actor);

    // Ya escrita y aplicada: la venta existe en la proyección.
    return { venta: this.p.ventas.get(ventaId)!, advertencias, duplicada };
  }

  async anular(ventaId: string, motivo: string, actor?: Actor): Promise<Venta> {
    await this.escribir(() => anularVenta(this.p, ventaId, motivo), actor);
    return this.p.ventas.get(ventaId)!;
  }

  async registrarReimpresion(ventaId: string, actor?: Actor): Promise<void> {
    await this.escribir(() => marcarReimpresion(this.p, ventaId), actor);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mantenimiento
  // ───────────────────────────────────────────────────────────────────────────

  /** Fuerza una instantánea. Se usa al cerrar caja y al apagar. */
  async instantanea(): Promise<void> {
    this.eventosDesdeInstantanea = 0;
    await this.almacen.guardarInstantanea(this.p.seq, this.p.serializar());
  }

  async cerrar(): Promise<void> {
    await this.cola.catch(() => undefined);
    await this.instantanea().catch(() => undefined);
    await this.almacen.cerrar();
  }
}
