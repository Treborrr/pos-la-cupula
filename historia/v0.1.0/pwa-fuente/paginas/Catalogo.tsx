/**
 * Catálogo: servicios y productos, y la lista de barberos.
 *
 * El sistema garantiza códigos únicos. En el Excel había tres repetidos
 * (`LANG`, `CEVC`, `MENU`) y eso volvía invendibles a tres productos sin que
 * nadie se enterara: la búsqueda devolvía siempre el primero.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, FalloDeApi, type Barbero, type Item } from "../lib/api";
import { aCentimos, aTexto } from "../lib/formato";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { Campo } from "../componentes/Piezas";

export function Catalogo() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Item | "nuevo" | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);

  const catalogo = useQuery({
    queryKey: ["catalogo", "admin", verInactivos],
    queryFn: () => api.get<{ items: Item[] }>(`/catalogo?incluirInactivos=${verInactivos}`),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["catalogo"] });
    setEditando(null);
  };

  return (
    <div className="flex h-full gap-3 p-3">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center gap-3">
          <h1 className="text-xl font-bold">Servicios y productos</h1>
          <label className="flex items-center gap-2 text-sm text-tinta/60">
            <input
              type="checkbox"
              checked={verInactivos}
              onChange={(e) => setVerInactivos(e.target.checked)}
            />
            Ver desactivados
          </label>
          <button className="boton-primario ml-auto" onClick={() => setEditando("nuevo")}>
            + Nuevo
          </button>
        </div>

        <div className="scroll-fino tarjeta min-h-0 flex-1 overflow-y-auto">
          {(catalogo.data?.items.length ?? 0) === 0 ? (
            <Vacio titulo="El catálogo está vacío">
              Carga los servicios de la barbería y los productos que venden (ceras, vapes, pipas,
              mallas, trimmers).
            </Vacio>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-hueso-hondo text-left">
                <tr className="etiqueta">
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {catalogo.data!.items.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setEditando(i)}
                    className={`cursor-pointer border-t border-black/5 hover:bg-laton/5 ${
                      i.activo ? "" : "text-tinta/35"
                    }`}
                  >
                    <td className="cifra px-3 py-2 font-semibold">{i.codigo}</td>
                    <td className="px-3 py-2">
                      {i.nombre}
                      {!i.activo ? <span className="ml-2 text-xs">(desactivado)</span> : null}
                    </td>
                    <td className="px-3 py-2 text-tinta/60">
                      {i.categoria}
                      <span className="ml-2 text-xs text-tinta/40">
                        {i.tipo === "PRODUCTO" ? "producto" : "servicio"}
                      </span>
                    </td>
                    <td className="cifra px-3 py-2 text-right font-semibold">{aTexto(i.precio)}</td>
                    <td className="cifra px-3 py-2 text-right">
                      {i.tipo === "PRODUCTO" ? (
                        <span className={i.stock! < 0 ? "font-bold text-mal" : ""}>{i.stock}</span>
                      ) : (
                        <span className="text-tinta/25">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <PanelBarberos />

      {editando ? (
        <FormularioDeItem
          item={editando === "nuevo" ? null : editando}
          alCerrar={() => setEditando(null)}
          alGuardar={refrescar}
        />
      ) : null}
    </div>
  );
}

function FormularioDeItem({
  item,
  alCerrar,
  alGuardar,
}: {
  item: Item | null;
  alCerrar: () => void;
  alGuardar: () => void;
}) {
  const [codigo, setCodigo] = useState(item?.codigo ?? "");
  const [nombre, setNombre] = useState(item?.nombre ?? "");
  const [tipo, setTipo] = useState<"SERVICIO" | "PRODUCTO">(item?.tipo ?? "SERVICIO");
  const [categoria, setCategoria] = useState(item?.categoria ?? "Barbería");
  const [precio, setPrecio] = useState(item ? aTexto(item.precio) : "");
  const [stockMinimo, setStockMinimo] = useState(String(item?.stockMinimo ?? 0));
  const [stockInicial, setStockInicial] = useState("0");

  const guardar = useMutation({
    mutationFn: async () => {
      const centimos = aCentimos(precio) ?? 0;
      if (item) {
        return api.patch(`/catalogo/${item.id}`, {
          codigo,
          nombre,
          categoria,
          precio: centimos,
          stockMinimo: tipo === "PRODUCTO" ? Number(stockMinimo) : undefined,
        });
      }
      return api.post("/catalogo", {
        codigo,
        nombre,
        tipo,
        categoria,
        precio: centimos,
        stockMinimo: tipo === "PRODUCTO" ? Number(stockMinimo) : undefined,
        stockInicial: tipo === "PRODUCTO" ? Number(stockInicial) : undefined,
      });
    },
    onSuccess: alGuardar,
  });

  const desactivar = useMutation({
    mutationFn: () => api.post(`/catalogo/${item!.id}/${item!.activo ? "desactivar" : "reactivar"}`),
    onSuccess: alGuardar,
  });

  const fallo = (guardar.error ?? desactivar.error) as FalloDeApi | undefined;

  return (
    <Modal
      titulo={item ? item.nombre : "Nuevo ítem"}
      alCerrar={alCerrar}
      pie={
        <div className="flex gap-2">
          {item ? (
            <button
              className={item.activo ? "boton-suave" : "boton-laton"}
              onClick={() => desactivar.mutate()}
            >
              {item.activo ? "Desactivar" : "Reactivar"}
            </button>
          ) : null}
          <button
            className="boton-primario flex-1"
            disabled={!codigo.trim() || !nombre.trim() || guardar.isPending}
            onClick={() => guardar.mutate()}
          >
            {guardar.isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {fallo ? (
          <Aviso tono="mal" titulo={fallo.message}>
            {fallo.sugerencia}
          </Aviso>
        ) : null}

        {!item ? (
          <div className="grid grid-cols-2 gap-2">
            {(["SERVICIO", "PRODUCTO"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTipo(t);
                  setCategoria(t === "SERVICIO" ? "Barbería" : "Productos");
                }}
                className={`boton ${tipo === t ? "boton-laton" : "boton-suave"}`}
              >
                {t === "SERVICIO" ? "Servicio" : "Producto"}
              </button>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-tinta/50">
          {tipo === "SERVICIO"
            ? "Un servicio no lleva stock: un corte de pelo no se descuenta de ningún inventario."
            : "Un producto sí lleva stock y se descuenta al venderlo."}
        </p>

        <Campo etiqueta="Código" ayuda="Único. Es lo que se teclea o se escanea para vender.">
          <input
            className="campo cifra"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="COR-D"
          />
        </Campo>

        <Campo etiqueta="Nombre">
          <input
            className="campo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="CORTE DEGRADADO"
          />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Categoría">
            <input className="campo" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
          </Campo>
          <Campo etiqueta="Precio (S/)">
            <input
              className="campo cifra text-right"
              value={precio}
              inputMode="decimal"
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="25.00"
            />
          </Campo>
        </div>

        {tipo === "PRODUCTO" ? (
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Stock mínimo" ayuda="Por debajo de esto, la pantalla avisa.">
              <input
                className="campo cifra text-right"
                value={stockMinimo}
                inputMode="numeric"
                onChange={(e) => setStockMinimo(e.target.value)}
              />
            </Campo>
            {!item ? (
              <Campo etiqueta="Stock inicial">
                <input
                  className="campo cifra text-right"
                  value={stockInicial}
                  inputMode="numeric"
                  onChange={(e) => setStockInicial(e.target.value)}
                />
              </Campo>
            ) : null}
          </div>
        ) : null}

        {item ? (
          <p className="text-xs text-tinta/45">
            Cambiar el precio no afecta a las ventas ya hechas: cada una guardó el precio al que se
            vendió.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function PanelBarberos() {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState("");

  const barberos = useQuery({
    queryKey: ["barberos", "admin"],
    queryFn: () => api.get<{ barberos: Barbero[] }>("/barberos?incluirInactivos=true"),
  });

  const crear = useMutation({
    mutationFn: () => api.post("/barberos", { nombre }),
    onSuccess: () => {
      setNombre("");
      qc.invalidateQueries({ queryKey: ["barberos"] });
    },
  });

  const desactivar = useMutation({
    mutationFn: (id: string) => api.post(`/barberos/${id}/desactivar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["barberos"] }),
  });

  return (
    <aside className="flex w-72 shrink-0 flex-col">
      <h2 className="mb-3 text-xl font-bold">Barberos</h2>

      <div className="tarjeta scroll-fino min-h-0 flex-1 overflow-y-auto p-2">
        {(barberos.data?.barberos.length ?? 0) === 0 ? (
          <p className="p-3 text-sm text-tinta/50">
            Todavía no hay barberos cargados. Sirven para saber quién atendió cada servicio.
          </p>
        ) : (
          barberos.data!.barberos.map((b) => (
            <div
              key={b.id}
              className={`flex items-center justify-between rounded-md px-2 py-2 ${
                b.activo ? "" : "text-tinta/35"
              }`}
            >
              <span className="font-semibold">{b.nombre}</span>
              {b.activo ? (
                <button
                  onClick={() => desactivar.mutate(b.id)}
                  className="text-xs text-tinta/40 hover:text-mal"
                >
                  quitar
                </button>
              ) : (
                <span className="text-xs">inactivo</span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="campo"
          placeholder="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && nombre.trim() && crear.mutate()}
        />
        <button className="boton-suave px-4" disabled={!nombre.trim()} onClick={() => crear.mutate()}>
          +
        </button>
      </div>

      <p className="mt-2 text-xs text-tinta/45">
        Solo se registra quién atendió, como dato para reportes.{" "}
        <strong>No se calculan comisiones</strong>: en La Cúpula los barberos tienen sueldo fijo.
      </p>
    </aside>
  );
}
