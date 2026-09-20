/**
 * Impresión RAW por la cola de Windows, sin módulos nativos.
 *
 * El camino original mandaba los bytes a `\\localhost\NOMBRE`, que exige que
 * la impresora esté COMPARTIDA. Pedirle eso al dueño de una barbería —entrar a
 * propiedades, pestaña Compartir, escribir un nombre exacto— es una fuente de
 * llamadas de soporte garantizada, y encima falla en Windows Home cuando el
 * uso compartido está capado.
 *
 * Esto en cambio le habla al spooler directamente, que es lo que hace
 * cualquier programa de Windows: se elige la impresora de una lista y listo.
 *
 * Cómo, sin compilar nada: se lanza PowerShell con un fragmento de C# que
 * llama a `winspool.drv` (OpenPrinter / StartDocPrinter con tipo "RAW" /
 * WritePrinter). El tipo RAW es lo que importa — le dice a Windows que no
 * interprete ni convierta los bytes, que es justo lo que necesita ESC/POS.
 *
 * Los bytes viajan por un archivo temporal y no por stdin: PowerShell reescribe
 * la entrada estándar según la codificación de consola y corrompería los bytes
 * altos de CP850 y del bitmap del logo.
 */

import { execFile } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

export interface ImpresoraDeWindows {
  nombre: string;
  /** Nombre del recurso compartido, si la compartieron. */
  compartida: string;
  puerto: string;
  controlador: string;
  desconectada: boolean;
}

const SCRIPT_RAW_WINDOWS = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.ComponentModel;
public static class PosCupulaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int nivel, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int escritos);
  static Exception Falla(string paso) { return new Exception(paso + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message); }
  public static void Enviar(string impresora, byte[] datos, string documento) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero)) throw Falla("No se pudo abrir la impresora");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = documento; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw Falla("Windows no aceptó el trabajo");
      try {
        StartPagePrinter(h);
        int escritos;
        if (!WritePrinter(h, datos, datos.Length, out escritos) || escritos != datos.Length) throw Falla("No se pudo escribir en la impresora");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
$buscado = $env:POS_IMPRESORA
$p = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $buscado -or $_.ShareName -eq $buscado } | Select-Object -First 1
if (-not $p) { [Console]::Error.WriteLine("Windows no tiene ninguna impresora llamada '" + $buscado + "'."); exit 3 }
[PosCupulaRaw]::Enviar($p.Name, [IO.File]::ReadAllBytes($env:POS_ARCHIVO), $env:POS_DOCUMENTO)
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

const SCRIPT_LISTAR_WINDOWS = `$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
@(Get-CimInstance Win32_Printer | ForEach-Object { [pscustomobject]@{ nombre = $_.Name; compartida = $_.ShareName; puerto = $_.PortName; controlador = $_.DriverName; desconectada = [bool]$_.WorkOffline } }) | ConvertTo-Json -Compress
`;

/**
 * Corre un script de PowerShell y devuelve su salida.
 *
 * Va como `-EncodedCommand` en base64 UTF-16LE, que es la forma de pasar un
 * script con acentos y comillas sin pelear con el escapado de cmd.exe.
 */
function powershell(script: string, env: Record<string, string>, ms: number): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const hijo = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { env: { ...process.env, ...env }, timeout: ms, windowsHide: true, maxBuffer: 4_000_000, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) return resolver(stdout);
        // PowerShell escupe los errores envueltos en CLIXML cuando no hay
        // consola; sin limpiarlo, el mensaje que ve el cajero es ilegible.
        const texto = String(stderr || "")
          .replace(/#< CLIXML\r?\n?/g, "")
          .replace(/<Objs[\s\S]*?<\/Objs>/g, "")
          .trim();
        rechazar(new Error(texto || (error.killed ? "Windows tardó demasiado en responder." : error.message)));
      },
    );
    hijo.stdin?.end();
  });
}

export async function imprimirRawEnWindows(nombre: string, bytes: Buffer, documento: string): Promise<void> {
  const archivo = path.join(tmpdir(), `pos-cupula-${process.pid}-${Date.now()}.bin`);
  await writeFile(archivo, bytes);
  try {
    await powershell(SCRIPT_RAW_WINDOWS, { POS_IMPRESORA: nombre, POS_ARCHIVO: archivo, POS_DOCUMENTO: documento }, 20_000);
  } finally {
    await rm(archivo, { force: true }).catch(() => undefined);
  }
}

export async function listarImpresorasWindows(): Promise<ImpresoraDeWindows[]> {
  if (process.platform !== "win32") return [];
  const salida = (await powershell(SCRIPT_LISTAR_WINDOWS, {}, 20_000)).trim();
  if (!salida) return [];
  const datos = JSON.parse(salida);
  const lista: ImpresoraDeWindows[] = (Array.isArray(datos) ? datos : [datos]).map((p: Record<string, unknown>) => ({
    nombre: String(p.nombre ?? ""),
    compartida: p.compartida ? String(p.compartida) : "",
    puerto: String(p.puerto ?? ""),
    controlador: String(p.controlador ?? ""),
    desconectada: Boolean(p.desconectada),
  }));
  // Las que parecen ticketera primero: en una PC con la impresora de hojas,
  // un PDF virtual y la térmica, la térmica es la que se quiere elegir.
  const pareceTicketera = (p: ImpresoraDeWindows) =>
    /adv|8010|pos|80|58|t[eé]rmic|thermal|receipt|ticket/i.test(`${p.nombre} ${p.controlador}`);
  lista.sort((a, b) => Number(pareceTicketera(b)) - Number(pareceTicketera(a)) || a.nombre.localeCompare(b.nombre));
  cacheImpresorasWindows.lista = lista;
  cacheImpresorasWindows.ts = Date.now();
  return lista;
}

/**
 * Consultar las impresoras cuesta ~1 s de PowerShell, y `estado()` se llama en
 * cada pantalla. Se cachea un minuto y se refresca en segundo plano: quien
 * pregunta recibe lo último que se supo, sin esperar.
 */
const cacheImpresorasWindows: { lista: ImpresoraDeWindows[] | null; ts: number; pendiente: boolean } = {
  lista: null,
  ts: 0,
  pendiente: false,
};

export function impresorasWindowsCacheadas(): ImpresoraDeWindows[] | null {
  if (process.platform !== "win32") return null;
  if (Date.now() - cacheImpresorasWindows.ts > 60_000 && !cacheImpresorasWindows.pendiente) {
    cacheImpresorasWindows.pendiente = true;
    listarImpresorasWindows()
      .catch(() => undefined)
      .finally(() => {
        cacheImpresorasWindows.pendiente = false;
      });
  }
  return cacheImpresorasWindows.lista;
}

/** Acepta tanto el nombre de la impresora como el del recurso compartido. */
export function buscarImpresoraWindows(
  lista: ImpresoraDeWindows[],
  nombre: string,
): ImpresoraDeWindows | undefined {
  const n = String(nombre ?? "").toLowerCase();
  return lista.find((p) => p.nombre.toLowerCase() === n) ?? lista.find((p) => p.compartida.toLowerCase() === n);
}
