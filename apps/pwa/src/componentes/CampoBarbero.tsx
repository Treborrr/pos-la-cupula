/**
 * Quién atendió, UNO para toda la venta.
 *
 * Va pegado al nombre del cliente porque son la misma pregunta del mostrador:
 * a quién se le cobra y quién lo atendió. Antes se elegía servicio por
 * servicio, que era pedir el mismo dato varias veces para la misma respuesta:
 * un cliente lo atiende un solo barbero.
 *
 * Botones y no un desplegable: se usa de pie y con prisa, y con los barberos
 * de una barbería entran todos a la vista. Un `select` cuesta dos toques y
 * esconde las opciones.
 */

import { Scissors } from "lucide-react";

import type { Barbero } from "../lib/api";

export function CampoBarbero({
  barberos,
  barberoId,
  alCambiar,
}: {
  barberos: Barbero[];
  barberoId: string | null;
  alCambiar: (barberoId: string | null) => void;
}) {
  const elegido = barberos.find((b) => b.id === barberoId);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {barberos.map((b) => {
          const activo = b.id === barberoId;
          return (
            <button
              key={b.id}
              type="button"
              // Volver a tocar el elegido lo quita: es opcional, y sin esto no
              // habría forma de corregir un toque equivocado.
              onClick={() => alCambiar(activo ? null : b.id)}
              aria-pressed={activo}
              title={activo ? `Quitar a ${b.nombre}` : `Atendió ${b.nombre}`}
              className={`inline-flex h-12 items-center gap-2 rounded-xl border px-4 text-[0.95rem] font-semibold transition-colors ${
                activo
                  ? "border-tinta bg-tinta text-white"
                  : "border-linea bg-white text-tinta/70 hover:border-tinta/30 hover:text-tinta"
              }`}
            >
              {activo ? <Scissors className="h-4 w-4" /> : null}
              {b.nombre}
            </button>
          );
        })}
      </div>

      <p className={`mt-1.5 flex items-center gap-1.5 text-sm ${elegido ? "text-bien" : "text-tinta/50"}`}>
        {elegido ? (
          <>
            <Scissors className="h-4 w-4" />
            Atendió {elegido.nombre}
          </>
        ) : (
          "¿Quién atendió? (opcional)"
        )}
      </p>
    </div>
  );
}
