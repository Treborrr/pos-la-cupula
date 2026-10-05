#!/usr/bin/env node
/**
 * Arma el paquete LIVIANO, para mandárselo al cliente y que lo instale solo.
 *
 * Es la versión de `entrega/` sin nada de lo que el cliente no necesita para
 * instalar: se va el instalador de Tailscale (37 MB) y su script, que son para
 * el acceso remoto y se configuran aparte, con Robert presente.
 *
 *   entrega-correo/
 *     POS-LA-CUPULA-vX.Y.Z.zip   ← esto es lo que se le manda
 *     COMO-ENVIARLO.txt          ← esto es para Robert, NO se manda
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO SE PUEDE MANDAR COMO ADJUNTO DE GMAIL
 *
 * Gmail rechaza los mensajes que llevan un ejecutable adjunto, y `.exe` y
 * `.cmd` están en esa lista. No alcanza con meterlos en un ZIP: Gmail abre los
 * archivos comprimidos y mira adentro. El mensaje no llega "con un aviso":
 * directamente no sale.
 *
 * Las dos salidas reales, en orden de conveniencia PARA EL CLIENTE:
 *
 *  1. Subir el ZIP a Google Drive y mandar el enlace. Gmail ya ofrece hacerlo
 *     solo cuando el adjunto es grande. El cliente baja el ZIP, hace clic
 *     derecho → Extraer todo, y ejecuta INSTALAR.cmd. Windows abre ZIPs sin
 *     instalar nada.
 *
 *  2. ZIP con contraseña (`--clave`). Gmail no puede mirar dentro de un ZIP
 *     cifrado, así que pasa. El costo lo paga el cliente: el Explorador de
 *     Windows NO abre ZIPs con contraseña, hay que instalarle 7-Zip primero.
 *     Para alguien que solo quiere instalar su punto de venta, eso es un
 *     obstáculo peor que bajar un archivo de Drive.
 *
 * Uso:
 *   node herramientas/empaquetar-correo.mjs            (ZIP normal, para Drive)
 *   node herramientas/empaquetar-correo.mjs --clave X  (ZIP cifrado, para adjuntar)
 */

import { exec } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const correr = promisify(exec);
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const ENTREGA = join(RAIZ, "entrega");
const SALIDA = join(RAIZ, "entrega-correo");

const VERSION = JSON.parse(await readFile(join(RAIZ, "package.json"), "utf8")).version;
const CARPETA = `POS-LA-CUPULA-v${VERSION}`;

const argumentos = process.argv.slice(2);
const posClave = argumentos.indexOf("--clave");
const clave = posClave >= 0 ? argumentos[posClave + 1] : null;
if (posClave >= 0 && !clave) {
  console.error("Falta la contraseña:  node herramientas/empaquetar-correo.mjs --clave MICLAVE");
  process.exit(1);
}

/**
 * Lo que de verdad hace falta para instalar.
 *
 * La lista es explícita y no "todo lo que haya en entrega/" a propósito: si
 * mañana aparece un archivo nuevo ahí, tiene que entrar acá a mano, después de
 * que alguien decida que el cliente lo necesita.
 */
const NECESARIO = [
  "pos-cupula.exe", //  el servidor entero, con Node adentro
  "pwa", //            la interfaz compilada
  "nssm.exe", //       registra el POS como servicio de Windows
  "INSTALAR.cmd",
  "DESINSTALAR.cmd",
  "AUDITORIA.cmd", //  lo usa Robert, pero vive en la PC del cliente
  "PLANTILLA-CATALOGO.xlsx",
];

/** Lo que se deja afuera, y por qué. Se imprime al final. */
const EXCLUIDO = [
  ["tailscale-setup.msi", "37 MB, y el acceso remoto se configura aparte"],
  ["ACCESO-REMOTO.cmd", "no sirve sin el instalador de Tailscale al lado"],
  ["LEEME.txt", "se reemplaza por uno más corto, de instalación nada más"],
];

