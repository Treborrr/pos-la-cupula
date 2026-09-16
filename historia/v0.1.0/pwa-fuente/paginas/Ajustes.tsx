/**
 * Ajustes y diagnóstico.
 *
 * La pantalla de diagnóstico está pensada para poder LEERSE POR TELÉFONO: todo
 * lo que importa cuando algo falla, en un solo lugar y en castellano. Es la
 * primera pregunta cuando el dueño llama diciendo "no funciona".
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../lib/api";
import { Aviso } from "../componentes/Modal";
import { SeccionImpresora } from "./ajustes/Impresora";
import { SeccionRespaldos } from "./ajustes/Respaldos";
import { CampoGuardable, Dato } from "../componentes/Piezas";

interface Salud {
  version: string;
  log: {
    ultimaSeq: number;
    eventos: number;
    integro: boolean;
    huecos: number[];
    hashRotos: number[];
    enCuarentena: number;
  };
  impresora: { disponible: boolean; descripcion: string; detalle?: string };
  memoria: { usadaMB: number; proyeccionMB: number };
  datos: { items: number; ventas: number; clientes: number; barberos: number };
}

export function Ajustes() {
  const qc = useQueryClient();

  const salud = useQuery({ queryKey: ["salud"], queryFn: () => api.get<Salud>("/salud") });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api.get<Record<string, unknown>>("/config"),
  });

  const guardar = useMutation({
    mutationFn: (cambios: Record<string, unknown>) => api.put("/config", cambios),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["estado"] });
    },
  });

  return (
    <div className="scroll-fino h-full overflow-y-auto p-3">
      <h1 className="mb-3 text-xl font-bold">Ajustes</h1>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="tarjeta p-4">
          <h2 className="mb-3 font-bold">Datos del negocio</h2>
          <p className="mb-3 text-xs text-tinta/50">Es lo que sale impreso en el encabezado del ticket.</p>
          {config.data ? (
            <div className="space-y-3">
              {[
                ["negocio.nombre", "Nombre"],
                ["negocio.direccion", "Dirección"],
                ["negocio.ciudad", "Ciudad"],
                ["negocio.ruc", "RUC"],
                ["negocio.pie", "Pie del ticket"],
              ].map(([clave, etiqueta]) => (
                <CampoGuardable
                  key={clave}
                  etiqueta={etiqueta}
                  valor={String(config.data![clave] ?? "")}
                  alGuardar={(v) => guardar.mutate({ [clave]: v })}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section className="tarjeta p-4">
          <h2 className="mb-3 font-bold">Ventas</h2>

          <div className="mb-4">
            <span className="etiqueta mb-1 block">Correlativo</span>
            <p className="text-sm text-tinta/70">
              La numeración arranca en <strong>NV{String(config.data?.["ventas.correlativoInicial"] ?? 30).padStart(6, "0")}</strong>,
              continuando donde quedó el Excel. Siempre avanza: una venta anulada conserva su número
              y ninguno se reutiliza.
            </p>
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={Boolean(config.data?.["ventas.exigirTurnoAbierto"])}
              onChange={(e) => guardar.mutate({ "ventas.exigirTurnoAbierto": e.target.checked })}
            />
            <span className="text-sm">
              <strong>Exigir la caja abierta para cobrar</strong>
              <span className="block text-tinta/55">
                Está desactivado a propósito: si se exige y alguien se olvida de abrir el turno, se
                pierden ventas. Con esto apagado se cobra igual y el arqueo las reporta aparte.
              </span>
            </span>
          </label>
        </section>

        <section className="tarjeta p-4 lg:col-span-2">
          <h2 className="mb-3 font-bold">Diagnóstico</h2>

          {!salud.data ? (
            <p className="text-sm text-tinta/50">Consultando…</p>
          ) : (
            <div className="space-y-3">
              <Aviso tono={salud.data.log.integro ? "bien" : "mal"}>
                {salud.data.log.integro ? (
                  <>
                    ✓ <strong>Los datos están íntegros.</strong> Los {salud.data.log.eventos} eventos
                    registrados forman una secuencia sin huecos y la cadena de hash valida: nadie
                    editó el archivo por fuera del sistema.
                  </>
                ) : (
                  <>
                    ✗ <strong>La verificación encontró problemas.</strong>
                    {salud.data.log.huecos.length > 0
                      ? ` Faltan los eventos ${salud.data.log.huecos.join(", ")}.`
                      : ""}
                    {salud.data.log.hashRotos.length > 0
                      ? ` La cadena de hash no valida en ${salud.data.log.hashRotos.join(", ")}: el archivo fue modificado por fuera del POS.`
                      : ""}
                    {salud.data.log.enCuarentena > 0
                      ? ` Hay ${salud.data.log.enCuarentena} línea(s) apartadas por ilegibles, casi siempre por un corte de luz durante una venta.`
                      : ""}{" "}
                    Restaura el último respaldo antes de seguir operando.
                  </>
                )}
              </Aviso>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Dato etiqueta="Versión" valor={salud.data.version} />
                <Dato etiqueta="Eventos" valor={String(salud.data.log.eventos)} />
                <Dato etiqueta="Ventas" valor={String(salud.data.datos.ventas)} />
                <Dato
                  etiqueta="Memoria"
                  valor={`${salud.data.memoria.usadaMB} MB`}
                  // La PC objetivo tiene 4 GB. Si esto crece sin techo, se ve
                  // aquí antes de que el cliente lo sufra.
                  nota={salud.data.memoria.usadaMB > 400 ? "más de lo esperado" : "normal"}
                />
              </div>

              <div>
                <span className="etiqueta mb-1 block">Ticketera</span>
                <Aviso tono={salud.data.impresora.disponible ? "bien" : "aviso"}>
                  <strong>{salud.data.impresora.descripcion}</strong>
                  {salud.data.impresora.detalle ? (
                    <span className="block">{salud.data.impresora.detalle}</span>
                  ) : null}
                </Aviso>
              </div>

              <button className="boton-suave" onClick={() => salud.refetch()}>
                Verificar de nuevo
              </button>
            </div>
          )}
        </section>

        <section className="tarjeta p-4">
          <h2 className="mb-3 font-bold">Ticketera</h2>
          <SeccionImpresora />
        </section>

        <section className="tarjeta p-4">
          <h2 className="mb-3 font-bold">Respaldos</h2>
          <SeccionRespaldos
            destinoConfigurado={String(config.data?.["respaldos.destinoExterno"] ?? "")}
          />
        </section>

      </div>
    </div>
  );
}
