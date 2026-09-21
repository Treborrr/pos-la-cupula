/**
 * Punto de entrada. Compone todas las piezas a mano —sin contenedor de
 * inyección de dependencias— porque son pocas y así se lee de corrido qué
 * implementación está enchufada a qué puerto.
 *
 * Es también el único archivo que sabe DÓNDE viven los datos. El resto del
 * sistema recibe el almacén ya construido.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { AlmacenArchivoJsonl } from "./adaptadores/almacen/ArchivoJsonl";
import { ImpresoraConfigurable } from "./adaptadores/impresora/ImpresoraConfigurable";
import { ServicioPos } from "./servicios/Pos";
import { ServicioDeRespaldos } from "./servicios/Respaldos";
import { relojDelSistema } from "./puertos/Reloj";
import { construirApp } from "./http/app";
import { construirAuditoria, formatearAuditoria } from "./consultas/auditoria";
import { generarPlantilla } from "./adaptadores/planilla/plantillaCatalogo";

export const VERSION = "0.3.0";

const aqui = path.dirname(fileURLToPath(import.meta.url));

/**
 * En Windows los datos van a `C:\POSCupula\datos`, fuera de la carpeta del
 * programa: actualizar el POS es reemplazar `app\` y `datos\` no se toca jamás.
 * En desarrollo, una carpeta local que no se versiona.
 */
function carpetaDeDatos(): string {
  if (process.env.POS_DATOS) return path.resolve(process.env.POS_DATOS);
  if (process.platform === "win32") return "C:\\POSCupula\\datos";
  return path.resolve(aqui, "../../../datos-dev");
}

async function carpetaDeLaPwa(): Promise<string | undefined> {
  const candidatas = [
    // Junto al .exe. Va PRIMERO porque el instalador ejecuta el servidor como
    // un .js suelto pasado al .exe: ahí `aqui` apunta a la carpeta del script y
    // las rutas relativas de abajo no encuentran nada.
    path.resolve(path.dirname(process.execPath), "pwa"),
    path.resolve(aqui, "../../pwa/dist"), // desarrollo desde el repo
    path.resolve(aqui, "../pwa"), // empaquetado junto al .exe
  ];
  for (const c of candidatas) {
    try {
      await fs.access(path.join(c, "index.html"));
      return c;
    } catch {
      // Sin PWA compilada solo se sirve el API. En desarrollo es lo normal:
      // Vite sirve el front por su cuenta en el 5173.
    }
  }
  return undefined;
}

