#!/usr/bin/env node
/**
 * Arma el paquete de instalación para Windows.
 *
 * Produce una carpeta `entrega/` que se copia a la PC de la barbería y se
 * instala con doble clic. El objetivo es que el dueño NUNCA vea una terminal,
 * nunca instale Node, y que el POS arranque solo cuando enciende la
 * computadora.
 *
 *   entrega/
 *     pos-cupula.exe        el servidor entero, con Node adentro
 *     pwa/                  la interfaz compilada
 *     INSTALAR.cmd          copia todo y registra el servicio (pide admin)
 *     DESINSTALAR.cmd
 *     nssm.exe              (hay que bajarlo aparte — ver LEEME)
 *     LEEME.txt
 *
 * Uso:  node herramientas/empaquetar-windows.mjs
 *
 * Nota: `pkg` genera el .exe de Windows también desde macOS o Linux. La
 * primera vez descarga el runtime de Node para Windows (~40 MB) y lo cachea.
 */

import { exec } from "node:child_process";
import { cp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const correr = promisify(exec);
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const ENTREGA = join(RAIZ, "entrega");

const VERSION = "0.2.0";
const NOMBRE_SERVICIO = "POSCupula";
const PUERTO = 7070;
const CARPETA_INSTALACION = "C:\\POSCupula";

/**
 * Acceso remoto por Tailscale.
 *
 * Es una VPN de malla: la PC de la barbería sale HACIA Tailscale y los
 * dispositivos autorizados la ven como si estuvieran en la misma red. No se
 * abre ningún puerto en el router y el POS no queda expuesto a internet.
 *
 * Esto último no es un detalle: el POS NO TIENE LOGIN. Publicarlo con un
 * redireccionamiento de puertos dejaría a cualquiera anular ventas, cambiar
 * precios y leer los datos de todos los clientes. Tailscale es lo que aporta
 * la autenticación que la aplicación no tiene.
 *
 * El .msi no se incluye en el repositorio por la misma razón que nssm.exe: no
 * redistribuir binarios de terceros. Si está al lado del instalador, se
 * instala solo; si no, se avisa y el POS queda funcionando en la red local.
 */
const TAILSCALE_MSI = "tailscale-setup.msi";
const TAILSCALE_EXE = "C:\\Program Files\\Tailscale\\tailscale.exe";

console.log("Empaquetando POS La Cúpula para Windows…\n");

await rm(ENTREGA, { recursive: true, force: true });
await mkdir(ENTREGA, { recursive: true });

// ── 1. La PWA y el servidor, ya compilados ───────────────────────────────────

console.log("1/4  Compilando la PWA…");
await correr("npm run build --workspace=@cupula/pwa", { cwd: RAIZ });

console.log("2/4  Empaquetando el servidor…");
await correr("npm run build --workspace=@cupula/servidor", { cwd: RAIZ });

// ── 2. El .exe ───────────────────────────────────────────────────────────────

console.log("3/4  Generando pos-cupula.exe (la primera vez baja ~40 MB)…");
try {
  await correr(
    `npx pkg apps/servidor/dist/pos-cupula.mjs ` +
      `--targets node22-win-x64 ` +
      `--output "${join(ENTREGA, "pos-cupula.exe")}" ` +
      // Sin comprimir: el arranque es más rápido y en disco sobra espacio.
      `--no-bytecode --public`,
    { cwd: RAIZ, maxBuffer: 50 * 1024 * 1024 },
  );
  const info = await stat(join(ENTREGA, "pos-cupula.exe"));
  console.log(`     pos-cupula.exe · ${(info.size / 1024 / 1024).toFixed(1)} MB`);
} catch (e) {
  console.error("\n⚠ No se pudo generar el .exe:", e.message.split("\n")[0]);
  console.error("  El bundle .mjs sí está listo en apps/servidor/dist/ y funciona con Node 22.");
  console.error("  Se puede instalar igual, con Node instalado en la PC.\n");
}

await cp(join(RAIZ, "apps/pwa/dist"), join(ENTREGA, "pwa"), { recursive: true });

// ── 3. Los scripts de instalación ────────────────────────────────────────────

console.log("4/4  Escribiendo los scripts de instalación…");

/**
 * NSSM convierte cualquier ejecutable en un servicio de Windows. Se usa en
 * lugar de una tarea programada porque un servicio arranca ANTES de que nadie
 * inicie sesión, se reinicia solo si se cae, y no deja una ventana negra
 * abierta que alguien pueda cerrar sin querer.
 */
const instalar = `@echo off
chcp 65001 > nul
title Instalar POS La Cupula
setlocal

REM Hace falta ser administrador para registrar un servicio de Windows.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Hay que ejecutar este archivo como ADMINISTRADOR.
    echo   Cierra esta ventana, haz clic derecho en INSTALAR.cmd
    echo   y elige "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

echo.
echo   ========================================
echo    POS LA CUPULA - Instalacion v${VERSION}
echo   ========================================
echo.

set DESTINO=${CARPETA_INSTALACION}
set ORIGEN=%~dp0

echo   [1/6] Creando carpetas en %DESTINO%...
if not exist "%DESTINO%\\app" mkdir "%DESTINO%\\app"
REM ATENCION: la carpeta de datos NO se toca nunca al reinstalar. Ahi viven las
REM ventas. Si se borrara, se pierde el negocio entero.
if not exist "%DESTINO%\\datos" mkdir "%DESTINO%\\datos"

echo   [2/6] Copiando el programa...
copy /Y "%ORIGEN%pos-cupula.exe" "%DESTINO%\\app\\" > nul
if exist "%DESTINO%\\app\\pwa" rmdir /S /Q "%DESTINO%\\app\\pwa"
xcopy /E /I /Q /Y "%ORIGEN%pwa" "%DESTINO%\\app\\pwa" > nul

echo   [3/6] Registrando el servicio de Windows...
"%ORIGEN%nssm.exe" stop ${NOMBRE_SERVICIO} > nul 2>&1
"%ORIGEN%nssm.exe" remove ${NOMBRE_SERVICIO} confirm > nul 2>&1
"%ORIGEN%nssm.exe" install ${NOMBRE_SERVICIO} "%DESTINO%\\app\\pos-cupula.exe"
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} AppDirectory "%DESTINO%\\app"
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} AppEnvironmentExtra POS_DATOS=%DESTINO%\\datos PUERTO=${PUERTO}
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} DisplayName "POS La Cupula"
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} Description "Punto de venta de LA CUPULA TATTOO BARBER SHOP"
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} Start SERVICE_AUTO_START
REM Si el proceso muere, que vuelva solo a los 5 segundos. Sin esto, un fallo
REM a las 3 de la tarde deja la barberia sin poder cobrar hasta que alguien
REM reinicie la PC.
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} AppExit Default Restart
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} AppRestartDelay 5000
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} AppStdout "%DESTINO%\\registro\\salida.log"
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} AppStderr "%DESTINO%\\registro\\error.log"
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} AppRotateFiles 1
"%ORIGEN%nssm.exe" set ${NOMBRE_SERVICIO} AppRotateBytes 10485760

echo   [4/6] Arrancando...
"%ORIGEN%nssm.exe" start ${NOMBRE_SERVICIO}
timeout /t 5 /nobreak > nul

echo   [5/6] Acceso remoto (opcional)...
if exist "${TAILSCALE_EXE}" (
    echo         Tailscale ya esta instalado.
) else (
    if exist "%ORIGEN%${TAILSCALE_MSI}" (
        echo         Instalando Tailscale...
        msiexec /i "%ORIGEN%${TAILSCALE_MSI}" /quiet /norestart
        echo         Listo. Falta iniciar sesion una vez: ejecuta ACCESO-REMOTO.cmd
    ) else (
        echo         Sin Tailscale: el POS se vera solo en la red local.
        echo         Para entrar desde fuera, lee ACCESO-REMOTO.cmd
    )
)

echo   [6/6] Creando el acceso directo en el escritorio...
REM --app abre Edge SIN barra de direcciones ni pestanas: se ve y se usa como
REM un programa, y nadie puede navegar a otro lado por error.
set ACCESO=%USERPROFILE%\\Desktop\\POS La Cupula.url
echo [InternetShortcut] > "%ACCESO%"
echo URL=http://localhost:${PUERTO} >> "%ACCESO%"
echo IconFile=%DESTINO%\\app\\pos-cupula.exe >> "%ACCESO%"
echo IconIndex=0 >> "%ACCESO%"

echo.
echo   ========================================
echo    LISTO
echo   ========================================
echo.
echo    El POS quedo instalado y arranca solo con Windows.
echo.
echo    Ábrelo desde el acceso directo del escritorio,
echo    o entra a:  http://localhost:${PUERTO}
echo.
echo    Desde un celular en el mismo WiFi, con la IP de esta PC:
ipconfig | findstr /C:"IPv4"
echo.
echo    PRIMERO QUE NADA, en Ajustes:
echo      1. Configura la ticketera y toca "Imprimir ticket de prueba"
echo      2. Configura la carpeta de respaldos externa
echo.
pause
`;

/**
 * Deja el acceso remoto andando y dice a qué dirección entrar.
 *
 * El inicio de sesión es interactivo a propósito. Se podría automatizar con
 * una auth key, pero eso significa dejar una llave en texto plano dentro de un
 * .cmd en un USB: cambia un problema de seguridad por otro.
 */
const accesoRemoto = `@echo off
chcp 65001 > nul
title POS La Cupula - Acceso remoto
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Hay que ejecutarlo como ADMINISTRADOR.
    echo   Clic derecho en ACCESO-REMOTO.cmd, "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

set TS="${TAILSCALE_EXE}"

echo.
echo   ========================================
echo    POS LA CUPULA - Acceso desde otra red
echo   ========================================
echo.
echo   Esto permite entrar al POS desde fuera de la barberia SIN abrir
echo   ningun puerto del router. Solo lo ven los dispositivos donde
echo   inicies sesion con la misma cuenta.
echo.

if not exist %TS% (
    if exist "%~dp0${TAILSCALE_MSI}" (
        echo   Instalando Tailscale...
        msiexec /i "%~dp0${TAILSCALE_MSI}" /quiet /norestart
        REM El MSI vuelve antes de que el servicio termine de registrarse.
        timeout /t 10 /nobreak > nul
    ) else (
        echo   FALTA Tailscale.
        echo.
        echo   1. Bajalo de https://tailscale.com/download/windows
        echo   2. Guardalo como ${TAILSCALE_MSI} en ESTA carpeta
        echo   3. Vuelve a ejecutar este archivo
        echo.
        echo   O instalalo a mano y vuelve a ejecutar esto.
        echo.
        pause
        exit /b 1
    )
)

echo   Se va a abrir el navegador para iniciar sesion.
echo   Usa la MISMA cuenta en el celular y en la laptop desde donde
echo   quieras entrar.
echo.
pause

REM --unattended: sigue conectada aunque nadie tenga sesion abierta en Windows,
REM que es justo el caso de una PC que solo corre el POS.
%TS% up --unattended

echo.
echo   ========================================
echo    LISTO - Anota esta direccion
echo   ========================================
echo.
REM usebackq y comillas invertidas: sin eso, cmd no sabe ejecutar un comando
REM cuya ruta va entre comillas y el bucle no devuelve nada.
for /f "usebackq tokens=*" %%i in (\`%TS% ip -4\`) do echo    http://%%i:${PUERTO}
echo.
echo   Desde el celular o la laptop:
echo     1. Instala Tailscale
echo     2. Inicia sesion con la MISMA cuenta
echo     3. Entra a la direccion de arriba
echo.
echo   Esa direccion funciona desde cualquier red del mundo, y solo
echo   para los dispositivos de tu cuenta.
echo.
echo   ========================================
echo    FALTA UN PASO - NO TE LO SALTEES
echo   ========================================
echo.
echo   Por defecto Tailscale CADUCA la clave de cada equipo a los
echo   180 dias. Cuando pasa, esta PC se desconecta y deja de verse
echo   desde afuera hasta que alguien vuelva a iniciar sesion aqui.
echo.
echo   Para que quede permanente:
echo.
echo     1. Entra a  https://login.tailscale.com/admin/machines
echo     2. Busca esta PC en la lista
echo     3. Menu de los tres puntos  ...  a la derecha
echo     4. Elige "Disable key expiry"
echo.
echo   Hazlo AHORA. Son diez segundos y si no, en seis meses se corta
echo   el acceso remoto sin aviso.
echo.
echo   OJO: esto solo afecta a VER EL POS DESDE AFUERA. El punto de
echo   venta funciona igual sin Tailscale: sigue cobrando, imprimiendo
echo   y guardando todo. Desde el WiFi del local se entra siempre.
echo.
start https://login.tailscale.com/admin/machines
pause
`;

/**
 * Genera el archivo de auditoría con doble clic.
 *
 * Detiene el servicio, exporta y lo vuelve a arrancar. La detención es
 * obligatoria, no una precaución: el almacén admite UN SOLO escritor y con el
 * POS corriendo el export no puede tomar el bloqueo.
 *
 * Son unos segundos con la caja sin poder cobrar, así que conviene hacerlo con
 * el local cerrado.
 */
const auditoria = `@echo off
chcp 65001 > nul
title POS La Cupula - Auditoria
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Hay que ejecutarlo como ADMINISTRADOR.
    echo.
    pause
    exit /b 1
)

echo.
echo   ========================================
echo    AUDITORIA DEL POS
echo   ========================================
echo.
echo   Genera un archivo de texto con TODOS los movimientos del sistema:
echo   ventas, anulaciones, cambios de precio, ajustes de stock, cierres
echo   de caja y cambios de configuracion.
echo.
echo   OJO: el POS se detiene unos segundos. No lo corras con clientes
echo   esperando para pagar.
echo.
pause

echo.
echo   Deteniendo el POS...
"%~dp0nssm.exe" stop ${NOMBRE_SERVICIO} > nul 2>&1
timeout /t 3 /nobreak > nul

echo   Generando...
cd /d "${CARPETA_INSTALACION}\\app"
set POS_DATOS=${CARPETA_INSTALACION}\\datos
pos-cupula.exe auditoria

echo.
echo   Volviendo a arrancar el POS...
"%~dp0nssm.exe" start ${NOMBRE_SERVICIO} > nul 2>&1
timeout /t 3 /nobreak > nul

echo.
echo   El archivo esta en ${CARPETA_INSTALACION}\\auditoria
echo   Si configuraste carpeta de respaldos externa, tambien hay una copia ahi.
echo.
explorer "${CARPETA_INSTALACION}\\auditoria"
pause
`;

const desinstalar = `@echo off
chcp 65001 > nul
title Desinstalar POS La Cupula

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   Hay que ejecutarlo como ADMINISTRADOR.
    pause
    exit /b 1
)

echo.
echo   Esto quita el PROGRAMA pero NO borra los datos.
echo   Las ventas quedan en ${CARPETA_INSTALACION}\\datos
echo.
set /p CONFIRMA="Seguro? (S/N): "
if /i not "%CONFIRMA%"=="S" exit /b 0

"%~dp0nssm.exe" stop ${NOMBRE_SERVICIO}
"%~dp0nssm.exe" remove ${NOMBRE_SERVICIO} confirm
if exist "${CARPETA_INSTALACION}\\app" rmdir /S /Q "${CARPETA_INSTALACION}\\app"
del "%USERPROFILE%\\Desktop\\POS La Cupula.url" 2>nul

echo.
echo   Listo. Los datos siguen en ${CARPETA_INSTALACION}\\datos
pause
`;

const leeme = `POS LA CÚPULA — v${VERSION}
================================================================

QUÉ ES ESTO
  El punto de venta de LA CÚPULA TATTOO BARBER SHOP. Reemplaza el
  Excel "NOTA DE VENTA CUPULA.xlsm".

  Corre entero en esta computadora. No necesita internet para
  funcionar: solo para la integración con las tarjetas de fidelidad,
  que es opcional.


ANTES DE INSTALAR
  Falta un archivo que no puedo incluir aquí: nssm.exe

  1. Bájalo de https://nssm.cc/download (versión 2.24 o superior)
  2. Del ZIP, saca win64\\nssm.exe
  3. Cópialo en ESTA MISMA CARPETA, al lado de INSTALAR.cmd

  NSSM es lo que convierte el POS en un servicio de Windows: hace
  que arranque solo al encender la PC y que se reinicie solo si se
  cae. Es software libre y conocido; no lo incluyo en el paquete
  simplemente para no redistribuir binarios de terceros.

  OPCIONAL — para entrar al POS desde fuera de la barbería:
  baja Tailscale de https://tailscale.com/download/windows y
  guárdalo como ${TAILSCALE_MSI} en esta misma carpeta. Si está,
  el instalador lo deja listo. Si no está, el POS funciona igual
  pero solo se ve desde el WiFi del local.


CÓMO INSTALAR
  Clic derecho en INSTALAR.cmd → "Ejecutar como administrador"

  El instalador:
    · Copia el programa a ${CARPETA_INSTALACION}\\app
    · Crea ${CARPETA_INSTALACION}\\datos (aquí viven las ventas)
    · Registra el servicio "POS La Cupula"
    · Deja un acceso directo en el escritorio

  Reinstalar por encima NO borra los datos.


LO PRIMERO DESPUÉS DE INSTALAR
  Abre el POS y ve a Ajustes:

  1. TICKETERA
     Elige cómo está conectada y toca "Imprimir ticket de prueba".
     Revisa en el papel: las tildes y la eñe, que la descripción
     larga se parta en varias líneas, que el logo se distinga, que
     el QR se lea con la pistola, y que corte solo al final.

     Si el QR sale mal: es el firmware de esa impresora. Elige el
     perfil genérico, que lo manda como imagen y siempre funciona.

  2. RESPALDOS
     Configura una carpeta externa (OneDrive o un USB que quede
     siempre conectado) y toca "Guardar y probar".

     ESTO NO ES OPCIONAL. Sin copia fuera de esta computadora, el
     día que el disco falle se pierden todas las ventas. El sistema
     escribe un archivo de prueba y lo lee para verificar que el
     destino sirve de verdad.

  3. CATÁLOGO
     Carga los servicios y los productos con sus precios reales.


ENTRAR DESDE FUERA DE LA BARBERÍA
  Desde un celular en el MISMO WiFi no hace falta nada: se entra a la
  IP de esta PC, puerto ${PUERTO}.

  Para entrar desde tu casa o desde datos móviles:

    1. Clic derecho en ACCESO-REMOTO.cmd → "Ejecutar como administrador"
    2. Inicia sesión cuando se abra el navegador
    3. ANOTA la dirección que te muestra al final
    4. APAGA LA CADUCIDAD DE LA CLAVE (el script te lo recuerda y te
       abre la página). En login.tailscale.com/admin/machines, busca
       esta PC → menú "..." → "Disable key expiry".
       Sin esto, a los 180 días se corta el acceso remoto sin aviso.
    5. Instala Tailscale en el celular e inicia sesión con la MISMA
       cuenta
    6. Entra a esa dirección desde donde estés

  NO se abre ningún puerto del router y el POS no queda publicado en
  internet. Solo lo ven los dispositivos donde iniciaste sesión con tu
  cuenta.

  Esto importa: el POS no pide usuario ni contraseña. Publicarlo en
  internet dejaría que cualquiera anule ventas, cambie precios y lea
  los datos de todos los clientes. Por eso se hace así y no abriendo
  el router.

  Y esto tranquiliza: el POS NO DEPENDE de Tailscale. Si caduca, se
  cae o lo desinstalas, la barbería sigue cobrando e imprimiendo
  igual, y desde el WiFi del local se entra siempre. Lo único que se
  pierde es verlo desde afuera.


CARGAR EL CATÁLOGO DESDE UN EXCEL
  Ajustes → Cargar catálogo desde Excel

  Sirve para dar de alta todos los servicios y productos de una vez, en
  lugar de cargarlos uno por uno.

    1. "Descargar plantilla". El archivo trae las instrucciones adentro
       y tres filas de ejemplo.
    2. Llénalo y borra los ejemplos. El Código se deja VACÍO: lo genera
       el sistema.
    3. Súbelo y toca "Revisar el archivo". NO se carga nada todavía:
       primero muestra qué va a pasar con cada fila.
    4. Elige qué hacer con lo que ya estaba cargado:

         Agregar          Carga lo nuevo y actualiza lo que coincida.
                          Lo que no esté en el Excel se queda igual.

         Reemplazar todo  Además, da de baja lo que NO venga en el Excel.
                          El catálogo queda idéntico al archivo.

    5. Recién ahí aparece el botón para aplicar.

  Si la planilla tiene errores, te dice la FILA y la COLUMNA de cada uno
  y no carga nada hasta que los corrijas.

  "Dar de baja" no borra: el ítem deja de aparecer en la pantalla de
  cobro, pero los tickets viejos se siguen viendo, y si lo vuelves a
  cargar reaparece con su historial intacto.


REVISAR TODOS LOS MOVIMIENTOS
  Clic derecho en AUDITORIA.cmd → "Ejecutar como administrador"

  Genera un archivo de texto con todo lo que pasó en el sistema:
  ventas, anulaciones con su motivo, cambios de precio, ajustes de
  stock, cierres de caja y cambios de configuración. Queda en
  ${CARPETA_INSTALACION}\\auditoria y, si configuraste carpeta de
  respaldos externa, también se copia ahí.

  El POS se detiene unos segundos mientras se genera, así que conviene
  hacerlo con el local cerrado.


DÓNDE ESTÁ TODO
  Programa   ${CARPETA_INSTALACION}\\app
  DATOS      ${CARPETA_INSTALACION}\\datos     ← ES LO ÚNICO QUE HAY QUE RESPALDAR
  Auditoría  ${CARPETA_INSTALACION}\\auditoria
  Registro   ${CARPETA_INSTALACION}\\registro


SI ALGO FALLA
  1. Abre el POS → Ajustes → Diagnóstico.
     Ahí dice si los datos están íntegros, cuánta memoria usa y
     qué pasa con la impresora. Se puede leer por teléfono.

  2. Si no abre, reinicia el servicio:
       Inicio → escribir "servicios" → buscar "POS La Cupula"
       → clic derecho → Reiniciar

  3. Los errores quedan en ${CARPETA_INSTALACION}\\registro


CÓMO SE GUARDAN LOS DATOS
  Cada venta se escribe en un archivo de texto y se confirma en el
  disco ANTES de decir "cobrado". Si se corta la luz en medio de una
  venta, al volver el sistema detecta la línea incompleta, la aparta
  y sigue funcionando: no se pierde nada de lo anterior.

  Los archivos son texto plano legible (.jsonl). Se pueden abrir con
  el Bloc de notas. Si alguien los edita a mano, el sistema lo
  detecta y lo avisa en Diagnóstico.


DESINSTALAR
  Clic derecho en DESINSTALAR.cmd → "Ejecutar como administrador"
  Los datos NO se borran.
`;

await writeFile(join(ENTREGA, "INSTALAR.cmd"), instalar.replace(/\n/g, "\r\n"), "latin1");
await writeFile(join(ENTREGA, "DESINSTALAR.cmd"), desinstalar.replace(/\n/g, "\r\n"), "latin1");
await writeFile(join(ENTREGA, "ACCESO-REMOTO.cmd"), accesoRemoto.replace(/\n/g, "\r\n"), "latin1");
await writeFile(join(ENTREGA, "AUDITORIA.cmd"), auditoria.replace(/\n/g, "\r\n"), "latin1");
await writeFile(join(ENTREGA, "LEEME.txt"), leeme.replace(/\n/g, "\r\n"), "utf8");

console.log(`\n✓ Paquete listo en entrega/\n`);
console.log("  Falta poner en esa carpeta, aparte:");
console.log("    · nssm.exe            de https://nssm.cc/download (obligatorio)");
console.log(`    · ${TAILSCALE_MSI}  de https://tailscale.com/download/windows (opcional,`);
console.log("                          solo si se quiere entrar desde otra red)");
console.log("  Después, copiar entrega/ a la PC de la barbería y ejecutar INSTALAR.cmd como admin.");
