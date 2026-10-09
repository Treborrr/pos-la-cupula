/**
 * Navegar las carpetas de la máquina, para elegir dónde va la copia externa.
 *
 * POR QUÉ ESTO Y NO EL EXPLORADOR DE WINDOWS. Las dos alternativas obvias no
 * sirven, y conviene dejarlo escrito para que nadie las reintente:
 *
 *  · Abrir el diálogo nativo desde el servidor. El POS corre como SERVICIO de
 *    Windows, y los servicios viven en la sesión 0, aislada del escritorio
 *    desde Vista. Una ventana lanzada desde ahí no aparece: se queda esperando
 *    invisible y la petición HTTP nunca responde. Lo peor es que al probarlo a
 *    mano —ejecutando el .exe desde una terminal, en la sesión del usuario— sí
 *    funciona, así que el defecto solo se vería en la PC del cliente.
 *
 *  · `showDirectoryPicker()` del navegador. Devuelve un handle, no una ruta.
 *    Los navegadores esconden la ruta absoluta a propósito, y el servidor
 *    necesita exactamente eso —`D:\RespaldosPOS`— para poder escribir ahí.
 *
 * Queda la tercera: el servidor lista los nombres de las carpetas y la pantalla
 * los dibuja. Tiene una ventaja que las otras dos no: funciona igual desde el
 * celular, que es como la mitad del tiempo se usa este sistema.
 *
 * SOBRE QUÉ SE EXPONE. Solo NOMBRES DE CARPETAS, nunca archivos ni su
 * contenido. Es la información mínima para poder elegir un destino. El POS no
 * tiene login (decisión D1/D3) y ya sirve todas las ventas y los clientes a
 * quien alcance el puerto, así que el límite real es la red: la LAN del local
 * y Tailscale. Esto no lo corre.
 */

import { access, constants, readdir, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";

export interface Carpeta {
  nombre: string;
  ruta: string;
}

export interface Sugerencia extends Carpeta {
  /** Para qué sirve, en una línea. */
  detalle: string;
  tipo: "nube" | "extraible" | "disco" | "carpeta";
}

export interface ListadoDeCarpetas {
  /** Dónde estamos parados. `null` = en la raíz, mostrando discos. */
  ruta: string | null;
  /** La carpeta de arriba, o `null` si ya estamos en la raíz. */
  padre: string | null;
  carpetas: Carpeta[];
  /** Los destinos probables. Solo se calculan en la raíz. */
  sugerencias: Sugerencia[];
  /**
   * Si el sistema puede ESCRIBIR acá. Se informa mientras se navega para que
   * nadie elija una carpeta que después va a fallar: entrar y poder escribir
   * son permisos distintos.
   */
  escribible?: boolean;
  /** Si no se pudo leer, el porqué en castellano. */
  problema?: string;
}

const esWindows = platform() === "win32";

async function esCarpeta(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isDirectory();
  } catch {
    return false;
  }
}