console.log(`Armando el paquete para correo · v${VERSION}\n`);

// ── 1. Verificar que entrega/ está completa y al día ─────────────────────────

const faltantes = [];
for (const nombre of NECESARIO) {
  await stat(join(ENTREGA, nombre)).catch(() => faltantes.push(nombre));
}
if (faltantes.length > 0) {
  console.error(`Falta en entrega/: ${faltantes.join(", ")}`);
  console.error("\nCorré primero:  node herramientas/empaquetar-windows.mjs");
  if (faltantes.includes("nssm.exe")) {
    console.error("Y poné nssm.exe en entrega/ (se baja de https://nssm.cc/download).");
  }
  process.exit(1);
}

/**
 * Que el .exe no sea más viejo que el código.
 *
 * Es el error que ya pasó una vez: `entrega/` tenía un .exe de dos semanas
 * antes y parecía un paquete recién hecho. Mandar una versión vieja sin
 * enterarse es peor que no poder armar el paquete.
 */
const exe = await stat(join(ENTREGA, "pos-cupula.exe"));
const bundle = await stat(join(RAIZ, "apps/servidor/dist/pos-cupula.mjs")).catch(() => null);
if (bundle && bundle.mtimeMs > exe.mtimeMs) {
  console.error("El .exe de entrega/ es MÁS VIEJO que el código compilado.");
  console.error("Correé primero:  node herramientas/empaquetar-windows.mjs");
  process.exit(1);
}

// ── 2. Copiar lo necesario ───────────────────────────────────────────────────

await rm(SALIDA, { recursive: true, force: true });
const destino = join(SALIDA, CARPETA);
await mkdir(destino, { recursive: true });

for (const nombre of NECESARIO) {
  await cp(join(ENTREGA, nombre), join(destino, nombre), { recursive: true });
}

// ── 3. Un LEEME corto: instalar y nada más ───────────────────────────────────

/**
 * El LEEME de `entrega/` tiene 180 líneas y cubre respaldos, acceso remoto,
 * auditoría y diagnóstico. Está bien para una instalación acompañada; para
 * alguien que abrió un correo y quiere su POS andando, 180 líneas son 180
 * líneas que no va a leer. Este dice cómo instalar y qué hacer después.
 */
