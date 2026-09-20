/**
 * Almacén de eventos sobre archivos JSON Lines.
 *
 * Es la implementación de HOY del puerto `AlmacenDeEventos`. Mañana habrá una
 * de Postgres contra la misma interfaz y los mismos tests; el dominio no se
 * entera de cuál está corriendo.
 *
 * Disposición en disco:
 *
 *   datos/
 *     eventos/2026-09.jsonl      un archivo por mes, una línea por evento
 *     instantaneas/000012840.json
 *     cuarentena/                líneas ilegibles rescatadas al arrancar
 *     .bloqueo                   PID del servidor: impide dos instancias
 *
 * Las cuatro cosas que este archivo tiene que garantizar, y por qué:
 *
 *  1. UN SOLO ESCRITOR. Dos procesos escribiendo el mismo JSONL es corrupción
 *     garantizada. Lo impide el archivo de bloqueo + una cola serializada
 *     dentro del proceso.
 *  2. DURABILIDAD REAL. No se responde "cobrado" hasta que los bytes pasaron
 *     por `fsync`. En Lima se corta la luz; una venta impresa que no está en
 *     disco es peor que una venta que no ocurrió.
 *  3. RECUPERACIÓN. Si el corte ocurre durante la escritura, queda una línea
 *     incompleta. Al arrancar se detecta, se aparta y se sigue. Nunca se
 *     arranca sobre datos que no se pudieron validar.
 *  4. DETECCIÓN DE MANOSEO. Cadena de hash: editar una línea a mano invalida
 *     todas las siguientes.
 */

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { hostname } from "node:os";

import {
  actualizarDatos,
  esquemaEvento,
  VERSION_ACTUAL,
  ACTOR_MOSTRADOR,
  type Actor,
  type Evento,
  type EventoNuevo,
} from "@cupula/contratos";
import { ulid } from "ulid";

import type { AlmacenDeEventos, FiltroLectura, Integridad } from "../../puertos/AlmacenDeEventos";
import { relojDelSistema, type Reloj } from "../../puertos/Reloj";
import { canonico, hashDelEvento, HASH_GENESIS } from "./canonico";

export interface OpcionesAlmacen {
  /** Carpeta `datos/`. Se crea si no existe. */
  directorio: string;
  reloj?: Reloj;
  actorPorDefecto?: Actor;
  /**
   * Saltarse el archivo de bloqueo. SOLO para los tests, que levantan varios
   * almacenes en paralelo sobre carpetas distintas.
   */
  sinBloqueo?: boolean;
}

/** Lo que se detectó al abrir. Se muestra en `/salud` y en el registro. */
export interface ResultadoApertura {
  eventos: number;
  ultimaSeq: number;
  lineasEnCuarentena: number;
  archivosReparados: string[];
}

export class AlmacenArchivoJsonl implements AlmacenDeEventos {
  private readonly dirEventos: string;
  private readonly dirInstantaneas: string;
  private readonly dirCuarentena: string;
  private readonly rutaBloqueo: string;
  private readonly reloj: Reloj;
  private readonly actorPorDefecto: Actor;
  private readonly sinBloqueo: boolean;

  private _ultimaSeq = 0;
  private _ultimoHash = HASH_GENESIS;
  /** Nombre del mes en curso, "2026-09". */
  private _mesActual: string | null = null;
  private _fd: fs.FileHandle | null = null;
  private _cerrado = false;

  /**
   * Cola de escritura. Serializa los `agregar` dentro del proceso: la
   * asignación de `seq` y la escritura ocurren sin que nadie se meta en el
   * medio, que es lo que hace imposible que dos ventas saquen el mismo
   * correlativo. (El Excel sí podía: `=MAX(...)+1` recalculado fuera de toda
   * transacción.)
   */
  private cola: Promise<unknown> = Promise.resolve();

  apertura: ResultadoApertura = {
    eventos: 0,
    ultimaSeq: 0,
    lineasEnCuarentena: 0,
    archivosReparados: [],
  };