async function sePuedeEscribir(ruta: string): Promise<boolean> {
  try {
    await access(ruta, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Las unidades de Windows, probando letra por letra.
 *
 * Es crudo pero no depende de nada: la alternativa es invocar WMI o PowerShell
 * desde el servidor, y sumar un proceso externo —que además puede estar
 * bloqueado por políticas— para averiguar algo que 26 llamadas a `stat`
 * resuelven en milisegundos.
 */
async function unidadesDeWindows(): Promise<Carpeta[]> {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const encontradas = await Promise.all(
    letras.map(async (l) => ((await esCarpeta(`${l}:\\`)) ? { nombre: `Disco ${l}:`, ruta: `${l}:\\` } : null)),
  );
  return encontradas.filter((u): u is Carpeta => u !== null);
}

/**
 * Busca las carpetas de OneDrive de todos los usuarios de la máquina.
 *
 * No se usa la variable de entorno `%OneDrive%` porque el POS corre como
 * servicio bajo LocalSystem, que tiene otro perfil: esa variable no existe ahí
 * y la detección fallaría justo en producción. Recorrer `C:\Users` encuentra la
 * carpeta sin importar con qué cuenta corra el servicio.
 */
async function carpetasDeOneDrive(): Promise<Sugerencia[]> {
  if (!esWindows) return [];
  const salida: Sugerencia[] = [];
  let usuarios: string[] = [];
  try {
    usuarios = await readdir("C:\\Users");
  } catch {
    return [];
  }

  for (const usuario of usuarios) {
    if (usuario === "Public" || usuario === "Default" || usuario.startsWith("All ")) continue;
    let dentro: string[] = [];
    try {
      dentro = await readdir(join("C:\\Users", usuario));
    } catch {
      continue;
    }
    for (const nombre of dentro) {
      if (!nombre.toLowerCase().startsWith("onedrive")) continue;
      const ruta = join("C:\\Users", usuario, nombre);
      if (await esCarpeta(ruta)) {
        salida.push({
          nombre: `${nombre} de ${usuario}`,
          ruta,
          detalle: "Se sincroniza a la nube: la copia sobrevive aunque se rompa o roben la PC.",
          tipo: "nube",
        });
      }
    }
  }
  return salida;
}

/**
 * Los destinos que vale la pena ofrecer antes de hacer navegar a nadie.
 *
 * El orden importa y no es alfabético: primero lo que de verdad protege. Una
 * carpeta de OneDrive sobrevive a que se queme la PC; una carpeta en C: no
 * protege de nada, porque es el mismo disco donde están los datos. Por eso C:
 * ni siquiera se sugiere — se puede elegir navegando, pero no se recomienda.
 */
async function sugerencias(): Promise<Sugerencia[]> {
  const salida: Sugerencia[] = [...(await carpetasDeOneDrive())];

  if (esWindows) {
    for (const u of await unidadesDeWindows()) {
      if (u.ruta.toUpperCase().startsWith("C:")) continue; // el disco del sistema no es respaldo
      salida.push({
        nombre: u.nombre,
        ruta: u.ruta,
        detalle: "Otra unidad: un USB o un disco externo. Tiene que quedar siempre conectado.",
        tipo: "extraible",
      });
    }
  } else {
    // En macOS y Linux, lo equivalente para desarrollo y pruebas.
    for (const [ruta, detalle] of [
      [join(homedir(), "Library", "CloudStorage"), "Carpetas de nube sincronizadas."],
      ["/Volumes", "Discos y USB conectados."],
      ["/media", "Discos y USB conectados."],
      [homedir(), "La carpeta personal."],
    ] as const) {
      if (await esCarpeta(ruta)) {
        salida.push({ nombre: ruta, ruta, detalle, tipo: ruta === homedir() ? "carpeta" : "extraible" });
      }
    }
  }

  return salida;
}

/** Las raíces desde donde se empieza a navegar. */
async function raices(): Promise<Carpeta[]> {
  if (esWindows) return unidadesDeWindows();
  return [
    { nombre: "Carpeta personal", ruta: homedir() },
    { nombre: "Raíz del sistema", ruta: "/" },
  ];
}

/**
 * Lista las subcarpetas de `ruta`, o las raíces si no viene ninguna.
 *
 * Nunca lanza: un destino ilegible —un USB que se desconectó, una carpeta sin
 * permisos— es una situación normal y tiene que poder explicarse en pantalla,
 * no convertirse en un error 500.
 */
export async function listarCarpetas(ruta?: string): Promise<ListadoDeCarpetas> {
  const pedida = ruta?.trim();

  if (!pedida) {
    return { ruta: null, padre: null, carpetas: await raices(), sugerencias: await sugerencias() };
  }

  // Ruta absoluta siempre: una relativa se resolvería contra el directorio del
  // proceso, que no es ningún lugar que el usuario haya elegido.
  if (!isAbsolute(pedida)) {
    return { ruta: null, padre: null, carpetas: await raices(), sugerencias: await sugerencias() };
  }

  const absoluta = resolve(pedida);
  const arriba = parse(absoluta).dir;
  // En la raíz de una unidad, `dir` devuelve la misma ruta: ahí el padre es la
  // lista de discos, no un bucle sobre sí misma.
  const padre = arriba && arriba !== absoluta ? arriba : null;

  let entradas;
  try {
    entradas = await readdir(absoluta, { withFileTypes: true });
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    return {
      ruta: absoluta,
      padre,
      carpetas: [],
      sugerencias: [],
      problema:
        codigo === "ENOENT"
          ? "Esa carpeta ya no existe. Si era un USB, puede estar desconectado."
          : codigo === "EACCES" || codigo === "EPERM"
            ? "El sistema no tiene permiso para entrar a esa carpeta."
            : "No se pudo leer esa carpeta.",
    };
  }

  const carpetas = entradas
    // Solo carpetas: para elegir un destino, los archivos son ruido. Y las
    // ocultas quedan fuera porque nadie guarda un respaldo en una.
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("$"))
    .map((d) => ({ nombre: d.name, ruta: join(absoluta, d.name) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return {
    ruta: absoluta,
    padre,
    carpetas,
    sugerencias: [],
    escribible: await sePuedeEscribir(absoluta),
  };
}
