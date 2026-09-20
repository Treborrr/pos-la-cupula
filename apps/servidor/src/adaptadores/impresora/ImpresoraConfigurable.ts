/**
 * La impresora que usa el POS: decide en cada llamada qué adaptador concreto
 * usar, leyendo la configuración vigente.
 *
 * Por qué resolver el adaptador en cada impresión y no una sola vez al
 * arrancar: la configuración de la impresora vive en el log de eventos y se
 * cambia desde Ajustes. Si el adaptador se construyera al inicio, cambiar de
 * "vista previa" a "Windows" —o corregir el nombre de la impresora
 * compartida— obligaría a reiniciar el servicio. En una barbería, eso
 * significa llamar a alguien.
 *
 * Construir el adaptador no cuesta nada: son objetos sin estado que abren la
 * conexión en el momento de imprimir y la cierran enseguida.
 */

import type {
  DatosDelNegocio,
  EstadoImpresora,
  Impresora,
  OpcionesDeImpresion,
  ResultadoImpresion,
} from "../../puertos/Impresora";
import { ImpresoraVistaPrevia } from "./ImpresoraVistaPrevia";
import type { Venta } from "../../proyecciones/tipos";
import { ImpresoraEscPos, type Transporte } from "./ImpresoraEscPos";
import { perfilPorNombre } from "./perfil";
import type { BloqueTicket } from "./plantilla";
import { relojDelSistema } from "../../puertos/Reloj";

/** Lo que el POS sabe leer de la configuración para armar la impresora. */
export interface ConfigDeImpresora {
  /** Fuente de los valores. Se consulta en cada impresión. */
  leer<T>(clave: string): T;
}

export class ImpresoraConfigurable implements Impresora {
  constructor(
    private readonly config: ConfigDeImpresora,
    /** Carpeta donde caen los .bin en modo archivo. */
    private readonly carpetaPorDefecto: string,
  ) {}

  private resolver(): Impresora {
    const modo = this.config.leer<string>("impresora.modo") ?? "vistaPrevia";
    const perfil = perfilPorNombre(this.config.leer<string>("impresora.perfil"));
    const plantilla = this.config.leer<BloqueTicket[] | null>("impresora.plantilla") ?? undefined;

    // La vista previa se arma con el MISMO perfil y la MISMA plantilla que la
    // impresión real. Sin esto caía al genérico de 42 columnas con la plantilla
    // por defecto, así que lo que se veía en pantalla no era lo que salía en
    // papel —la Advance imprime a 48— y editar la plantilla no se podía
    // previsualizar, que es justo para lo que existe esta clase.
    if (modo === "vistaPrevia") return new ImpresoraVistaPrevia(perfil, plantilla);

    const transporte = this.transporte(modo);
    if (!transporte) return new ImpresoraVistaPrevia(perfil, plantilla);

    return new ImpresoraEscPos({
      transporte,
      perfil,
      plantilla,
      conLogo: this.config.leer<boolean>("impresora.conLogo") !== false,
    }).conCajon(this.config.leer<boolean>("impresora.abrirCajon") === true);
  }

  private transporte(modo: string): Transporte | null {
    if (modo === "windows") {
      return {
        tipo: "windows",
        nombreCompartido: this.config.leer<string>("impresora.nombreCompartido") ?? "TICKETERA",
      };
    }
    if (modo === "red") {
      return {
        tipo: "red",
        host: this.config.leer<string>("impresora.host"),
        puerto: Number(this.config.leer<number>("impresora.puerto")) || 9100,
      };
    }
    if (modo === "archivo") {
      return {
        tipo: "archivo",
        carpeta: this.config.leer<string>("impresora.carpeta") || this.carpetaPorDefecto,
      };
    }
    return null;
  }

  estado(): Promise<EstadoImpresora> {
    return this.resolver().estado();
  }

  imprimirVenta(
    venta: Venta,
    negocio: DatosDelNegocio,
    opciones?: OpcionesDeImpresion,
  ): Promise<ResultadoImpresion> {
    return this.resolver().imprimirVenta(venta, negocio, opciones);
  }
}

/**
 * Venta de mentira para la prueba de impresión.
 *
 * Existe para poder verificar la ticketera SIN cobrarle a nadie: el día que
 * llegue la impresora, esto es lo primero que se corre. Lleva a propósito
 * tildes, una eñe, una descripción larga, dos medios de pago y un descuento,
 * porque son justo los casos donde algo suele salir mal.
 *
 * `columnas` es el ancho del perfil elegido: con él se imprime una regla de
 * números de ese largo exacto. Si la regla entra en UNA línea, el perfil
 * coincide con la impresora; si se parte en dos, hay que elegir otro. Es la
 * única forma de verificar las columnas sin tener la máquina delante.
 */
export function ventaDePrueba(columnas = 48): Venta {
  return {
    id: "01PRUEBA0000000000000000AA",
    correlativo: "NV000000",
    // Del reloj del sistema, con el offset de Lima ya puesto: el ticket de
    // prueba también sirve para ver si la PC tiene la hora bien.
    ts: relojDelSistema.ahora(),
    lineas: [
      {
        itemId: "01PRUEBA0000000000000000B1",
        codigo: "PRUEBA",
        nombre: "PRUEBA DE IMPRESIÓN — ÁÉÍÓÚ ñÑ ¿¡",
        tipo: "SERVICIO",
        cantidad: 1,
        precioUnitario: 1000,
        precioLista: 1000,
        barberoId: null,
        total: 1000,
      },
      {
        itemId: "01PRUEBA0000000000000000B2",
        codigo: "LARGO",
        nombre: "DESCRIPCION MUY LARGA PARA VERIFICAR QUE EL TEXTO SE PARTE EN VARIAS LINEAS Y NO SE CORTA",
        tipo: "SERVICIO",
        cantidad: 2,
        precioUnitario: 500,
        precioLista: 500,
        barberoId: null,
        total: 1000,
      },
      {
        itemId: "01PRUEBA0000000000000000B3",
        codigo: "REGLA",
        nombre: "1234567890".repeat(8).slice(0, columnas),
        tipo: "SERVICIO",
        cantidad: 1,
        precioUnitario: 0,
        precioLista: 0,
        barberoId: null,
        total: 0,
      },
    ],
    subtotal: 2000,
    descuento: 500,
    total: 1500,
    pagos: [
      { medio: "EFECTIVO", monto: 1000, recibido: 2000, vuelto: 1000 },
      { medio: "YAPE", monto: 500 },
    ],
    clienteId: null,
    turnoId: null,
    anulada: false,
    reimpresiones: 0,
  };
}
