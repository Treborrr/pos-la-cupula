/**
 * Respaldos.
 *
 * El riesgo más grave del sistema no es un bug: es que se queme el disco y no
 * haya copia. Por eso esta pantalla no se limita a un botón: verifica el
 * destino externo ESCRIBIENDO de verdad y lo dice en grande si no sirve.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../lib/api";
import { Aviso } from "../../componentes/Modal";
import { fechaYHora } from "../../lib/formato";
import { tamanoLegible } from "../../componentes/Piezas";

interface EstadoRespaldos {
  carpeta: string;
  ultimo: { archivo: string; cuando: string; bytes: number } | null;
  cantidad: number;
  destinoExterno: string | null;
  destinoExternoEscribible: boolean | null;
  detalleDelDestino?: string;
}

export function SeccionRespaldos({ destinoConfigurado }: { destinoConfigurado: string }) {
  const qc = useQueryClient();
  const [destino, setDestino] = useState(destinoConfigurado);

  const estado = useQuery({
    queryKey: ["respaldos"],
    queryFn: () => api.get<EstadoRespaldos>("/respaldos"),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["respaldos"] });
    qc.invalidateQueries({ queryKey: ["config"] });
  };

  const guardarDestino = useMutation({
    mutationFn: async () => {
      await api.put("/config", { "respaldos.destinoExterno": destino });
      return api.post<{ ok: boolean; detalle: string }>("/respaldos/verificar-destino");
    },
    onSuccess: refrescar,
  });

  const crear = useMutation({
    mutationFn: () => api.post<{ ok: boolean; archivo?: string; copiaExterna?: string; motivo?: string }>(
      "/respaldos",
      { etiqueta: "manual" },
    ),
    onSuccess: refrescar,
  });

  const e = estado.data;

  return (
    <div className="space-y-4">
      {/* Lo primero que se ve: si hay copia fuera de esta máquina o no. */}
      {e?.destinoExternoEscribible === true ? (
        <Aviso tono="bien" titulo="Hay copia fuera de esta computadora">
          {e.detalleDelDestino}
        </Aviso>
      ) : e?.destinoExternoEscribible === false ? (
        <Aviso tono="mal" titulo="La copia externa NO está funcionando">
          {e.detalleDelDestino} Mientras tanto, la única copia vive en el mismo disco que los datos:
          si ese disco falla, se pierde todo.
        </Aviso>
      ) : (
        <Aviso tono="aviso" titulo="No hay copia fuera de esta computadora">
          Los respaldos se guardan en el mismo disco que los datos. Eso protege de un borrado
          accidental, pero <strong>no</strong> de que el disco se queme o roben la PC. Configura
          una carpeta de OneDrive o un USB que quede siempre conectado.
        </Aviso>
      )}

      <div>
        <span className="etiqueta mb-1 block">Carpeta externa para la copia</span>
        <div className="flex gap-2">
          <input
            className="campo"
            placeholder="C:\Users\...\OneDrive\Respaldos POS   o   D:\RespaldosPOS"
            value={destino}
            onChange={(ev) => setDestino(ev.target.value)}
          />
          <button
            className="boton-laton px-4"
            disabled={guardarDestino.isPending}
            onClick={() => guardarDestino.mutate()}
          >
            {guardarDestino.isPending ? "Probando…" : "Guardar y probar"}
          </button>
        </div>
        <p className="mt-1 text-xs text-tinta/45">
          Al guardar se escribe un archivo de prueba, se lee y se borra. Que la carpeta “exista” no
          alcanza: un USB desconectado deja la letra de unidad igual.
        </p>
        {guardarDestino.data ? (
          <div className="mt-2">
            <Aviso tono={guardarDestino.data.ok ? "bien" : "mal"}>{guardarDestino.data.detalle}</Aviso>
          </div>
        ) : null}
      </div>

      <div className="tarjeta p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="etiqueta">Último respaldo</div>
            {e?.ultimo ? (
              <>
                <div className="font-semibold">{fechaYHora(e.ultimo.cuando)}</div>
                <div className="text-xs text-tinta/50">
                  {e.ultimo.archivo} · {tamanoLegible(e.ultimo.bytes)} · {e.cantidad} guardados
                </div>
              </>
            ) : (
              <div className="text-sm text-tinta/50">Todavía no se hizo ninguno.</div>
            )}
          </div>
          <button className="boton-suave" disabled={crear.isPending} onClick={() => crear.mutate()}>
            {crear.isPending ? "Creando…" : "Respaldar ahora"}
          </button>
        </div>

        {crear.data ? (
          <div className="mt-3">
            <Aviso tono={crear.data.ok ? "bien" : "mal"}>
              {crear.data.ok
                ? crear.data.copiaExterna
                  ? "Respaldo creado, con copia en la carpeta externa."
                  : "Respaldo creado en este disco. Sin copia externa."
                : crear.data.motivo}
            </Aviso>
          </div>
        ) : null}
      </div>

      <div className="text-sm text-tinta/70">
        <p className="mb-1">
          <strong>Automático:</strong> todas las noches a las 23:00 y en cada cierre de turno. Se
          conservan los últimos 30.
        </p>
        <p>
          <strong>Restaurar</strong> es descomprimir el archivo y copiar las carpetas{" "}
          <code className="rounded bg-black/5 px-1">eventos</code> e{" "}
          <code className="rounded bg-black/5 px-1">instantaneas</code> sobre la instalación. No
          hace falta este programa ni ninguna herramienta especial: es un <code>.tar.gz</code>{" "}
          estándar que abre 7-Zip o el propio Windows.
        </p>
      </div>
    </div>
  );
}
