/**
 * Nombre del cliente con autocompletado.
 *
 * Se escribe en mayúsculas y, mientras se escribe, se despliegan los clientes
 * que coinciden. Si lo escrito es el nombre de un cliente que ya existe (sin
 * importar mayúsculas, espacios ni tildes), se usa ese: así no se repiten. Si
 * no existe, queda como cliente nuevo y se registra al cobrar.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, UserPlus, UserRound, X } from "lucide-react";

import { api, type Cliente } from "../lib/api";
import { cuandoFue } from "../lib/formato";

export function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function limpiarNombre(s: string): string {
  return s.replace(/\s+/g, " ").trimStart().toLocaleUpperCase("es");
}

export function CampoCliente({
  clienteId,
  nombre,
  alCambiar,
}: {
  clienteId: string | null;
  nombre: string;
  alCambiar: (id: string | null, nombre: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const refCampo = useRef<HTMLInputElement>(null);
  const termino = nombre.trim();

  const consulta = useQuery({
    queryKey: ["clientes", "autocompletar", termino],
    queryFn: () => api.get<{ clientes: Cliente[] }>(`/clientes?q=${encodeURIComponent(termino)}&limite=50`),
    enabled: termino.length >= 2,
    placeholderData: (anterior) => anterior,
  });

  const clave = normalizarNombre(termino);
  const coincidencias = termino.length >= 2 ? (consulta.data?.clientes ?? []) : [];
  const exactos = coincidencias.filter((c) => normalizarNombre(c.nombre) === clave);
  const listaCargada = termino.length >= 2 && !consulta.isFetching;

  // Nombre idéntico a UN cliente existente: se usa ese sin preguntar.
  useEffect(() => {
    if (clienteId || !listaCargada || exactos.length !== 1) return;
    alCambiar(exactos[0].id, exactos[0].nombre);
  }, [clienteId, listaCargada, exactos, alCambiar]);

  const elegido = clienteId ? coincidencias.find((c) => c.id === clienteId) : undefined;
  const esNuevo = !clienteId && listaCargada && exactos.length === 0;
  const hayVariosIguales = !clienteId && exactos.length > 1;

  const rect = abierto ? refCampo.current?.getBoundingClientRect() : undefined;
  const visibles = coincidencias.slice(0, 8);

  return (
    <div>
      <div className="relative">
        <UserRound
          className={`pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 ${
            clienteId ? "text-bien" : "text-tinta/35"
          }`}
        />
        <input
          ref={refCampo}
          className={`campo h-12 pr-11 pl-12 font-semibold tracking-wide uppercase ${
            clienteId ? "border-bien/40 bg-bien/[0.04]" : ""
          }`}
          value={nombre}
          placeholder="NOMBRE DEL CLIENTE"
          autoComplete="off"
          aria-label="Nombre del cliente"
          onFocus={() => setAbierto(true)}
          onClick={() => setAbierto(true)}
          onChange={(e) => {
            alCambiar(null, limpiarNombre(e.target.value));
            setAbierto(true);
          }}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && abierto && visibles.length > 0 && !clienteId) {
              e.preventDefault();
              const c = exactos[0] ?? visibles[0];
              alCambiar(c.id, c.nombre);
              setAbierto(false);
            }
          }}
        />
        {nombre ? (
          <button
            type="button"
            className="boton-icono absolute top-1/2 right-0.5 h-10 w-10 -translate-y-1/2"
            onClick={() => {
              alCambiar(null, "");
              refCampo.current?.focus();
            }}
            aria-label="Borrar cliente"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <p
        className={`mt-1.5 flex items-center gap-1.5 text-sm ${
          clienteId ? "text-bien" : hayVariosIguales ? "text-aviso" : "text-tinta/50"
        }`}
      >
        {clienteId ? (
          <>
            <Check className="h-4 w-4" />
            Cliente registrado
            {elegido ? ` · ${elegido.visitas} ${elegido.visitas === 1 ? "visita" : "visitas"}` : ""}
          </>
        ) : hayVariosIguales ? (
          "Hay varios clientes con ese nombre: elige uno de la lista."
        ) : esNuevo ? (
          <>
            <UserPlus className="h-4 w-4" />
            Cliente nuevo: se registra al cobrar
          </>
        ) : termino.length < 2 ? (
          "Escribe el nombre para buscarlo o registrarlo."
        ) : (
          "Buscando…"
        )}
      </p>

      {abierto && rect && !clienteId && visibles.length > 0 ? (
        // Posición fija: dentro del panel con scroll quedaría recortada.
        <div
          className="scroll-fino fixed z-[60] overflow-y-auto rounded-xl border border-linea bg-white py-1 shadow-xl"
          style={{ left: rect.left, width: rect.width, top: rect.bottom + 6, maxHeight: "18rem" }}
        >
          <div className="px-4 pt-2 pb-1 text-xs font-semibold tracking-wider text-tinta/40 uppercase">
            Clientes registrados
          </div>
          {visibles.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                alCambiar(c.id, c.nombre);
                setAbierto(false);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hueso"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.nombre}</span>
                <span className="ayuda block truncate">
                  {c.telefono ? `${c.telefono} · ` : ""}
                  {c.visitas} {c.visitas === 1 ? "visita" : "visitas"} · {cuandoFue(c.ultimaVisita)}
                </span>
              </span>
              {normalizarNombre(c.nombre) === clave ? <Check className="h-4 w-4 shrink-0 text-bien" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