async function principal() {
  const directorio = carpetaDeDatos();

  // Subcomando de diagnóstico: `pos-cupula verificar`. Recorre el log entero
  // revisando la secuencia y la cadena de hash, y dice qué encontró.
  if (process.argv[2] === "verificar") {
    const almacen = await AlmacenArchivoJsonl.abrir({ directorio });
    const r = await almacen.verificar();
    console.log(`Carpeta: ${directorio}`);
    console.log(`Eventos: ${r.eventos}   última seq: ${r.ultimaSeq}`);
    console.log(`Huecos en la secuencia: ${r.huecos.length ? r.huecos.join(", ") : "ninguno"}`);
    console.log(`Cadena de hash rota en: ${r.hashRotos.length ? r.hashRotos.join(", ") : "ninguna"}`);
    console.log(`Líneas en cuarentena: ${r.enCuarentena}`);
    console.log(r.ok ? "\n✓ El log está íntegro." : "\n✗ El log tiene problemas (ver arriba).");
    await almacen.cerrar();
    process.exit(r.ok ? 0 : 1);
  }

  /**
   * Escribe la plantilla de catálogo en la ruta que se le pase.
   *
   * La misma que sirve el botón "Descargar plantilla", pero sin necesidad de
   * tener el POS instalado: así se le puede pasar al cliente para que la vaya
   * llenando antes de la instalación. Lo usa el empaquetador para dejarla
   * junto al instalador.
   */
  if (process.argv[2] === "plantilla") {
    const destino = process.argv[3] ?? path.join(process.cwd(), "PLANTILLA-CATALOGO.xlsx");
    await fs.writeFile(destino, generarPlantilla());
    console.log(`Plantilla escrita en: ${destino}`);
    process.exit(0);
  }

  /**
   * Export de auditoría a un archivo de texto.
   *
   * Se corre con el servicio DETENIDO (el almacén admite un solo escritor). Va
   * a `C:\POSCupula\auditoria\` y, si hay destino externo de respaldos
   * configurado, se deja una copia ahí también: así el archivo llega solo a
   * OneDrive o al USB, sin tener que sentarse en la PC de la barbería.
   */
  if (process.argv[2] === "auditoria") {
    const almacen = await AlmacenArchivoJsonl.abrir({ directorio, sinBloqueo: true });
    const auditoria = await construirAuditoria(almacen, directorio, relojDelSistema.ahora());
    const texto = formatearAuditoria(auditoria);

    const marca = relojDelSistema.ahora().slice(0, 10);
    const carpeta = path.join(path.dirname(directorio), "auditoria");
    await fs.mkdir(carpeta, { recursive: true });
    const destino = path.join(carpeta, `auditoria-${marca}.txt`);
    await fs.writeFile(destino, texto, "utf8");

    console.log(`Auditoría escrita en: ${destino}`);

    // La copia al destino externo es lo que hace que el archivo se pueda leer
    // sin sentarse en la PC de la barbería: si ahí apunta a OneDrive, llega
    // solo. Que falle no invalida el export, así que solo se avisa.
    if (auditoria.destinoExterno.trim()) {
      const afuera = path.join(auditoria.destinoExterno.trim(), `auditoria-${marca}.txt`);
      try {
        await fs.mkdir(path.dirname(afuera), { recursive: true });
        await fs.writeFile(afuera, texto, "utf8");
        console.log(`Copia externa      : ${afuera}`);
      } catch (e) {
        console.log(`No se pudo dejar la copia externa: ${e instanceof Error ? e.message : e}`);
      }
    }

    console.log(`Período: ${auditoria.periodo.desde} a ${auditoria.periodo.hasta}`);
    console.log(`Movimientos: ${auditoria.movimientos.length}`);
    console.log(`Integridad: ${auditoria.integridad.ok ? "íntegra" : "CON PROBLEMAS"}`);
    console.log(
      auditoria.señales.length === 0
        ? "Señales: ninguna."
        : `Señales:\n${auditoria.señales.map((s) => `  · ${s.tipo}: ${s.cuantas}`).join("\n")}`,
    );

    await almacen.cerrar();
    process.exit(0);
  }

  const almacen = await AlmacenArchivoJsonl.abrir({ directorio });
  const pos = await ServicioPos.abrir(almacen);

  // La impresora resuelve su adaptador en cada impresión leyendo la
  // configuración, así cambiarla desde Ajustes no obliga a reiniciar el
  // servicio. Arranca en modo vista previa hasta que alguien la configure.
  const impresora = new ImpresoraConfigurable(
    { leer: (clave) => pos.config(clave) },
    path.join(directorio, "tickets"),
  );

  const respaldos = new ServicioDeRespaldos(
    directorio,
    relojDelSistema,
    pos.config<string>("respaldos.destinoExterno") ?? null,
  );

  const app = await construirApp({
    pos,
    impresora,
    respaldos,
    carpetaPwa: await carpetaDeLaPwa(),
    version: VERSION,
  });

  const puerto = Number(process.env.PUERTO ?? 7070);
  // 0.0.0.0 y no 127.0.0.1: así se puede entrar desde un celular en el mismo
  // WiFi sin cambiar nada. En una red de local eso es una comodidad, no un
  // riesgo — pero conviene saberlo antes de llevarlo a una red abierta.
  await app.listen({ port: puerto, host: "0.0.0.0" });

  app.log.info(
    {
      datos: directorio,
      eventos: almacen.apertura.eventos,
      ultimaSeq: almacen.apertura.ultimaSeq,
      reparados: almacen.apertura.archivosReparados,
      enCuarentena: almacen.apertura.lineasEnCuarentena,
    },
    "POS La Cúpula listo",
  );

  /**
   * Respaldo CADA HORA mientras el POS esté encendido.
   *
   * Antes corría a las 23:00 y solo eso. En una barbería que cierra a las 21:00
   * y apaga la computadora, esa hora no llegaba nunca: el sistema no hacía un
   * solo respaldo automático en su vida, y la pantalla de Ajustes igual mostraba
   * el cartel verde porque el destino externo SÍ era escribible.
   *
   * Cada hora no depende de ningún horario, y en una máquina dedicada al POS
   * el costo es nulo: comprimir unos cientos de KB son milisegundos.
   *
   * NO respalda si no se registró nada nuevo. Sin esa condición, una noche con
   * la PC encendida y el local cerrado generaría doce copias idénticas que
   * empujarían fuera de la retención a las que sí sirven.
   */
  let seqRespaldada = almacen.ultimaSeq();
  setInterval(
    () => {
      const seqActual = almacen.ultimaSeq();
      if (seqActual === seqRespaldada) return;

      seqRespaldada = seqActual;
      void pos
        .instantanea()
        .then(() => respaldos.crear("horario"))
        .then((r) => {
          if (r.ok) app.log.info({ archivo: r.archivo, externa: r.copiaExterna }, "respaldo horario");
          else app.log.error({ motivo: r.motivo }, "falló el respaldo horario");
        })
        .catch((e) => app.log.error({ err: e }, "falló el respaldo horario"));
    },
    60 * 60 * 1000,
  ).unref();

  // Verificar el destino externo al arrancar y AVISAR si no sirve. Descubrir
  // que no había respaldo el día que se quema el disco es el peor final
  // posible para este proyecto.
  void respaldos.verificarDestino().then((v) => {
    if (!v.ok) app.log.warn(`Respaldos: ${v.detalle}`);
    else app.log.info(`Respaldos: ${v.detalle}`);
  });

  if (almacen.apertura.lineasEnCuarentena > 0) {
    app.log.warn(
      `Se apartaron ${almacen.apertura.lineasEnCuarentena} línea(s) ilegibles al arrancar. ` +
        `Están en ${path.join(directorio, "cuarentena")}. Casi siempre es un corte de luz durante una venta.`,
    );
  }

  // Apagado ordenado: terminar lo que está en vuelo, guardar la instantánea y
  // soltar el archivo de bloqueo. Sin esto, cada reinicio dejaría un bloqueo
  // huérfano y un arranque más lento.
  let apagando = false;
  for (const senal of ["SIGINT", "SIGTERM"] as const) {
    process.on(senal, async () => {
      if (apagando) return;
      apagando = true;
      app.log.info("apagando…");
      await app.close();
      await pos.cerrar();
      process.exit(0);
    });
  }
}

principal().catch((e) => {
  console.error("\nNo se pudo arrancar el POS:\n");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
