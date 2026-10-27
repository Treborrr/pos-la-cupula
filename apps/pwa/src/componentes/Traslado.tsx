/**
 * Mover mercadería de un local a otro.
 *
 * Muestra el stock de TODAS las sucursales antes de pedir la cantidad: sin ver
 * los dos lados a la vez, decidir un traslado es adivinar, y el error se
 * descubre cuando al local de destino le falta producto un sábado.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { api, FalloDeApi } from "../lib/api";
import { Aviso, Modal } from "./Modal";
import { Campo } from "./Piezas";

interface StockPorSede {
  item: { id: string; nombreCompleto: string; tipo: "SERVICIO" | "PRODUCTO" } | null;
  total: number;
  porSede: { sedeId: string; nombre: string; stock: number }[];
}

export function Traslado({
  itemId,
  sedeActualId,
  alCerrar,
}: {
  itemId: string;
  /** La sucursal en la que está parado el ADMIN: el origen por defecto. */
  sedeActualId?: string;
  alCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [desde, setDesde] = useState(sedeActualId ?? "");
  const [hacia, setHacia] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");

  const stock = useQuery({
    queryKey: ["stock-por-sede", itemId],
    queryFn: () => api.get<StockPorSede>(`/sedes/stock/${itemId}`),
  });

  const sedes = stock.data?.porSede ?? [];
  const enOrigen = sedes.find((s) => s.sedeId === desde)?.stock ?? 0;
  const cantidadNum = Number(cantidad.replace(",", "."));
  const cantidadValida = Number.isFinite(cantidadNum) && cantidadNum > 0;

  const trasladar = useMutation({
    mutationFn: () =>
      api.post("/sedes/traslados", {
        itemId,
        desdeSedeId: desde,
        haciaSedeId: hacia,
        cantidad: cantidadNum,
        motivo: motivo.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventario"] });
      qc.invalidateQueries({ queryKey: ["stock-por-sede", itemId] });
      qc.invalidateQueries({ queryKey: ["estado"] });
      alCerrar();
    },
  });

  const faltan: string[] = [];
  if (!desde) faltan.push("el local de origen");
  if (!hacia) faltan.push("el local de destino");
  if (desde && desde === hacia) faltan.push("dos locales distintos");
  if (!cantidadValida) faltan.push("la cantidad");
  if (!motivo.trim()) faltan.push("el motivo");

  /**
   * El aviso de stock insuficiente se adelanta acá, pero el servidor lo
   * RECHAZA igual: es una regla, no una sugerencia de pantalla. A diferencia
   * de la venta, que se cobra igual avisando porque hay un cliente esperando,
   * acá no hay nadie delante y mover unidades que no existen dejaría dos
   * inventarios mal en vez de uno.
   */
  const noAlcanza = cantidadValida && desde && cantidadNum > enOrigen;

  const fallo = trasladar.error instanceof FalloDeApi ? trasladar.error : null;

  return (
    <Modal
      titulo="Trasladar mercadería"
      subtitulo={stock.data?.item?.nombreCompleto}
      alCerrar={alCerrar}
      pie={
        <>
          <button type="button" className="boton-suave" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className="boton"
            disabled={faltan.length > 0 || Boolean(noAlcanza) || trasladar.isPending}
            onClick={() => trasladar.mutate()}
          >
            {trasladar.isPending ? "Moviendo…" : "Trasladar"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {fallo ? <Aviso tono="mal" titulo={fallo.message}>{fallo.sugerencia}</Aviso> : null}

        <div>
          <span className="etiqueta mb-2 block">Dónde está hoy</span>
          <div className="tarjeta divide-y divide-linea">
            {sedes.map((s) => (
              <div key={s.sedeId} className="flex items-baseline justify-between px-4 py-2.5">
                <span className={s.sedeId === desde ? "font-semibold" : ""}>{s.nombre}</span>
                <span className={`cifra font-semibold ${s.stock <= 0 ? "text-tinta/35" : ""}`}>
                  {s.stock}
                </span>
              </div>
            ))}
          </div>
          <p className="ayuda mt-1.5">En toda la cadena hay {stock.data?.total ?? 0}.</p>
        </div>

        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Campo etiqueta="Sale de">
            <select className="campo" value={desde} onChange={(e) => setDesde(e.target.value)}>
              <option value="">Elige…</option>
              {sedes.map((s) => (
                <option key={s.sedeId} value={s.sedeId}>
                  {s.nombre} ({s.stock})
                </option>
              ))}
            </select>
          </Campo>

          <ArrowRight className="mb-3 hidden h-5 w-5 shrink-0 text-tinta/35 sm:block" />

          <Campo etiqueta="Entra en">
            <select className="campo" value={hacia} onChange={(e) => setHacia(e.target.value)}>
              <option value="">Elige…</option>
              {sedes
                .filter((s) => s.sedeId !== desde)
                .map((s) => (
                  <option key={s.sedeId} value={s.sedeId}>
                    {s.nombre} ({s.stock})
                  </option>
                ))}
            </select>
          </Campo>
        </div>

        <Campo etiqueta="Cuántas unidades">
          <input
            className="campo cifra"
            inputMode="decimal"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            placeholder="0"
          />
        </Campo>

        {noAlcanza ? (
          <Aviso tono="mal" titulo={`Ahí solo hay ${enOrigen}.`}>
            Cuenta y ajusta el stock del local de origen, o traslada menos unidades.
          </Aviso>
        ) : null}

        <Campo etiqueta="Motivo" ayuda="Por qué se mueve: reposición, pedido del otro local, sobrestock.">
          <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
      </div>
    </Modal>
  );
}
