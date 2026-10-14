/**
 * Qué redes pueden usar el login de cajero. El de dueño nunca tiene esta
 * restricción: tiene que poder entrar desde cualquier lado.
 */

import { CampoGuardable } from "../../componentes/Piezas";

export function SeccionSeguridad({
  config,
  alGuardar,
}: {
  config: Record<string, unknown>;
  alGuardar: (cambios: Record<string, unknown>) => void;
}) {
  return (
    <CampoGuardable
      key={`seguridad.redesCajero-${String(config["seguridad.redesCajero"] ?? "")}`}
      etiqueta="Redes permitidas para el cajero"
      ayuda="IPs o rangos CIDR separados por coma, por ejemplo 181.64.123.45,100.64.0.0/10. Vacío = sin restricción, el cajero entra desde cualquier lado. El login de dueño nunca tiene esta restricción — tiene que poder entrar desde cualquier parte."
      valor={String(config["seguridad.redesCajero"] ?? "")}
      alGuardar={(v) => alGuardar({ "seguridad.redesCajero": v })}
      placeholder="Sin restricción"
    />
  );
}