const leeme = `POS LA CÚPULA — v${VERSION}
Punto de venta de LA CÚPULA TATTOO BARBER SHOP

===============================================================================
 CÓMO INSTALARLO
===============================================================================

Necesitas una PC con Windows 10 u 11. No hay que instalar nada más: ni Node,
ni base de datos, ni programas aparte.

  1. Descomprime esta carpeta en el Escritorio.
     (Clic derecho en el ZIP → "Extraer todo…")

     IMPORTANTE: tiene que estar descomprimida. Si ejecutas el instalador
     desde adentro del ZIP, no funciona.

  2. Clic derecho en INSTALAR.cmd → "Ejecutar como administrador".

     Windows va a preguntar si permites que haga cambios: sí.

     Si aparece una pantalla azul que dice "Windows protegió tu PC", es porque
     el programa no está firmado digitalmente (la firma se compra aparte).
     Toca "Más información" y después "Ejecutar de todas formas".

  3. Se instala solo y abre el POS en el navegador. Listo.

El POS queda como un servicio de Windows: arranca solo cuando enciendes la
computadora, sin que nadie tenga que abrir nada.

Si lo cierras sin querer, se vuelve a entrar desde el acceso directo del
escritorio, o escribiendo esto en el navegador:   http://localhost:7070

===============================================================================
 DESDE EL CELULAR O UNA TABLET
===============================================================================

Mientras estén en el MISMO WiFi que la PC, se entra con la dirección que el
instalador muestra al terminar (algo como http://192.168.1.45:7070).

Conviene agregarla a la pantalla de inicio: en el navegador del celular,
menú → "Agregar a pantalla de inicio". Queda como una app.

Para entrar desde fuera del local hace falta configurar el acceso remoto, que
se hace aparte. Pídelo cuando lo necesites.

===============================================================================
 LO PRIMERO QUE HAY QUE HACER
===============================================================================

  1. AJUSTES → NEGOCIO
     Revisa el nombre, la dirección y el RUC: es lo que sale impreso en cada
     ticket.

  2. AJUSTES → TICKETERA
     Elige el modelo e imprime un ticket de prueba. Verifica en el papel que
     la línea de números entre completa, sin cortarse.

  3. AJUSTES → CATÁLOGO
     Acá se carga todo lo que vendes de una sola vez, desde el Excel.
     La plantilla viene en esta misma carpeta: PLANTILLA-CATALOGO.xlsx

     Llénala, súbela, y el sistema te muestra qué va a pasar ANTES de cargar
     nada. Puedes volver a subirla las veces que quieras: reconoce los
     productos por su marca y su nombre, así que actualiza en vez de duplicar.

     Un producto sin PRECIO VENTA se carga igual y se le lleva el stock, pero
     NO se puede vender hasta que le pongas precio. Los que falten aparecen
     juntos en Catálogo → "Completar precios".

  4. AJUSTES → RESPALDOS
     Elige una carpeta de OneDrive o un USB. Sin esto, los datos viven en un
     solo disco, y los discos se mueren.

===============================================================================
 SI ALGO NO ANDA
===============================================================================

El POS no abre
  Espera un minuto: después de encender la PC, el servicio tarda un poco.
  Si sigue sin abrir, reinicia la computadora.

La ticketera no imprime
  Revisa que esté encendida y con papel. Después, AJUSTES → TICKETERA →
  "Imprimir ticket de prueba", que dice qué encontró y qué no.

Cualquier otra cosa
  AJUSTES → DIAGNÓSTICO muestra el estado del sistema y de los datos.
  Mándame una captura de esa pantalla.

===============================================================================
 PARA DESINSTALAR
===============================================================================

Clic derecho en DESINSTALAR.cmd → "Ejecutar como administrador".

Los datos NO se borran: quedan en C:\\POSCupula\\datos. Si vuelves a instalar,
los vuelve a tomar con todo el historial intacto.
`;

await writeFile(join(destino, "LEEME.txt"), leeme.replace(/\n/g, "\r\n"), "utf8");

// ── 4. El ZIP ────────────────────────────────────────────────────────────────

const zip = `${CARPETA}.zip`;
// `-r` recursivo, `-9` compresión máxima: el .exe baja de 57 MB a ~22 MB y
// acá los segundos de CPU no importan, los megas sí.
const cifrado = clave ? `-P ${JSON.stringify(clave)} ` : "";
await correr(`cd ${JSON.stringify(SALIDA)} && zip -rq9 ${cifrado}${JSON.stringify(zip)} ${JSON.stringify(CARPETA)}`);
await rm(destino, { recursive: true, force: true });

const info = await stat(join(SALIDA, zip));
const mb = info.size / 1024 / 1024;

// ── 5. La nota para Robert ───────────────────────────────────────────────────

