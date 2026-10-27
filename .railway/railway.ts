/**
 * El despliegue en Railway, como código.
 *
 * Reemplaza a `railway.json`, que Railway deprecó y deja de leer el 1 de
 * diciembre de 2026.
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
    start: "npm start",

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
