/**
 * Dónde viven los datos. En su propio módulo, SIN efectos secundarios al
 * importarlo —a diferencia de `servidor.ts`, que arranca el servidor entero
 * en cuanto se lo importa—, para que `herramientas/crear-usuario.mts` pueda
 * usar la MISMA resolución de ruta sin arriesgarse a que las dos diverjan,
 * sin además levantar un servidor que no pidió.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));

/**
 * En Windows los datos van a `C:\POSCupula\datos`, fuera de la carpeta del
 * programa: actualizar el POS es reemplazar `app\` y `datos\` no se toca jamás.
 * En desarrollo, una carpeta local que no se versiona.
 *
 * En Railway (o cualquier nube) el disco del contenedor es EFÍMERO: cada
 * despliegue —cada `git push`, con despliegue continuo— arranca uno nuevo y
 * el anterior desaparece con todo lo que tenía adentro. Si el POS escribiera
 * ahí sin que nadie se diera cuenta, el día del primer despliegue se pierden
 * todas las ventas, y recién se nota semanas después cuando hace falta un
 * reporte viejo. Por eso, bajo Railway, `POS_DATOS` es OBLIGATORIO: tiene que
 * apuntar a un Volumen montado (persiste entre despliegues), y si no está se
 * para antes de arrancar en vez de arrancar mal.
 *
 * `RAILWAY_ENVIRONMENT` lo pone Railway solo, en todo despliegue, sin que
 * nadie lo configure — es la forma confiable de saber "estoy en Railway" sin
 * tocar el arranque local en Mac/Linux.
 */
export function carpetaDeDatos(): string {
  if (process.env.POS_DATOS) return path.resolve(process.env.POS_DATOS);
  if (process.platform === "win32") return "C:\\POSCupula\\datos";
  if (process.env.RAILWAY_ENVIRONMENT) {
    throw new Error(
      "Falta la variable de entorno POS_DATOS. En Railway hay que crear un Volumen, " +
        "montarlo (por ejemplo en /data) y poner POS_DATOS=/data en Settings → Variables. " +
        "Sin esto el POS escribiría en el disco efímero del contenedor y cada despliegue " +
        "borraría las ventas sin avisar.",
    );
  }
  return path.resolve(aqui, "../../../datos-dev");
}
