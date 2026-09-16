/**
 * Selección del medio de pago, con soporte de pago mixto.
 *
 * El caso normal es un toque: un medio, monto completo. El pago dividido
 * (parte efectivo, parte YAPE) pasa a diario en una barbería y el Excel no lo
 * permitía, así que está, pero no se le pone delante a nadie: aparece solo
 * cuando se agrega un segundo medio.
 */

import { useState } from "react";

import type { Pago } from "../lib/api";
import { aCentimos, aTexto, aTextoConSimbolo } from "../lib/formato";

const MEDIOS = [
  { id: "EFECTIVO", texto: "Efectivo" },
  { id: "YAPE", texto: "YAPE" },
  { id: "TARJETA", texto: "Tarjeta" },
] as const;

export function PanelDePago({
  total,
  pagos,
  alCambiar,
}: {
  total: number;
  pagos: Pago[];
  alCambiar: (pagos: Pago[]) => void;
}) {
  const cubierto = pagos.reduce((a, p) => a + p.monto, 0);
  const falta = total - cubierto;

  function agregar(medio: Pago["medio"]) {
    // El primer toque cubre todo lo que falta, que es el 99% de los casos.
    if (falta <= 0 && pagos.length > 0) return;
    alCambiar([...pagos, { medio, monto: falta > 0 ? falta : total }]);
  }

  function cambiarMonto(indice: number, monto: number) {
    const nuevos = [...pagos];
    nuevos[indice] = { ...nuevos[indice], monto: Math.max(0, monto) };
    alCambiar(nuevos);
  }

  function cambiarRecibido(indice: number, recibido: number | undefined) {
    const nuevos = [...pagos];
    nuevos[indice] = { ...nuevos[indice], recibido };
    alCambiar(nuevos);
  }

  function quitar(indice: number) {
    alCambiar(pagos.filter((_, i) => i !== indice));
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {MEDIOS.map((m) => {
          const yaEsta = pagos.some((p) => p.medio === m.id);
          return (
            <button
              key={m.id}
              onClick={() => agregar(m.id)}
              disabled={total <= 0 || (falta <= 0 && !yaEsta) || yaEsta}
              className={`boton ${yaEsta ? "boton-laton" : "boton-suave"}`}
            >
              {m.texto}
            </button>
          );
        })}
      </div>

      {pagos.map((pago, i) => (
        <LineaDePago
          key={`${pago.medio}-${i}`}
          pago={pago}
          soloUno={pagos.length === 1}
          alCambiarMonto={(m) => cambiarMonto(i, m)}
          alCambiarRecibido={(r) => cambiarRecibido(i, r)}
          alQuitar={() => quitar(i)}
        />
      ))}

      {pagos.length > 0 && falta !== 0 ? (
        <div
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            falta > 0 ? "bg-aviso/15 text-aviso" : "bg-mal/15 text-mal"
          }`}
        >
          {falta > 0
            ? `Faltan ${aTextoConSimbolo(falta)} por cubrir`
            : `Los pagos suman ${aTextoConSimbolo(-falta)} de más`}
        </div>
      ) : null}
    </div>
  );
}

function LineaDePago({
  pago,
  soloUno,
  alCambiarMonto,
  alCambiarRecibido,
  alQuitar,
}: {
  pago: Pago;
  soloUno: boolean;
  alCambiarMonto: (monto: number) => void;
  alCambiarRecibido: (recibido: number | undefined) => void;
  alQuitar: () => void;
}) {
  const [montoTexto, setMontoTexto] = useState(aTexto(pago.monto));
  const [recibidoTexto, setRecibidoTexto] = useState("");

  const vuelto = pago.recibido !== undefined ? pago.recibido - pago.monto : null;

  return (
    <div className="rounded-lg border border-black/10 bg-black/[0.03] p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-20 text-sm font-semibold">{pago.medio}</span>

        <div className="relative flex-1">
          <span className="absolute top-1/2 left-2 -translate-y-1/2 text-sm text-tinta/40">S/</span>
          <input
            className="campo cifra py-2 pl-8 text-right"
            value={montoTexto}
            inputMode="decimal"
            onChange={(e) => {
              setMontoTexto(e.target.value);
              const c = aCentimos(e.target.value);
              if (c !== null) alCambiarMonto(c);
            }}
            onBlur={() => setMontoTexto(aTexto(pago.monto))}
          />
        </div>

        <button
          onClick={alQuitar}
          className="rounded-md px-2 py-2 text-xl leading-none text-tinta/40 hover:bg-black/5 hover:text-mal"
          aria-label="Quitar pago"
        >
          ×
        </button>
      </div>

      {/* "Paga con" solo en efectivo: en YAPE y tarjeta no hay vuelto. */}
      {pago.medio === "EFECTIVO" ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="min-w-20 text-xs text-tinta/60">Paga con</span>
          <input
            className="campo cifra flex-1 py-2 text-right"
            placeholder="—"
            inputMode="decimal"
            value={recibidoTexto}
            onChange={(e) => {
              setRecibidoTexto(e.target.value);
              const c = aCentimos(e.target.value);
              alCambiarRecibido(e.target.value.trim() === "" || c === null ? undefined : c);
            }}
          />
          <span
            className={`min-w-28 text-right text-sm font-bold ${
              vuelto === null ? "text-tinta/30" : vuelto < 0 ? "text-mal" : "text-bien"
            }`}
          >
            {vuelto === null
              ? "vuelto —"
              : vuelto < 0
                ? `faltan ${aTexto(-vuelto)}`
                : `vuelto ${aTexto(vuelto)}`}
          </span>
        </div>
      ) : null}

      {soloUno ? null : (
        <p className="mt-1 text-xs text-tinta/45">Pago dividido: la suma tiene que dar el total.</p>
      )}
    </div>
  );
}
