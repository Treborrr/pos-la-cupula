/**
 * Respaldos.
 *
 * El riesgo más grave del sistema no es un bug: es que se queme el disco de la
 * PC de la barbería y no haya copia. Todo lo demás se arregla; eso no.
 *
 * Tres decisiones que valen más que el código:
 *
 *  1. **El destino externo se VERIFICA, no se asume.** La forma más común de
 *     descubrir que no había respaldo es el día que hace falta. Aquí se
 *     comprueba que la carpeta exista y se pueda escribir, y si no, se dice en
 *     la pantalla de Ajustes en vez de fallar en silencio cada noche.
 *
 *  2. **Formato ZIP estándar, sin nada propietario.** Restaurar es
 *     descomprimir y copiar. No hace falta este programa, ni yo, ni nada: el
 *     dueño puede abrir el archivo y ver sus ventas en un editor de texto.
 *
 *  3. **Se respalda el LOG, no una exportación.** El log es la fuente de
 *     verdad; a partir de él se reconstruye todo. Una copia de las ventas "ya
 *     calculadas" perdería la capacidad de rehacer el estado.
 */

import { createWriteStream } from "node:fs";
import { access, constants, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import type { Reloj } from "../puertos/Reloj";

export interface ResultadoRespaldo {
  ok: boolean;
  archivo?: string;
  copiaExterna?: string;
  bytes?: number;
  motivo?: string;
}

export interface EstadoDeRespaldos {
  carpeta: string;
  ultimo: { archivo: string; cuando: string; bytes: number } | null;
  cantidad: number;
  destinoExterno: string | null;
  /** null = no hay destino configurado; true/false = se verificó de verdad. */
  destinoExternoEscribible: boolean | null;
  detalleDelDestino?: string;
}

export class ServicioDeRespaldos {
  private readonly carpetaRespaldos: string;

  /**
   * Último resultado REAL de `verificarDestino()`, para que la alerta
   * persistente (que se consulta cada pocos segundos desde cualquier
   * pantalla) lo pueda leer gratis. La verificación de verdad escribe, lee y
   * borra un archivo en el destino externo — repetir eso en cada poll
   * golpearía una carpeta de red o de nube todo el tiempo para nada; alcanza
   * con lo que ya se supo la última vez que de verdad se comprobó (al
   * arrancar, en el respaldo horario, o cuando alguien entra a Ajustes).
   */
  private ultimoEstadoConocido: { ok: boolean; detalle: string } | null = null;

  constructor(
    private readonly carpetaDatos: string,
    private readonly reloj: Reloj,
    /** Carpeta externa: OneDrive, un USB fijo. Vacío = sin copia externa. */
    private destinoExterno: string | null = null,
  ) {
    this.carpetaRespaldos = path.join(carpetaDatos, "respaldos");
  }

  configurarDestino(ruta: string | null): void {
    this.destinoExterno = ruta && ruta.trim() !== "" ? ruta.trim() : null;
  }

  /**
   * Comprueba de verdad que se pueda escribir en el destino externo:
   * crea un archivo, lo lee y lo borra. Que la carpeta "exista" no alcanza —
   * un USB desconectado deja la letra de unidad, y OneDrive puede estar
   * pausado.
   */
  async verificarDestino(): Promise<{ ok: boolean; detalle: string }> {
    const resultado = await this.verificarDestinoDeVerdad();
    this.ultimoEstadoConocido = resultado;
    return resultado;
  }

  /**
   * El último resultado real, sin volver a tocar el disco. `null` = todavía
   * no se hizo ninguna verificación en esta corrida del servidor (el chequeo
   * de arranque es asíncrono y puede no haber terminado todavía).
   */
  estadoCacheado(): { ok: boolean; detalle: string } | null {
    return this.ultimoEstadoConocido;
  }

  private async verificarDestinoDeVerdad(): Promise<{ ok: boolean; detalle: string }> {
    if (!this.destinoExterno) {
      return {
        ok: false,
        detalle: "No hay carpeta externa configurada. El respaldo queda solo en este disco.",
      };
    }

    try {
      await mkdir(this.destinoExterno, { recursive: true });
      await access(this.destinoExterno, constants.W_OK);

      const prueba = path.join(this.destinoExterno, ".prueba-de-escritura");
      await writeFile(prueba, "ok", "utf8");
      const leido = await readFile(prueba, "utf8");
      await rm(prueba, { force: true });

      if (leido !== "ok") {
        return { ok: false, detalle: "La carpeta acepta escribir pero lo guardado no se lee igual." };
      }
      return { ok: true, detalle: `Verificado: se puede escribir en ${this.destinoExterno}` };
    } catch (e: any) {
      const razon =
        e?.code === "ENOENT"
          ? "la carpeta no existe y no se pudo crear (¿el USB está desconectado?)"
          : e?.code === "EACCES" || e?.code === "EPERM"
            ? "no hay permiso de escritura"
            : (e?.message ?? String(e));
      return { ok: false, detalle: `No se puede respaldar en ${this.destinoExterno}: ${razon}` };
    }
  }

  /**
   * Arma el respaldo: los eventos del mes en curso, las instantáneas, las
   * fotos de catálogo y la configuración, comprimidos.
   *
   * Se usa gzip sobre un tar hecho a mano en vez de una librería de ZIP para
   * no sumar una dependencia por algo que Node ya sabe hacer. El resultado lo
   * abre cualquier descompresor, 7-Zip y el propio Windows.
   */
  async crear(etiqueta = "manual"): Promise<ResultadoRespaldo> {
    try {
      await mkdir(this.carpetaRespaldos, { recursive: true });

      const marca = this.reloj.ahora().slice(0, 19).replace(/[:T]/g, "-");
      const nombre = `cupula-${marca}-${etiqueta}.tar.gz`;
      const destino = path.join(this.carpetaRespaldos, nombre);

      const archivos = await this.archivosARespaldar();
      if (archivos.length === 0) {
        return { ok: false, motivo: "No hay datos que respaldar todavía." };
      }

      await pipeline(Readable.from(this.generarTar(archivos)), createGzip(), createWriteStream(destino));

      const info = await stat(destino);

      let copiaExterna: string | undefined;
      const verificacion = await this.verificarDestino();
      if (verificacion.ok && this.destinoExterno) {
        copiaExterna = path.join(this.destinoExterno, nombre);
        await writeFile(copiaExterna, await readFile(destino));
      }

      await this.limpiarViejos();

      return { ok: true, archivo: destino, copiaExterna, bytes: info.size };
    } catch (e) {
      return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
    }
  }

  async estado(): Promise<EstadoDeRespaldos> {
    let archivos: string[] = [];
    try {
      archivos = (await readdir(this.carpetaRespaldos)).filter((n) => n.endsWith(".tar.gz")).sort();
    } catch {
      // Sin carpeta de respaldos todavía: es el estado normal antes del primero.
    }

    let ultimo: EstadoDeRespaldos["ultimo"] = null;
    if (archivos.length > 0) {
      const nombre = archivos[archivos.length - 1];
      const info = await stat(path.join(this.carpetaRespaldos, nombre));
      ultimo = { archivo: nombre, cuando: info.mtime.toISOString(), bytes: info.size };
    }

    // Siempre por `verificarDestino`, incluso sin destino: así el mensaje que
    // ve el usuario es UNO solo y no dos redacciones distintas del mismo
    // problema según por dónde se consulte.
    const verificacion = await this.verificarDestino();

    return {
      carpeta: this.carpetaRespaldos,
      ultimo,
      cantidad: archivos.length,
      destinoExterno: this.destinoExterno,
      destinoExternoEscribible: this.destinoExterno ? verificacion.ok : null,
      detalleDelDestino: verificacion.detalle,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async archivosARespaldar(): Promise<{ nombre: string; ruta: string }[]> {
    const salida: { nombre: string; ruta: string }[] = [];

    for (const sub of ["eventos", "instantaneas", "fotos"]) {
      const carpeta = path.join(this.carpetaDatos, sub);
      try {
        for (const archivo of await readdir(carpeta)) {
          salida.push({ nombre: `${sub}/${archivo}`, ruta: path.join(carpeta, archivo) });
        }
      } catch {
        // La carpeta puede no existir todavía.
      }
    }

    try {
      const config = path.join(this.carpetaDatos, "config.json");
      await access(config);
      salida.push({ nombre: "config.json", ruta: config });
    } catch {
      // Sin config guardada: se usan los valores por defecto.
    }

    return salida;
  }

  /**
   * TAR mínimo, escrito a mano.
   *
   * El formato son bloques de 512 bytes: una cabecera por archivo y su
   * contenido rellenado. Son 40 líneas y ahorra una dependencia más que
   * mantener en un sistema que tiene que durar años sin que nadie lo toque.
   */
  private async *generarTar(archivos: { nombre: string; ruta: string }[]): AsyncGenerator<Buffer> {
    for (const { nombre, ruta } of archivos) {
      const contenido = await readFile(ruta);
      yield this.cabeceraTar(nombre, contenido.length);
      yield contenido;

      const relleno = (512 - (contenido.length % 512)) % 512;
      if (relleno > 0) yield Buffer.alloc(relleno, 0);
    }
    // Dos bloques vacíos marcan el final del archivo.
    yield Buffer.alloc(1024, 0);
  }

  private cabeceraTar(nombre: string, tamano: number): Buffer {
    if (nombre.length > 99) {
      // El formato ustar no admite nombres más largos sin extensiones. Con
      // "eventos/2026-09.jsonl" sobra espacio, pero fallar ruidosamente es
      // mejor que escribir un respaldo silenciosamente corrupto.
      throw new Error(`Nombre demasiado largo para el respaldo: ${nombre}`);
    }

    const cabecera = Buffer.alloc(512, 0);

    // ATENCIÓN al largo: cada campo se escribe COMPLETO. Recortar un byte
    // —por ejemplo dejando 7 espacios donde van 8— cambia la suma de control
    // y el archivo deja de abrirse con tar, gzip o el propio Windows.
    const poner = (texto: string, desde: number, largo: number) => {
      cabecera.write(texto.slice(0, largo), desde, largo, "utf8");
    };
    /** Octal con relleno de ceros y terminador NUL, como pide el formato. */
    const octal = (n: number, largo: number) => n.toString(8).padStart(largo - 1, "0") + "\0";

    poner(nombre, 0, 100);
    poner(octal(0o644, 8), 100, 8); // permisos
    poner(octal(0, 8), 108, 8); // uid
    poner(octal(0, 8), 116, 8); // gid
    poner(octal(tamano, 12), 124, 12);
    poner(octal(Math.floor(this.reloj.ms() / 1000), 12), 136, 12);

    // La suma se calcula con el campo lleno de OCHO espacios exactos, y recién
    // después se sobrescribe con el valor real. Es la parte del formato que
    // más fácil se rompe.
    poner("        ", 148, 8);
    cabecera[156] = 0x30; // tipo 0: archivo normal
    poner("ustar\0", 257, 6);
    poner("00", 263, 2);

    let suma = 0;
    for (const byte of cabecera) suma += byte;
    poner(suma.toString(8).padStart(6, "0") + "\0 ", 148, 8);

    return cabecera;
  }

  /** Conserva los últimos 30. Un mes de respaldos diarios alcanza de sobra. */
  private async limpiarViejos(): Promise<void> {
    const archivos = (await readdir(this.carpetaRespaldos))
      .filter((n) => n.endsWith(".tar.gz"))
      .sort();

    // Se podan los horarios y el resto POR SEPARADO. Conservar "los últimos 30"
    // a secas funcionaba con un respaldo por día, pero con uno por hora dejaría
    // dos días y medio de historial: si los datos se corrompen un martes y
    // nadie lo nota hasta el lunes, no quedaría ni una copia anterior al daño.
    //
    // Así quedan las últimas 24 horas con detalle fino, y encima un mes de
    // cierres y respaldos diarios para volver más atrás.
    const horarios = archivos.filter((n) => n.endsWith("-horario.tar.gz"));
    const resto = archivos.filter((n) => !n.endsWith("-horario.tar.gz"));

    const aBorrar = [...horarios.slice(0, -HORARIOS_A_CONSERVAR), ...resto.slice(0, -DIARIOS_A_CONSERVAR)];
    for (const viejo of aBorrar) {
      await rm(path.join(this.carpetaRespaldos, viejo), { force: true });
    }
  }
}

/** Un día entero de granularidad fina. */
const HORARIOS_A_CONSERVAR = 24;

/** Un mes de cierres de turno, respaldos diarios y manuales. */
const DIARIOS_A_CONSERVAR = 30;
