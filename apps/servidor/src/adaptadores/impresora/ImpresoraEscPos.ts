/**
 * La impresora de verdad: arma el ticket y lo manda por el cable.
 *
 * El transporte está separado del renderizado a propósito. `renderTicket`
 * produce bytes y no sabe a dónde van; aquí se decide si esos bytes salen por
 * el spooler de Windows, por un socket TCP o a un archivo. Cambiar de
 * impresora de USB a red es cambiar una línea de configuración.
 *
 * NADA DE MÓDULOS NATIVOS. `node-thermal-printer` y compañía arrastran
 * `node-gyp`, y compilar código nativo en la PC de una barbería —sin Visual
 * Studio Build Tools, con 4 GB de RAM— es una tarde perdida y un problema
 * recurrente en cada actualización. Los tres transportes de aquí usan solo la
 * biblioteca estándar de Node.
 */

import { createWriteStream } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { connect } from "node:net";
import * as path from "node:path";
import { once } from "node:events";

import type {
  DatosDelNegocio,
  EstadoImpresora,
  Impresora,
  OpcionesDeImpresion,
  ResultadoImpresion,
} from "../../puertos/Impresora";
import type { Venta } from "../../proyecciones/tipos";
import type { PerfilImpresora } from "./perfil";
import type { BloqueTicket } from "./plantilla";
import { renderTicketEscPos, renderTicketTexto } from "./renderTicket";
import { buscarImpresoraWindows, imprimirRawEnWindows, impresorasWindowsCacheadas } from "./windows";

export type Transporte =
  /**
   * Windows: se le manda a la cola de impresión. `nombreCompartido` es el
   * nombre de la impresora instalada —o el del recurso compartido, si alguien
   * la compartió a la vieja usanza—; los dos funcionan.
   */
  | { tipo: "windows"; nombreCompartido: string }
  /** Impresora de red o con adaptador Ethernet. Puerto 9100 es el estándar. */
  | { tipo: "red"; host: string; puerto?: number }
  /** A un archivo. Para depurar el ticket sin gastar papel. */
  | { tipo: "archivo"; carpeta: string };

export interface OpcionesImpresoraEscPos {
  transporte: Transporte;
  perfil: PerfilImpresora;
  plantilla?: BloqueTicket[];
  conLogo?: boolean;
  /** Milisegundos antes de darse por vencido con la impresora. */
  tiempoLimite?: number;
}

export class ImpresoraEscPos implements Impresora {
  constructor(private opciones: OpcionesImpresoraEscPos) {}

  /**
   * Enciende el pulso de apertura del cajón de dinero, que viaja en el mismo
   * chorro de bytes del ticket (el cajón cuelga del RJ11 de la impresora).
   */
  conCajon(activo: boolean): this {
    if (activo) {
      this.opciones = { ...this.opciones, perfil: { ...this.opciones.perfil, cajonDeDinero: true } };
    }
    return this;
  }

  async estado(): Promise<EstadoImpresora> {
    const t = this.opciones.transporte;

    // ESC/POS es en una sola dirección: se le manda y no contesta. Con la
    // mayoría de los equipos USB no hay forma de preguntar "¿tienes papel?"
    // sin un canal de vuelta, así que lo honesto es reportar a qué se está
    // apuntando, no inventar un "todo bien".
    if (t.tipo === "red") {
      const alcanzable = await this.probarRed(t.host, t.puerto ?? 9100);
      return {
        disponible: alcanzable,
        descripcion: `${this.opciones.perfil.nombre} en ${t.host}:${t.puerto ?? 9100}`,
        detalle: alcanzable
          ? "La impresora responde en la red."
          : "No responde. Revisa que esté encendida y en la misma red.",
      };
    }

    if (t.tipo === "windows") {
      const descripcion = `${this.opciones.perfil.nombre} por USB: "${t.nombreCompartido}"`;

      // La lista viene del caché: consultarla cuesta ~1 s de PowerShell y esto
      // se llama en cada pantalla. La primera vez todavía no hay nada, y ahí lo
      // honesto es no afirmar que falla.
      const lista = impresorasWindowsCacheadas();
      if (!lista) {
        return { disponible: true, descripcion, detalle: "Se manda directo a la cola de impresión de Windows." };
      }

      const encontrada = buscarImpresoraWindows(lista, t.nombreCompartido);
      if (!encontrada) {
        return {
          disponible: false,
          descripcion,
          detalle:
            `Windows no tiene ninguna impresora llamada "${t.nombreCompartido}". ` +
            "Elige la ADV-8010N de la lista de impresoras detectadas.",
        };
      }
      if (encontrada.desconectada) {
        return {
          disponible: false,
          descripcion,
          detalle: "Windows la marca como desconectada. Revisa que esté encendida y que el cable USB esté bien puesto.",
        };
      }
      return {
        disponible: true,
        descripcion,
        detalle: `Instalada en Windows (${encontrada.controlador || "sin controlador"}, puerto ${encontrada.puerto || "?"}).`,
      };
    }

    return {
      disponible: true,
      descripcion: `Modo archivo (${t.carpeta})`,
      detalle: "Los tickets se guardan como archivos .bin en vez de imprimirse.",
    };
  }

