/**
 * El precio que cada sucursal le pone a un ítem.
 *
 * El precio del catálogo es el de la CADENA y funciona como valor por defecto:
 * la sucursal que no fijó el suyo lo hereda, y se queda al día sola cuando el
 * general cambia. Esta pantalla solo existe para las excepciones.
 *
 * Por eso el botón dice "Volver al general" y no "Borrar": lo que se guarda no
 * es un precio vacío, es la decisión de volver a heredar. Un precio en blanco
 * significaría "sin precio" y un ítem sin precio no se puede vender desde la
 * grilla, que es exactamente el problema que no queremos crear.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, FalloDeApi } from "../lib/api";
import { aCentimos, aTexto, aTextoConSimbolo } from "../lib/formato";
import { Aviso } from "./Modal";
import { Pastilla } from "./Piezas";

interface PreciosDeSede {
  precioCadena: number | null;
  porSede: { sedeId: string; nombre: string; precio: number | null; propio: boolean }[];
}

export function PreciosPorSede({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");

  const precios = useQuery({
    queryKey: ["precios-sede", itemId],
    queryFn: () => api.get<PreciosDeSede>(`/catalogo/${itemId}/precios-sede`),
  });

  const guardar = useMutation({
    mutationFn: ({ sedeId, precio }: { sedeId: string; precio: number | null }) =>
      api.put(`/catalogo/${itemId}/precio-sede`, { sedeId, precio }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["precios-sede", itemId] });
      qc.invalidateQueries({ queryKey: ["catalogo"] });
      setEditando(null);
    },
  });

  const sedes = precios.data?.porSede ?? [];
  // Con un solo local no hay nada que decidir: el precio del catálogo ES el
  // precio. Mostrar una tabla de una fila sería ruido.
  if (sedes.length < 2) return null;

  const fallo = guardar.error instanceof FalloDeApi ? guardar.error : null;

  return (
    <div>
      <span className="etiqueta mb-2 block">Precio en cada sucursal</span>

      {fallo ? (
        <Aviso tono="mal" titulo={fallo.message}>
          {fallo.sugerencia}
        </Aviso>
      ) : null}

      <div className="tarjeta divide-y divide-linea">
        {sedes.map((s) => (
          <div key={s.sedeId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 font-medium">{s.nombre}</span>

            {editando === s.sedeId ? (
              <>
                <div className="relative w-32">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-tinta/40">
                    S/
                  </span>
                  <input
                    className="campo cifra pl-9 text-right"
                    value={valor}
                    inputMode="decimal"
                    autoFocus
                    onChange={(e) => setValor(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="boton-suave boton-chico"
                  disabled={aCentimos(valor) === null || guardar.isPending}
                  onClick={() => guardar.mutate({ sedeId: s.sedeId, precio: aCentimos(valor) })}
                >
                  Guardar
                </button>
                <button type="button" className="boton-suave boton-chico" onClick={() => setEditando(null)}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className="cifra font-semibold">
                  {s.precio === null ? <span className="text-tinta/35">sin precio</span> : aTextoConSimbolo(s.precio)}
                </span>
                {s.propio ? <Pastilla tono="laton">Propio</Pastilla> : <Pastilla>Del general</Pastilla>}
                <button
                  type="button"
                  className="boton-suave boton-chico"
                  onClick={() => {
                    setEditando(s.sedeId);
                    setValor(s.precio !== null ? aTexto(s.precio) : "");
                  }}
                >
                  Cambiar
                </button>
                {s.propio ? (
                  <button
                    type="button"
                    className="boton-suave boton-chico"
                    disabled={guardar.isPending}
                    onClick={() => guardar.mutate({ sedeId: s.sedeId, precio: null })}
                  >
                    Volver al general
                  </button>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>

      <p className="ayuda mt-1.5">
        Las sucursales marcadas <strong>Del general</strong> cobran el precio de arriba y se actualizan
        solas cuando lo cambies. Solo pon un precio propio donde de verdad sea distinto.
      </p>
    </div>
  );
}
