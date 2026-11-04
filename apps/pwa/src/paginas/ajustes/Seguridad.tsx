/**
 * Qué redes pueden usar el login de cajero. El de dueño nunca tiene esta
 * restricción: tiene que poder entrar desde cualquier lado.
 *
 * El campo de texto (IPs/CIDR) por sí solo no le sirve a un dueño de barbería:
 * no tiene por qué saber cuál es la IP pública de su local. Por eso arriba va
 * lo fácil —la IP desde la que está conectado ahora, con un botón para
 * permitirla— y el campo manual queda abajo para los casos avanzados (varios
 * locales, un rango).
 */

import { useQuery } from "@tanstack/react-query";
import { Check, Globe } from "lucide-react";

import { api } from "../../lib/api";
import { CampoGuardable } from "../../componentes/Piezas";
import { Aviso } from "../../componentes/Modal";

export function SeccionSeguridad({
  config,
  alGuardar,
}: {
  config: Record<string, unknown>;
  alGuardar: (cambios: Record<string, unknown>) => void;
}) {
  const actual = String(config["seguridad.redesCajero"] ?? "").trim();

  const miIp = useQuery({
    queryKey: ["mi-ip"],
    queryFn: () => api.get<{ ip: string }>("/seguridad/mi-ip"),
  });

  const ip = miIp.data?.ip ?? "";
  // IPv6 local del navegador (::1) o IPv4 local: no sirve de nada permitirla.
  const ipUtil = ip && ip !== "::1" && ip !== "127.0.0.1";
  const yaPermitida = ipUtil && actual.split(",").map((s) => s.trim()).includes(ip);

  return (
    <div className="space-y-5">
      {actual === "" ? (
        <Aviso tono="aviso" titulo="Hoy el cajero puede entrar desde cualquier lugar">
          Mientras esto esté vacío, cualquiera que adivine la contraseña de un cajero entra desde
          cualquier parte del mundo. Permite solo la red de tu local.
        </Aviso>
      ) : (
        <Aviso tono="bien" titulo="El login de cajero está restringido por red">
          Solo se puede entrar como cajero desde: <strong>{actual}</strong>. El dueño entra desde donde
          sea.
        </Aviso>
      )}

      {/* El camino fácil: permitir la IP desde la que estás ahora. */}
      <div className="tarjeta p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-hueso text-laton-oscuro">
            <Globe className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {miIp.isLoading
                ? "Viendo desde dónde te conectas…"
                : ipUtil
                  ? `Estás conectado desde ${ip}`
                  : "Abre esto desde el local para ver su IP de internet"}
            </div>
            <div className="ayuda">
              {ipUtil
                ? "Si estás en el local y los cajeros usan este mismo internet, permite esta IP."
                : "Estás en una red local. Entra desde el internet del local —o escribe su IP abajo— para restringirlo."}
            </div>
          </div>
          {ipUtil ? (
            yaPermitida ? (
              <span className="pastilla bg-bien/10 text-bien">
                <Check className="h-3.5 w-3.5" /> Ya permitida
              </span>
            ) : (
              <button
                type="button"
                className="boton shrink-0"
                onClick={() => {
                  // Se agrega a lo que ya haya, sin pisar otras redes permitidas.
                  const lista = actual ? `${actual},${ip}` : ip;
                  alGuardar({ "seguridad.redesCajero": lista });
                }}
              >
                Permitir esta IP
              </button>
            )
          ) : null}
        </div>
      </div>

      {/* El camino avanzado: escribir las redes a mano. */}
      <CampoGuardable
        key={`seguridad.redesCajero-${actual}`}
        etiqueta="Redes permitidas (avanzado)"
        ayuda="IPs o rangos CIDR separados por coma, por ejemplo 181.64.123.45,100.64.0.0/10. Vacío = sin restricción. El login de dueño nunca tiene esta restricción."
        valor={actual}
        alGuardar={(v) => alGuardar({ "seguridad.redesCajero": v })}
        placeholder="Sin restricción"
      />

      <Aviso tono="info">
        Algunos proveedores de internet cambian la IP del local cada tanto. Si un día el cajero no
        puede entrar, vuelve acá desde el local y toca <strong>Permitir esta IP</strong> de nuevo. El
        dueño nunca queda afuera: su login no tiene esta restricción.
      </Aviso>
    </div>
  );
}