  async imprimirVenta(
    venta: Venta,
    negocio: DatosDelNegocio,
    extra: OpcionesDeImpresion = {},
  ): Promise<ResultadoImpresion> {
    const comoRender = {
      perfil: this.opciones.perfil,
      plantilla: this.opciones.plantilla,
      conLogo: this.opciones.conLogo,
    };

    // La vista previa se arma SIEMPRE, salga o no el papel: si la impresora
    // falla, el cajero igual tiene que poder ver qué decía el ticket. Sale del
    // mismo recorrido que los bytes, así que no pueden decir cosas distintas.
    const vistaPrevia = await renderTicketTexto(venta, negocio, comoRender, extra);

    let bytes: Buffer;
    try {
      // El cajón se abre al cobrar en efectivo y nada más: no en una
      // reimpresión (si no, cualquiera lo abre reimprimiendo un ticket viejo)
      // ni en una venta anulada.
      const abrirCajon =
        !extra.reimpresion && !venta.anulada && venta.pagos.some((p) => p.medio === "EFECTIVO");
      bytes = await renderTicketEscPos(venta, negocio, comoRender, { ...extra, abrirCajon });
    } catch (e) {
      return {
        impreso: false,
        vistaPrevia,
        motivo: `No se pudo armar el ticket: ${mensaje(e)}`,
      };
    }

    try {
      await this.enviar(bytes, venta.correlativo);
      return { impreso: true, vistaPrevia };
    } catch (e) {
      return { impreso: false, vistaPrevia, motivo: mensaje(e) };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async enviar(bytes: Buffer, referencia: string): Promise<void> {
    const t = this.opciones.transporte;
    const limite = this.opciones.tiempoLimite ?? 8_000;

    if (t.tipo === "archivo") {
      await mkdir(t.carpeta, { recursive: true });
      await writeFile(path.join(t.carpeta, `${referencia}.bin`), bytes);
      return;
    }

    if (t.tipo === "windows") {
      // Más holgado que el resto: la primera impresión del día levanta el
      // spooler y compila el fragmento de C#, y eso puede tardar varios
      // segundos en una PC vieja.
      await conLimite(
        this.escribirAlSpooler(t.nombreCompartido, bytes, referencia),
        Math.max(limite, 25_000),
        "la impresora",
      );
      return;
    }

    await conLimite(this.escribirPorRed(t.host, t.puerto ?? 9100, bytes), limite, "la impresora de red");
  }

  /**
   * Primero el recurso compartido, que es instantáneo cuando existe; si no
   * está compartida —lo normal—, se cae al spooler por PowerShell, que funciona
   * con la impresora simplemente instalada.
   */
  private async escribirAlSpooler(nombre: string, bytes: Buffer, referencia = "Ticket"): Promise<void> {
    try {
      await this.escribirAlCompartido(nombre, bytes);
    } catch (e) {
      if (process.platform !== "win32") throw e;
      await imprimirRawEnWindows(nombre, bytes, `POS La Cupula ${referencia}`);
    }
  }

  private async escribirAlCompartido(nombreCompartido: string, bytes: Buffer): Promise<void> {
    // Un nombre de impresora instalada trae dos puntos o barras y no es un
    // recurso compartido válido: se descarta acá para caer al camino de
    // PowerShell sin esperar el error del sistema de archivos.
    if (/[\\/:*?"<>|]/.test(nombreCompartido)) throw new Error("No es un nombre de recurso compartido.");

    const ruta = `\\\\localhost\\${nombreCompartido}`;
    const flujo = createWriteStream(ruta);

    try {
      await once(flujo, "open");
      await new Promise<void>((resolver, rechazar) => {
        flujo.write(bytes, (error) => (error ? rechazar(error) : resolver()));
      });
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        throw new Error(
          `No se encontró la impresora compartida "${nombreCompartido}". ` +
            `Compártela desde Panel de control → Dispositivos e impresoras, con ese nombre exacto.`,
        );
      }
      throw e;
    } finally {
      flujo.end();
    }
  }

  private escribirPorRed(host: string, puerto: number, bytes: Buffer): Promise<void> {
    return new Promise((resolver, rechazar) => {
      const socket = connect({ host, port: puerto }, () => {
        socket.write(bytes, () => socket.end());
      });
      // Una impresora de red que acepta la conexión y después se cuelga dejaría
      // el socket abierto para siempre; `conLimite` cubre el caso general, esto
      // corta el socket de verdad en vez de dejarlo huérfano.
      socket.setTimeout(15_000, () => socket.destroy(new Error("La impresora de red dejó de responder.")));
      socket.on("error", rechazar);
      socket.on("close", () => resolver());
    });
  }

  private probarRed(host: string, puerto: number): Promise<boolean> {
    return new Promise((resolver) => {
      const socket = connect({ host, port: puerto });
      const terminar = (ok: boolean) => {
        socket.destroy();
        resolver(ok);
      };
      socket.setTimeout(1_500, () => terminar(false));
      socket.on("connect", () => terminar(true));
      socket.on("error", () => terminar(false));
    });
  }
}

/**
 * Un límite de tiempo sobre la impresión, y es importante: una impresora
 * apagada o sin papel puede dejar la escritura colgada para siempre. La venta
 * YA está guardada en disco para cuando se llega aquí, así que rendirse rápido
 * y avisar es mejor que bloquear la caja esperando un papel que no va a salir.
 */
function conLimite<T>(promesa: Promise<T>, ms: number, quien: string): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((_, rechazar) =>
      setTimeout(
        () => rechazar(new Error(`${quien} no respondió en ${ms / 1000} segundos.`)),
        ms,
      ),
    ),
  ]);
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