const LIMITE_GMAIL = 25;
const nota = `CÓMO MANDARLE ESTO AL CLIENTE
${"=".repeat(79)}

Archivo:  ${zip}
Tamaño:   ${mb.toFixed(1)} MB${clave ? `\nClave:    ${clave}` : ""}

Esta nota es para ti. NO se la mandes al cliente: lo único que se manda es el
.zip. El instructivo que él necesita va adentro, en LEEME.txt.

${"-".repeat(79)}
 GMAIL NO VA A DEJAR ADJUNTARLO
${"-".repeat(79)}

Gmail rechaza los mensajes con un ejecutable adjunto, y adentro de este ZIP
hay un .exe y dos .cmd. No alcanza con comprimirlo: Gmail abre el ZIP y mira
adentro. El mensaje no llega con un aviso — no sale.

${
  clave
    ? `Este ZIP está CIFRADO, así que Gmail no puede mirar adentro y pasa.

  Pero el Explorador de Windows NO abre ZIPs con contraseña. Al cliente le vas
  a tener que pedir que instale 7-Zip (https://www.7-zip.org) antes de poder
  descomprimirlo, y pasarle la clave por otro medio (WhatsApp, no en el mismo
  correo).

  Si eso te parece mucho pedirle, armá la versión sin clave y subila a Drive:
    node herramientas/empaquetar-correo.mjs`
    : `LO QUE SÍ FUNCIONA, Y ES MÁS FÁCIL PARA ÉL:

  Subí el .zip a Google Drive y mandale el enlace. Si lo arrastrás al correo,
  Gmail te ofrece hacerlo solo. El cliente hace clic, baja el ZIP, clic derecho
  → Extraer todo, y ejecuta INSTALAR.cmd. Windows abre ZIPs normales sin
  instalar nada.

  La otra opción es un ZIP con contraseña, que Gmail no puede inspeccionar:
    node herramientas/empaquetar-correo.mjs --clave LACUPULA2026

  Pero ojo: el Explorador de Windows no abre ZIPs con contraseña, así que el
  cliente tendría que instalar 7-Zip primero. Para alguien que solo quiere su
  POS andando, bajar de Drive es bastante menos fricción.`
}

${"-".repeat(79)}
 AVISALE DE ESTAS DOS COSAS
${"-".repeat(79)}

1. "Windows protegió tu PC" (pantalla azul al ejecutar el instalador).
   Es normal: el .exe no está firmado digitalmente, y la firma se compra
   aparte. Se toca "Más información" → "Ejecutar de todas formas".
   Está explicado en el LEEME, pero si se lo decís antes, no se asusta.

2. Hay que DESCOMPRIMIR antes de instalar.
   Si ejecuta INSTALAR.cmd desde adentro del ZIP, Windows lo corre en una
   carpeta temporal y la instalación falla.

${"-".repeat(79)}
 QUÉ LLEVA Y QUÉ NO
${"-".repeat(79)}

Lleva:
${NECESARIO.map((n) => `  · ${n}`).join("\n")}
  · LEEME.txt  (el corto, de instalación)

No lleva:
${EXCLUIDO.map(([n, por]) => `  · ${n}\n      ${por}`).join("\n")}

El acceso remoto (entrar desde fuera del local) se configura aparte, con vos
presente: hay que iniciar sesión en Tailscale una vez en esa PC. Para eso está
el paquete completo de entrega/.
`;

await writeFile(join(SALIDA, "COMO-ENVIARLO.txt"), nota, "utf8");

// ── 6. Resumen ───────────────────────────────────────────────────────────────

console.log(`✓ Listo en entrega-correo/\n`);
console.log(`    ${zip}  ·  ${mb.toFixed(1)} MB${clave ? "  (con contraseña)" : ""}`);
console.log(`    COMO-ENVIARLO.txt  ·  para vos, no se manda\n`);

if (mb > LIMITE_GMAIL) {
  console.log(`  ⚠ ${mb.toFixed(1)} MB pasa el límite de 25 MB de Gmail. Hay que subirlo a Drive.`);
} else if (!clave) {
  console.log(`  Entra en los 25 MB de Gmail por tamaño, PERO Gmail bloquea los .exe`);
  console.log(`  incluso dentro de un ZIP. Subilo a Drive y mandá el enlace, o armá`);
  console.log(`  la versión con contraseña. Está todo explicado en COMO-ENVIARLO.txt.`);
} else {
  console.log(`  Cifrado: Gmail no puede mirar adentro, así que lo deja pasar.`);
  console.log(`  El cliente va a necesitar 7-Zip para abrirlo. Ver COMO-ENVIARLO.txt.`);
}
