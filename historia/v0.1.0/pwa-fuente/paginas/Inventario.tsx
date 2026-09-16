/**
 * Inventario: existencias, movimientos y kardex. Solo productos físicos.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Item } from "../lib/api";
import { aTexto, aTextoConSimbolo, cantidad, fechaYHora } from "../lib/formato";
import { Aviso, Modal, Vacio } from "../componentes/Modal";

interface ProductoConStock extends Item {
  stock: number;
  bajoMinimo: boolean;
  enNegativo: boolean;
  valorizado: number;
}

interface Movimiento {
  ts: string;
  cantidad: number;
  saldo: number;
  motivo: string;
  origen: "venta" | "anulacion" | "entrada" | "ajuste" | "merma";
  referencia?: string;
}

export function Inventario() {
  const [abierto, setAbierto] = useState<ProductoConStock | null>(null);

  const inventario = useQuery({
    queryKey: ["inventario"],
    queryFn: () =>
      api.get<{ productos: ProductoConStock[]; alertas: unknown[]; valorTotal: number }>("/inventario"),
  });

  const productos = inventario.data?.productos ?? [];
  const enNegativo = productos.filter((p) => p.enNegativo);

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center gap-4">
        <h1 className="text-xl font-bold">Inventario</h1>
        <span className="text-sm text-tinta/60">
          Valorizado: <strong className="cifra">{aTextoConSimbolo(inventario.data?.valorTotal ?? 0)}</strong>
        </span>
      </div>

      {enNegativo.length > 0 ? (
        <div className="mb-3">
          <Aviso tono="mal" titulo={`${enNegativo.length} producto(s) con stock negativo`}>
            Se vendió más de lo que el sistema creía tener. Eso es normal: el POS no bloquea una
            venta por falta de stock —con el cliente y el billete delante sería peor— pero conviene
            contar y ajustar.
          </Aviso>
        </div>
      ) : null}

      <div className="scroll-fino tarjeta min-h-0 flex-1 overflow-y-auto">
        {productos.length === 0 ? (
          <Vacio titulo="No hay productos cargados">
            El inventario es solo para lo físico: ceras, vapes, pipas, mallas, trimmers. Los
            servicios no llevan stock. Cargalos desde Catálogo.
          </Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-hueso-hondo text-left">
              <tr className="etiqueta">
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">Mínimo</th>
                <th className="px-3 py-2 text-right">Precio</th>
                <th className="px-3 py-2 text-right">Valorizado</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setAbierto(p)}
                  className="cursor-pointer border-t border-black/5 hover:bg-laton/5"
                >
                  <td className="px-3 py-2 font-semibold">{p.nombre}</td>
                  <td
                    className={`cifra px-3 py-2 text-right font-bold ${
                      p.enNegativo ? "text-mal" : p.bajoMinimo ? "text-aviso" : ""
                    }`}
                  >
                    {cantidad(p.stock)}
                  </td>
                  <td className="cifra px-3 py-2 text-right text-tinta/50">{p.stockMinimo}</td>
                  <td className="cifra px-3 py-2 text-right">{aTexto(p.precio)}</td>
                  <td className="cifra px-3 py-2 text-right text-tinta/60">{aTexto(p.valorizado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {abierto ? <FichaDeProducto producto={abierto} alCerrar={() => setAbierto(null)} /> : null}
    </div>
  );
}

function FichaDeProducto({
  producto,
  alCerrar,
}: {
  producto: ProductoConStock;
  alCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [accion, setAccion] = useState<"entrada" | "ajuste" | "merma" | null>(null);

  const kardex = useQuery({
    queryKey: ["kardex", producto.id],
    queryFn: () =>
      api.get<{ stock: number; movimientos: Movimiento[] }>(`/inventario/${producto.id}/kardex`),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["inventario"] });
    qc.invalidateQueries({ queryKey: ["kardex", producto.id] });
    qc.invalidateQueries({ queryKey: ["catalogo"] });
    setAccion(null);
  };

  return (
    <Modal titulo={producto.nombre} alCerrar={alCerrar} ancho="max-w-2xl">
      <div className="mb-3 flex items-center gap-3">
        <div className="tarjeta flex-1 p-3 text-center">
          <div className="etiqueta">Stock actual</div>
          <div className={`cifra text-3xl font-bold ${producto.enNegativo ? "text-mal" : ""}`}>
            {cantidad(kardex.data?.stock ?? producto.stock)}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <button className="boton-suave" onClick={() => setAccion("entrada")}>
            Entrada
          </button>
          <button className="boton-suave" onClick={() => setAccion("ajuste")}>
            Ajustar (conté)
          </button>
          <button className="boton-suave" onClick={() => setAccion("merma")}>
            Merma
          </button>
        </div>
      </div>

      {accion ? (
        <FormularioDeMovimiento
          producto={producto}
          accion={accion}
          alCancelar={() => setAccion(null)}
          alGuardar={refrescar}
        />
      ) : null}

      <h3 className="etiqueta mt-4 mb-1">Kardex</h3>
      <div className="scroll-fino max-h-80 overflow-y-auto rounded-lg border border-black/10">
        {(kardex.data?.movimientos.length ?? 0) === 0 ? (
          <p className="p-4 text-center text-sm text-tinta/50">Sin movimientos todavía.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {kardex.data!.movimientos.map((m, i) => (
                <tr key={i} className="border-b border-black/5">
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap text-tinta/50">
                    {fechaYHora(m.ts)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="text-xs font-semibold uppercase text-tinta/40">{m.origen}</span>
                    <span className="ml-2">{m.motivo}</span>
                  </td>
                  <td
                    className={`cifra px-2 py-1.5 text-right font-bold ${
                      m.cantidad > 0 ? "text-bien" : "text-mal"
                    }`}
                  >
                    {m.cantidad > 0 ? "+" : ""}
                    {cantidad(m.cantidad)}
                  </td>
                  <td className="cifra px-2 py-1.5 text-right text-tinta/60">{cantidad(m.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

function FormularioDeMovimiento({
  producto,
  accion,
  alCancelar,
  alGuardar,
}: {
  producto: ProductoConStock;
  accion: "entrada" | "ajuste" | "merma";
  alCancelar: () => void;
  alGuardar: () => void;
}) {
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");

  const textos = {
    entrada: {
      titulo: "Llegó mercadería",
      campo: "¿Cuántas unidades entraron?",
      ayuda: "Se suman al stock actual.",
      motivo: "Compra a proveedor",
    },
    ajuste: {
      titulo: "Conteo físico",
      campo: "¿Cuántas unidades hay de verdad?",
      // Se guardan las DOS cifras: sin lo que el sistema creía tener, un
      // ajuste no se puede auditar después.
      ayuda: `El stock pasa a valer esto. El sistema dice ${cantidad(producto.stock)}.`,
      motivo: "Conteo del mes",
    },
    merma: {
      titulo: "Merma",
      campo: "¿Cuántas unidades se perdieron?",
      ayuda: "Se restan del stock.",
      motivo: "Se rompió / se venció",
    },
  }[accion];

  const guardar = useMutation({
    mutationFn: () => {
      const n = Number(valor.replace(",", "."));
      if (accion === "entrada") return api.post("/inventario/entrada", { itemId: producto.id, cantidad: n, motivo });
      if (accion === "merma") return api.post("/inventario/merma", { itemId: producto.id, cantidad: n, motivo });
      return api.post("/inventario/ajuste", { itemId: producto.id, cantidadContada: n, motivo });
    },
    onSuccess: alGuardar,
  });

  const valido = Number(valor.replace(",", ".")) >= (accion === "ajuste" ? 0 : 0.001) && motivo.trim().length > 0;

  return (
    <div className="tarjeta space-y-3 p-3">
      <h3 className="font-bold">{textos.titulo}</h3>

      <label className="block">
        <span className="etiqueta mb-1 block">{textos.campo}</span>
        <input
          className="campo cifra text-right text-lg"
          autoFocus
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
        <span className="mt-1 block text-xs text-tinta/45">{textos.ayuda}</span>
      </label>

      <label className="block">
        <span className="etiqueta mb-1 block">Motivo (obligatorio)</span>
        <input
          className="campo"
          placeholder={textos.motivo}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>

      {guardar.error ? <Aviso tono="mal">{(guardar.error as Error).message}</Aviso> : null}

      <div className="flex gap-2">
        <button className="boton-suave flex-1" onClick={alCancelar}>
          Cancelar
        </button>
        <button
          className="boton-primario flex-1"
          disabled={!valido || guardar.isPending}
          onClick={() => guardar.mutate()}
        >
          Guardar
        </button>
      </div>
    </div>
  );
}
