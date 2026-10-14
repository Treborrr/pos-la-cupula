#!/usr/bin/env -S npx tsx
/**
 * Crea (o recupera) una cuenta de login, escribiendo DIRECTO contra el log
 * de eventos — sin pasar por HTTP, sin que el sistema tenga que estar
 * corriendo. Es a propósito el ÚNICO camino para dar de alta un ADMIN: nunca
 * hay un endpoint ni una pantalla para eso, para no ensanchar la superficie
 * de ataque con un "primer usuario" expuesto en una URL pública.
 *
 * REQUIERE que el servidor real esté DETENIDO: el almacén admite un solo
 * escritor, y este script toma el bloqueo normal (no lo salta) para fallar
 * fuerte si alguien se olvidó de pararlo — dos procesos escribiendo el mismo
 * log corrompen los datos.
 *
 * Uso:
 *   npx tsx herramientas/crear-usuario.mts --usuario roberto --nombre "Roberto" --rol ADMIN
 *   npx tsx herramientas/crear-usuario.mts --usuario ana --nombre "Ana" --rol CAJERO
 *
 * La contraseña se pide por teclado, oculta — nunca como argumento: un
 * argumento de línea de comandos queda en el historial de la terminal y en
 * la lista de procesos de cualquier otro usuario de la máquina.
 *
 * En Railway: detener el servicio, `railway run npx tsx herramientas/crear-usuario.mts ...`,
 * reiniciar.
 */

import { argv, exit, stdin, stdout } from "node:process";
import * as readline from "node:readline";

import { esquemaRolUsuario, esquemaUsuarioHandle } from "@cupula/contratos";
import { carpetaDeDatos } from "../src/carpetaDeDatos";
import { AlmacenArchivoJsonl } from "../src/adaptadores/almacen/ArchivoJsonl";
import { ServicioPos } from "../src/servicios/Pos";
import { crearUsuario } from "../src/dominio/usuarios/usuarios";
import { hashearContrasena } from "../src/seguridad/contrasenas";
import { esErrorDeNegocio } from "../src/dominio/errores";

function leerArgumento(nombre: string): string | undefined {
  const i = argv.indexOf(`--${nombre}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * Pide texto por teclado sin mostrarlo en pantalla.
 *
 * `readline` no tiene un modo "contraseña" propio. `setRawMode(true)` por sí
 * solo NO alcanza para ocultar nada —desactiva el buffereo por línea, pero no
 * el eco de la terminal—, así que una contraseña tipeada con solo eso queda
 * igual escrita en pantalla. El truco documentado: dejar que `readline`
 * maneje línea/backspace/Ctrl+C como siempre, pero reemplazar
 * `_writeToOutput` —lo que de verdad manda los bytes a la terminal— para que
 * nunca repita lo que se tipeó, solo el mensaje del prompt.
 */
function preguntarOculto(mensaje: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error("Esto necesita correr en una terminal interactiva (hace falta ocultar lo que se tipea)."));
      return;
    }

    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    (rl as unknown as { _writeToOutput: (cadena: string) => void })._writeToOutput = (cadena: string) => {
      if (cadena.startsWith(mensaje)) stdout.write(mensaje);
      // Cualquier otra cosa —lo que se tecleó— no se escribe: queda oculto.
    };

    rl.question(mensaje, (respuesta) => {
      rl.close();
      stdout.write("\n");
      resolve(respuesta);
    });
  });
}

async function principal() {
  const usuarioCrudo = leerArgumento("usuario");
  const nombre = leerArgumento("nombre");
  const rolCrudo = leerArgumento("rol") ?? "ADMIN";

  if (!usuarioCrudo || !nombre) {
    console.error(
      'Uso: npx tsx herramientas/crear-usuario.mts --usuario <handle> --nombre "<nombre>" --rol ADMIN|CAJERO',
    );
    exit(1);
  }

  const usuario = esquemaUsuarioHandle.parse(usuarioCrudo);
  const rol = esquemaRolUsuario.parse(rolCrudo);

  const contrasena = await preguntarOculto(`Contraseña para "${usuario}" (${rol}): `);
  if (contrasena.length < 8) {
    console.error("La contraseña tiene que tener al menos 8 caracteres.");
    exit(1);
  }
  const confirmacion = await preguntarOculto("Repite la contraseña: ");
  if (contrasena !== confirmacion) {
    console.error("Las dos contraseñas no coinciden. No se creó ninguna cuenta.");
    exit(1);
  }

  const directorio = carpetaDeDatos();
  console.log(`Carpeta de datos: ${directorio}`);

  // Bloqueo NORMAL (no `sinBloqueo`): si el servidor real sigue corriendo,
  // esto tiene que fallar fuerte, no escribir igual y arriesgar corrupción.
  const almacen = await AlmacenArchivoJsonl.abrir({ directorio });
  const pos = await ServicioPos.abrir(almacen);

  try {
    const hash = await hashearContrasena(contrasena);
    const usuarioId = await pos.transaccion(
      () => {
        const r = crearUsuario(pos.p, { usuario, nombre, rol, hash });
        return { eventos: r.eventos, resultado: r.usuarioId };
      },
      { tipo: "migracion", id: "bootstrap-usuarios" },
    );

    console.log(`\n✓ Cuenta creada: ${usuario} (${rol}), id ${usuarioId}.`);
  } catch (e) {
    if (esErrorDeNegocio(e)) {
      console.error(`\n✗ ${e.message}${e.sugerencia ? ` ${e.sugerencia}` : ""}`);
    } else {
      console.error("\n✗ Error inesperado:", e);
    }
    exit(1);
  } finally {
    await pos.cerrar();
  }
}

principal().catch((e) => {
  console.error("\nNo se pudo crear la cuenta:\n");
  console.error(e instanceof Error ? e.message : e);
  exit(1);
});
