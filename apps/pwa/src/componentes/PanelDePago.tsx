/**
 * Selección del medio de pago, con soporte de pago mixto.
 *
 * El caso normal es un toque: un medio, monto completo. El pago dividido
 * (parte efectivo, parte YAPE) pasa a diario en una barbería, así que está,
 * pero solo aparece cuando se agrega un segundo medio.
 */

import { useState } from "react";
import { Banknote, CreditCard, Smartphone, X, type LucideIcon } from "lucide-react";

import type { Pago } from "../lib/api";
import { aCentimos, aTexto, aTextoConSimbolo } from "../lib/formato";

export const MEDIOS: readonly { id: Pago["medio"]; texto: string; icono: LucideIcon }[] = [
  { id: "EFECTIVO", texto: "Efectivo", icono: Banknote },
  { id: "YAPE", texto: "YAPE", icono: Smartphone },
  { id: "TARJETA", texto: "Tarjeta", icono: CreditCard },
];

interface PropsDePago {
  total: number;
  pagos: Pago[];
  alCambiar: (pagos: Pago[]) => void;
}

/** Los tres medios, siempre a la vista: es el paso que la guía pide. */
export function BotonesDeMedio({ total, pagos, alCambiar }: PropsDePago) {
  const falta = total - pagos.reduce((a, p) => a + p.monto, 0);

  function agregar(medio: Pago["medio"]) {
    // El primer toque cubre todo lo que falta, que es el 99% de los casos.
    if (falta <= 0 && pagos.length > 0) return;
    alCambiar([...pagos, { medio, monto: falta > 0 ? falta : total }]);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
        {MEDIOS.map((m) => {
          const yaEsta = pagos.some((p) => p.medio === m.id);
          const Icono = m.icono;
          return (
            <button
              key={m.id}
              onClick={() => agregar(m.id)}
              disabled={total <= 0 || yaEsta || (falta <= 0 && pagos.length > 0)}
              className={`flex h-14 items-center justify-center gap-2 rounded-xl border text-[0.95rem] font-semibold transition-colors disabled:cursor-default ${
                yaEsta
                  ? "border-tinta bg-tinta text-white"
                  : "border-linea bg-white text-tinta hover:border-tinta/30 hover:bg-hueso disabled:opacity-40"
              }`}
            >
              <Icono className="h-5 w-5" />
              {m.texto}
            </button>
          );
        })}
    </div>
  );
}

/** Monto de cada medio, "paga con" y vuelto. Aparece al elegir un medio. */
export function DetalleDePagos({ total, pagos, alCambiar }: PropsDePago) {
  const falta = total - pagos.reduce((a, p) => a + p.monto, 0);
  if (pagos.length === 0) return null;

  function cambiar(indice: number, cambios: Partial<Pago>) {
    const nuevos = [...pagos];
    nuevos[indice] = { ...nuevos[indice], ...cambios };
    alCambiar(nuevos);
  }

  return (
    <div className="space-y-3">
      {pagos.map((pago, i) => (
        <LineaDePago
          key={`${pago.medio}-${i}`}
          pago={pago}
          dividido={pagos.length > 1}
          alCambiar={(c) => cambiar(i, c)}
          alQuitar={() => alCambiar(pagos.filter((_, j) => j !== i))}
        />
      ))}

      {pagos.length === 1 && falta === 0 && total > 0 ? (
        <p className="ayuda text-center">¿Paga con dos medios? Cambia el monto y elige el otro medio.</p>
      ) : null}
    </div>
  );
}

function LineaDePago({
  pago,
  dividido,
  alCambiar,
  alQuitar,
}: {
  pago: Pago;
  dividido: boolean;
  alCambiar: (cambios: Partial<Pago>) => void;
  alQuitar: () => void;
}) {
  const [montoTexto, setMontoTexto] = useState(aTexto(pago.monto));
  const [recibidoTexto, setRecibidoTexto] = useState("");
  const medio = MEDIOS.find((m) => m.id === pago.medio)!;
  const Icono = medio.icono;

  const vuelto = pago.recibido !== undefined ? pago.recibido - pago.monto : null;

  function ponerRecibido(centimos: number | undefined, texto: string) {
    setRecibidoTexto(texto);
    alCambiar({ recibido: centimos });
  }

  return (
    <div className="rounded-xl border border-linea bg-hueso/60 p-3">
      <div className="flex items-center gap-3">
        <span className="flex w-28 shrink-0 items-center gap-2 font-semibold">
          <Icono className="h-5 w-5 text-tinta/55" />
          {medio.texto}
        </span>

        <div className="relative flex-1">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta/40">S/</span>
          <input
            className="campo cifra pl-11 text-right text-lg font-semibold"
            value={montoTexto}
            inputMode="decimal"
            aria-label={`Monto en ${medio.texto}`}
            onChange={(e) => {
              setMontoTexto(e.target.value);
              const c = aCentimos(e.target.value);
              if (c !== null) alCambiar({ monto: Math.max(0, c) });
            }}
            onBlur={() => setMontoTexto(aTexto(pago.monto))}
          />
        </div>

        <button onClick={alQuitar} className="boton-icono" aria-label={`Quitar pago en ${medio.texto}`}>
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* "Paga con" solo en efectivo: en YAPE y tarjeta no hay vuelto. */}
      {pago.medio === "EFECTIVO" ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm text-tinta/60">Paga con</span>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta/40">S/</span>
              <input
                className="campo cifra pl-11 text-right text-lg"
                placeholder="0.00"
                inputMode="decimal"
                value={recibidoTexto}
                aria-label="Efectivo recibido"
                onChange={(e) => {
                  const c = aCentimos(e.target.value);
                  ponerRecibido(e.target.value.trim() === "" || c === null ? undefined : c, e.target.value);
                }}
              />
            </div>
            <span className="w-11" />
          </div>

          <div className="flex flex-wrap gap-2 pl-[7.75rem]">
            {sugerencias(pago.monto).map((c) => (
              <button
                key={c}
                onClick={() => ponerRecibido(c, aTexto(c))}
                className={`h-9 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                  pago.recibido === c ? "border-tinta bg-tinta text-white" : "border-linea bg-white hover:bg-hueso"
                }`}
              >
                {c === pago.monto ? "Exacto" : aTextoConSimbolo(c)}
              </button>
            ))}
          </div>

          {vuelto !== null ? (
            <div
              className={`flex items-center justify-between rounded-lg px-4 py-2.5 font-semibold ${
                vuelto < 0 ? "bg-mal/10 text-mal" : "bg-laton-claro text-laton-oscuro"
              }`}
            >
              <span>{vuelto < 0 ? "Falta efectivo" : "Vuelto"}</span>
              <span className="cifra text-2xl">{aTextoConSimbolo(Math.abs(vuelto))}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {dividido ? <p className="ayuda mt-2">Pago dividido: la suma de los medios tiene que dar el total.</p> : null}
    </div>
  );
}

/** Montos con los que la gente suele pagar: el exacto y los billetes siguientes. */
function sugerencias(monto: number): number[] {
  if (monto <= 0) return [];
  const billetes = [1000, 2000, 5000, 10000, 20000];
  const mayores = billetes.filter((b) => b > monto).slice(0, 3);
  return [monto, ...mayores];
}
