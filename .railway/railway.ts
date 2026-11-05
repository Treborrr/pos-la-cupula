/**
 * El despliegue en Railway, como código.
 *
 * Reemplaza a `railway.json`, que Railway deprecó y dejaba de leer el 1 de
 * diciembre de 2026. La migración ya está aplicada y el `railway.json` se
 * borró: dejarlo al lado sería una segunda fuente de verdad que ya nadie lee,
 * y el día que alguien lo edite creyendo que manda, no pasará nada y perderá
 * una tarde averiguando por qué.
 *
 * ESTE ARCHIVO SE ESCRIBIÓ A MANO sobre lo que generó `railway config migrate`,
 * porque el generador deja fuera dos cosas que ya existen en el proyecto y que
 * "no estar declaradas" significa BORRAR:
 *
 *   · El VOLUMEN montado en `/data`. Es donde vive el log de eventos, o sea
 *     todas las ventas. Aplicando el archivo generado, el plan desconectaba el
 *     volumen del servicio.
 *   · El repositorio de origen.
 *
 * Es la trampa de la infraestructura como código: lo que no está escrito acá
 * se da por eliminado. Por eso `railway config plan` se mira ANTES de aplicar,
 * y si dice "destructive change", no se aplica.
 *
 * LAS VARIABLES DE ENTORNO NO ESTÁN ACÁ, y es deliberado: `managed: false`
 * significa que Railway nunca las lee ni las escribe desde este archivo y
 * siguen viviendo en el panel. Entre ellas está `RESEND_API_KEY`, que es un
 * secreto: un secreto en un archivo del repositorio queda en el historial de
 * git para siempre, y rotarlo deja de alcanzar. `POS_DATOS` también se queda
 * ahí, porque apunta al Volumen y es propio de esta instalación, no del código.
 */

import { defineRailway, github, project, service, volume } from "railway/iac";

// Este repositorio administra solo sus propios recursos del entorno.
// Ver https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "pos-la-cupula";

export default defineRailway(() => {
  /**
   * El disco que sobrevive a los despliegues.
   *
   * El contenedor es efímero: sin esto, cada `railway up` empezaría con el log
   * de eventos vacío y se perderían todas las ventas. `carpetaDeDatos.ts` se
   * niega a arrancar en Railway si `POS_DATOS` no apunta acá, justamente para
   * que ese error no pueda pasar en silencio.
   */
  const datos = volume("pos-la-cupula-volume", { sizeMB: 5000, region: "us-west2" });

  const pos = service("pos-la-cupula", {
    source: github("Treborrr/pos-la-cupula"),
    build: "npm run build",

    /**
     * Node ARRANCA DIRECTO, sin pasar por `npm start`. No es cosmético: es lo
     * que hace que el apagado sea limpio.
     *
     * Con `npm start`, el PID 1 del contenedor es npm, y la cadena queda
     * npm → sh → node. Al desplegar, Railway manda SIGTERM al PID 1. npm se lo
     * pasa a su hijo `sh`, y `sh` se muere en el acto sin reenviarlo: node
     * NUNCA recibe la señal (en los logs no aparecía ni el "apagando…"). npm ve
     * que su hijo murió por señal, imprime `npm error signal SIGTERM` y sale
     * con código 1. Un PID 1 que sale distinto de 0 es, para Railway, un crash:
     * de ahí el correo "Deploy Crashed" en CADA despliegue, con el servicio
     * sano y la propia deploy en SUCCESS.
     *
     * Arrancando node directo, node ES el PID 1, recibe el SIGTERM, corre su
     * apagado ordenado (ver `servidor.ts`) y sale con 0.
     *
     * Medido en un contenedor igual al de Railway, con `docker stop`:
     *   npm start  + apagado ordenado  → exit 1    (crash)
     *   npm start  + apagado colgado   → exit 1    (crash)
     *   node directo + apagado colgado → exit 137  (crash, por SIGKILL)
     *   node directo + apagado ordenado→ exit 0    ✓
     *
     * O sea que hacen falta LAS DOS COSAS: node como PID 1 y un apagado que
     * termine rápido. Si alguna vez esto vuelve a `npm start`, vuelven los
     * correos. El script `start` del package.json se queda para uso local.
     */
    start: "node apps/servidor/dist/pos-cupula.mjs",

    /**
     * Railway no da por sano el despliegue hasta que esta ruta responde, y
     * mientras tanto mantiene el contenedor anterior sirviendo.
     *
     * Importa más de lo que parece: `/api/salud` solo contesta cuando el log
     * de eventos ya se reprodujo entero. Si el arranque fallara a mitad de la
     * reproducción, el POS nunca llega a atender con un estado incompleto.
     */
    healthcheck: "/api/salud",
    healthcheckTimeout: 100,

    volumeMounts: { "/data": datos },
  });

  return project("pos-la-cupula", {
    variables: { managed: false },
    resources: [datos, pos],
  });
});