  private constructor(private readonly opciones: OpcionesAlmacen) {
    this.dirEventos = path.join(opciones.directorio, "eventos");
    this.dirInstantaneas = path.join(opciones.directorio, "instantaneas");
    this.dirCuarentena = path.join(opciones.directorio, "cuarentena");
    this.rutaBloqueo = path.join(opciones.directorio, ".bloqueo");
    this.reloj = opciones.reloj ?? relojDelSistema;
    this.actorPorDefecto = opciones.actorPorDefecto ?? ACTOR_MOSTRADOR;
    this.sinBloqueo = opciones.sinBloqueo ?? false;
  }

  static async abrir(opciones: OpcionesAlmacen): Promise<AlmacenArchivoJsonl> {
    const almacen = new AlmacenArchivoJsonl(opciones);
    await almacen.inicializar();
    return almacen;
  }

  private async inicializar(): Promise<void> {
    await fs.mkdir(this.dirEventos, { recursive: true });
    await fs.mkdir(this.dirInstantaneas, { recursive: true });
    await fs.mkdir(this.dirCuarentena, { recursive: true });

    if (!this.sinBloqueo) await this.tomarBloqueo();

    // El orden importa: primero se repara el final de cada archivo, después se
    // escanea. Escanear sobre una línea cortada abortaría el arranque.
    await this.repararColas();
    await this.escanear();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bloqueo: un solo escritor
  // ───────────────────────────────────────────────────────────────────────────

  private async tomarBloqueo(): Promise<void> {
    const previo = await this.leerBloqueo();

    if (previo && previo.host === hostname() && this.procesoVivo(previo.pid)) {
      throw new Error(
        `Ya hay un POS corriendo sobre esta carpeta (PID ${previo.pid}, desde ${previo.inicio}).\n` +
          `Dos procesos escribiendo el mismo log corrompen los datos. ` +
          `Cierra el otro, o si estás seguro de que murió, borra ${this.rutaBloqueo}`,
      );
    }

    // Si llegamos aquí el bloqueo es huérfano: el proceso anterior murió sin
    // limpiar. Después de un apagón ese es el caso NORMAL, no una anomalía, y
    // por eso no se avisa nada: el sistema tiene que arrancar solo cuando
    // vuelve la luz, sin que nadie tenga que borrar un archivo a mano.
    await fs.writeFile(
      this.rutaBloqueo,
      JSON.stringify({ pid: process.pid, host: hostname(), inicio: this.reloj.ahora() }),
      "utf8",
    );
  }

  private async leerBloqueo(): Promise<{ pid: number; host: string; inicio: string } | null> {
    try {
      const o = JSON.parse(await fs.readFile(this.rutaBloqueo, "utf8"));
      if (typeof o?.pid === "number" && typeof o?.host === "string") return o;
      return null; // contenido con forma rara: se trata como huérfano
    } catch (e: any) {
      if (e?.code === "ENOENT") return null; // no hay bloqueo, todo bien
      if (e instanceof SyntaxError) return null; // ilegible: huérfano
      throw e; // permisos, disco: eso sí hay que reportarlo
    }
  }

  private procesoVivo(pid: number): boolean {
    try {
      // Señal 0: no manda nada, solo pregunta si el proceso existe.
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reparación: la línea cortada a la mitad por un corte de luz
  // ───────────────────────────────────────────────────────────────────────────

  private async archivosDeEventos(): Promise<string[]> {
    const entradas = await fs.readdir(this.dirEventos);
    // Los nombres "YYYY-MM.jsonl" ordenan lexicográficamente igual que
    // cronológicamente. Es la razón de nombrarlos así y no "septiembre-26".
    return entradas.filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort();
  }

  /**
   * Revisa el final de cada archivo y corta lo que no sea una línea JSON
   * completa.
   *
   * Lee el archivo entero en memoria a propósito: un mes de esta barbería son
   * ~600 ventas ≈ 400 KB. Hacerlo por streaming para ahorrar memoria que sobra
   * complicaría la parte del código que más importa que sea obviamente
   * correcta.
   */
  private async repararColas(): Promise<void> {
    for (const nombre of await this.archivosDeEventos()) {
      const ruta = path.join(this.dirEventos, nombre);
      const buf = await fs.readFile(ruta);
      if (buf.length === 0) continue;

      // Byte siguiente al último "\n": donde empieza la cola sin terminar.
      const ultimoSalto = buf.lastIndexOf(0x0a);
      let cortarEn = ultimoSalto + 1; // si no hay "\n", queda 0: el archivo entero es cola
      let sobrante = buf.subarray(cortarEn);

      // Una cola vacía es lo normal: el archivo termina en "\n".
      if (sobrante.length === 0) continue;

      // Puede pasar que la cola SÍ sea JSON válido y solo falte el "\n"
      // (el corte cayó entre el write del contenido y el del salto). En ese
      // caso la línea es buena y se la conserva agregándole el salto.
      const texto = sobrante.toString("utf8");
      if (this.lineaValida(texto)) {
        await fs.appendFile(ruta, "\n", "utf8");
        this.apertura.archivosReparados.push(`${nombre} (se completó el salto de línea final)`);
        continue;
      }

      await this.aCuarentena(nombre, sobrante, "línea incompleta al final del archivo");
      await fs.truncate(ruta, cortarEn);
      this.apertura.lineasEnCuarentena++;
      this.apertura.archivosReparados.push(`${nombre} (se apartó una línea cortada)`);
    }
  }

  private lineaValida(texto: string): boolean {
    const t = texto.trim();
    if (t === "") return false;
    try {
      const o = JSON.parse(t);
      return (
        typeof o === "object" && o !== null && typeof o.seq === "number" && typeof o.h === "string"
      );
    } catch {
      return false;
    }
  }

  private async aCuarentena(origen: string, contenido: Buffer, motivo: string): Promise<void> {
    const marca = this.reloj.ahora().replace(/[:.]/g, "-");
    const destino = path.join(this.dirCuarentena, `${origen}-${marca}.txt`);
    await fs.writeFile(
      destino,
      `# Apartado del log al arrancar\n# Archivo: ${origen}\n# Motivo: ${motivo}\n# Cuándo: ${this.reloj.ahora()}\n\n`,
      "utf8",
    );
    await fs.appendFile(destino, contenido);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Escaneo de arranque
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Recorre el log para saber en qué `seq` y con qué hash quedó. No valida el
   * esquema completo de cada evento — eso es trabajo de `verificar()`, que se
   * corre en cada cierre de caja. Aquí solo hace falta el estado del escritor.
   */
  private async escanear(): Promise<void> {
    let cuenta = 0;
    for (const nombre of await this.archivosDeEventos()) {
      const ruta = path.join(this.dirEventos, nombre);
      for await (const linea of this.lineasDe(ruta)) {
        const o = JSON.parse(linea) as { seq: number; h: string };
        if (o.seq <= this._ultimaSeq) {
          throw new Error(
            `El log está desordenado: apareció seq ${o.seq} después de ${this._ultimaSeq} en ${nombre}. ` +
              `Restaura el último respaldo antes de seguir operando.`,
          );
        }
        this._ultimaSeq = o.seq;
        this._ultimoHash = o.h;
        cuenta++;
      }
      this._mesActual = nombre.replace(".jsonl", "");
    }

    this.apertura.eventos = cuenta;
    this.apertura.ultimaSeq = this._ultimaSeq;
  }

  private async *lineasDe(ruta: string): AsyncGenerator<string> {
    const rl = readline.createInterface({
      input: createReadStream(ruta, { encoding: "utf8" }),
      crlfDelay: Infinity, // Windows escribe \r\n si alguien abre el archivo con Notepad
    });
    try {
      for await (const linea of rl) {
        const t = linea.trim();
        if (t !== "") yield t;
      }
    } finally {
      rl.close();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Escritura
  // ───────────────────────────────────────────────────────────────────────────

  private enFila<T>(fn: () => Promise<T>): Promise<T> {
    const resultado = this.cola.then(fn, fn);
    // La cola sigue viva aunque una escritura falle: un error de validación no
    // puede dejar el almacén trabado para siempre.
    this.cola = resultado.then(
      () => undefined,
      () => undefined,
    );
    return resultado;
  }

  /** Mes al que va el evento. Nunca retrocede, ni con el reloj mal puesto. */
  private mesDestino(ts: string): string {
    const delEvento = ts.slice(0, 7); // "2026-09"
    if (this._mesActual && delEvento < this._mesActual) return this._mesActual;
    return delEvento;
  }

  private async archivoPara(mes: string): Promise<fs.FileHandle> {
    if (this._fd && this._mesActual === mes) return this._fd;
    if (this._fd) await this._fd.close();
    this._fd = await fs.open(path.join(this.dirEventos, `${mes}.jsonl`), "a");
    this._mesActual = mes;
    return this._fd;
  }

  async agregar(nuevos: EventoNuevo[]): Promise<Evento[]> {
    if (this._cerrado) throw new Error("El almacén está cerrado");
    if (nuevos.length === 0) return [];

    return this.enFila(async () => {
      const ts = this.reloj.ahora();
      const sellados: Evento[] = [];

      // Se sella y se VALIDA todo el lote antes de tocar el disco. Si un
      // evento no pasa el esquema, no se escribe nada y `seq` no se consume:
      // un bug del dominio no puede dejar un hueco en la secuencia.
      let seq = this._ultimaSeq;
      let hashPrevio = this._ultimoHash;

      for (const nuevo of nuevos) {
        seq += 1;

        // El ORDEN de estos tres pasos no es negociable: validar → hashear →
        // escribir. El esquema NORMALIZA (por ejemplo, pasa los códigos a
        // mayúsculas), así que hashear antes de validar produciría una línea
        // cuyo contenido no corresponde a su propio hash, y la verificación de
        // integridad marcaría como manoseado un log perfectamente sano.
        //
        // Como el esquema exige `h`, se valida con un hash provisional que se
        // descarta enseguida.
        const provisional = {
          seq,
          id: ulid(),
          ts,
          tipo: nuevo.tipo,
          v: nuevo.v ?? VERSION_ACTUAL[nuevo.tipo],
          actor: nuevo.actor ?? this.actorPorDefecto,
          datos: nuevo.datos,
          h: HASH_GENESIS,
        };

        const revisado = esquemaEvento.safeParse(provisional);
        if (!revisado.success) {
          throw new Error(
            `Evento "${nuevo.tipo}" inválido, no se escribió nada:\n` +
              revisado.error.issues
                .map((i) => `  · ${i.path.join(".") || "(raíz)"}: ${i.message}`)
                .join("\n"),
          );
        }

        const { h: _provisional, ...normalizado } = revisado.data;
        const h = hashDelEvento(hashPrevio, normalizado);

        sellados.push({ ...normalizado, h } as Evento);
        hashPrevio = h;
      }

      const mes = this.mesDestino(ts);
      const fd = await this.archivoPara(mes);

      // Una sola llamada a write con todo el lote: el SO la trata como una
      // unidad y no puede quedar media venta escrita entre dos eventos.
      const payload = sellados.map((e) => canonico(e)).join("\n") + "\n";
      await fd.write(payload, null, "utf8");

      // Y aquí está la línea que hace que una venta no se pierda con el corte
      // de luz: hasta que esto vuelve, los bytes pueden estar solo en el caché
      // del sistema operativo.
      await fd.sync();

      this._ultimaSeq = seq;
      this._ultimoHash = hashPrevio;
      return sellados;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lectura
  // ───────────────────────────────────────────────────────────────────────────

  async *leer(filtro: FiltroLectura = {}): AsyncIterable<Evento> {
    const { desdeSeq = 0, hastaSeq = Infinity, tipos } = filtro;
    const filtrarTipos = tipos ? new Set<string>(tipos) : null;

    for (const nombre of await this.archivosDeEventos()) {
      for await (const linea of this.lineasDe(path.join(this.dirEventos, nombre))) {
        const crudo = JSON.parse(linea) as Evento;
        if (crudo.seq <= desdeSeq) continue;
        if (crudo.seq > hastaSeq) return; // el log está ordenado: ya no viene nada más
        if (filtrarTipos && !filtrarTipos.has(crudo.tipo)) continue;

        // Los upcasters corren Aquí, al leer. El archivo no se modifica nunca.
        const datos = actualizarDatos(crudo.tipo, crudo.v, crudo.datos);
        yield { ...crudo, v: VERSION_ACTUAL[crudo.tipo], datos } as Evento;
      }
    }
  }

  ultimaSeq(): number {
    return this._ultimaSeq;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Verificación de integridad
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Recorre el log completo revisando huecos en la secuencia y la cadena de
   * hash. Se corre en cada cierre de caja y sale en pantalla como un tilde.
   *
   * Atención a un detalle sutil: el hash se calcula sobre los datos CRUDOS, tal
   * como fueron escritos, no sobre los datos pasados por los upcasters. Si se
   * verificara sobre lo actualizado, cualquier upcaster nuevo rompería la
   * verificación de todo el histórico.
   */
  async verificar(): Promise<Integridad> {
    const resultado: Integridad = {
      ok: true,
      eventos: 0,
      ultimaSeq: 0,
      huecos: [],
      hashRotos: [],
      enCuarentena: this.apertura.lineasEnCuarentena,
    };

    let esperada = 1;
    let hashPrevio = HASH_GENESIS;

    for (const nombre of await this.archivosDeEventos()) {
      for await (const linea of this.lineasDe(path.join(this.dirEventos, nombre))) {
        const e = JSON.parse(linea) as Evento & { h: string };

        while (esperada < e.seq) resultado.huecos.push(esperada++);
        esperada = e.seq + 1;

        const { h, ...sinHash } = e;
        if (hashDelEvento(hashPrevio, sinHash) !== h) resultado.hashRotos.push(e.seq);

        hashPrevio = h;
        resultado.eventos++;
        resultado.ultimaSeq = e.seq;
      }
    }

    resultado.ok =
      resultado.huecos.length === 0 && resultado.hashRotos.length === 0 && resultado.enCuarentena === 0;
    return resultado;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Instantáneas
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Escribe a un temporal y renombra. `rename` es atómico dentro del mismo
   * volumen: o está la instantánea vieja o la nueva, nunca media.
   */
  async guardarInstantanea(seq: number, estado: unknown): Promise<void> {
    const nombre = `${String(seq).padStart(9, "0")}.json`;
    const destino = path.join(this.dirInstantaneas, nombre);
    const temporal = `${destino}.tmp`;

    const fd = await fs.open(temporal, "w");
    try {
      await fd.write(JSON.stringify({ seq, estado }), null, "utf8");
      await fd.sync();
    } finally {
      await fd.close();
    }
    await fs.rename(temporal, destino);

    // Se conservan las 3 últimas. Una instantánea corrupta no es un problema
    // —el log manda— pero tener de dónde caer acelera el diagnóstico.
    const todas = (await fs.readdir(this.dirInstantaneas))
      .filter((n) => /^\d{9}\.json$/.test(n))
      .sort();
    for (const vieja of todas.slice(0, -3)) {
      await fs.rm(path.join(this.dirInstantaneas, vieja), { force: true });
    }
  }

  async cargarInstantanea(): Promise<{ seq: number; estado: unknown } | null> {
    const todas = (await fs.readdir(this.dirInstantaneas))
      .filter((n) => /^\d{9}\.json$/.test(n))
      .sort()
      .reverse();

    for (const nombre of todas) {
      try {
        const crudo = await fs.readFile(path.join(this.dirInstantaneas, nombre), "utf8");
        const o = JSON.parse(crudo) as { seq: number; estado: unknown };
        if (typeof o.seq === "number") return o;
      } catch {
        // Instantánea ilegible: se prueba la anterior. Si no queda ninguna, se
        // reconstruye desde el log, que es la fuente de verdad de todos modos.
      }
    }
    return null;
  }

  async cerrar(): Promise<void> {
    if (this._cerrado) return;
    this._cerrado = true;
    await this.cola.catch(() => {}); // que terminen las escrituras en vuelo
    if (this._fd) {
      await this._fd.close();
      this._fd = null;
    }
    if (!this.sinBloqueo) await fs.rm(this.rutaBloqueo, { force: true });
  }
}
