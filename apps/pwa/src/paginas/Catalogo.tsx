/**
 * Catálogo: servicios y productos, y la lista de barberos.
 *
 * El código de cada ítem lo asigna el sistema (P0001 productos, S0001
 * servicios): en el Excel había códigos repetidos que volvían invendibles a
 * productos sin que nadie se enterara.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LayoutGrid, Package, Pencil, Plus, RotateCcw, Scissors, Search, UserRound, X } from "lucide-react";

import { api, FalloDeApi, type Barbero, type Item } from "../lib/api";
import { aCentimos, aTexto, aTextoConSimbolo } from "../lib/formato";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { Campo, EncabezadoPagina, Pagina, Pastilla, Segmentado } from "../componentes/Piezas";

const PESTANAS = [
  { id: "items", texto: "Servicios y productos", icono: LayoutGrid },
  { id: "barberos", texto: "Barberos", icono: UserRound },
] as const;

export function Catalogo() {
  const qc = useQueryClient();
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const pestana = ubicacion.hash === "#barberos" ? "barberos" : "items";
  const [editando, setEditando] = useState<Item | "nuevo" | null>(null);

  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Catálogo"
        descripcion={
          pestana === "items"
            ? "Lo que se vende en Cobrar. Los servicios no llevan stock; los productos sí y se descuentan al venderlos."
            : "Quién atiende. Al cobrar se elige el barbero de cada servicio para saber la producción de cada uno."
        }
        acciones={
          <>
            <Segmentado
              opciones={PESTANAS}
              valor={pestana}
              alCambiar={(v) => navegar({ hash: v === "barberos" ? "barberos" : "" }, { replace: true })}
            />
            {pestana === "items" ? (
              <button className="boton-primario" onClick={() => setEditando("nuevo")}>
                <Plus className="h-5 w-5" />
                Nuevo
              </button>
            ) : null}
          </>
        }
      />

      {pestana === "items" ? <ListaDeItems alAbrir={setEditando} alNuevo={() => setEditando("nuevo")} /> : <Barberos />}

      {editando ? (
        <FormularioDeItem
          item={editando === "nuevo" ? null : editando}
          alCerrar={() => setEditando(null)}
          alGuardar={() => {
            qc.invalidateQueries({ queryKey: ["catalogo"] });
            qc.invalidateQueries({ queryKey: ["inventario"] });
            setEditando(null);
          }}
        />
      ) : null}
    </Pagina>
  );
}

function ListaDeItems({ alAbrir, alNuevo }: { alAbrir: (i: Item) => void; alNuevo: () => void }) {
  const [verInactivos, setVerInactivos] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState<"todos" | "SERVICIO" | "PRODUCTO">("todos");

  const catalogo = useQuery({
    queryKey: ["catalogo", "admin", verInactivos],
    queryFn: () => api.get<{ items: Item[] }>(`/catalogo${verInactivos ? "?incluirInactivos=true" : ""}`),
  });

  const todos = catalogo.data?.items ?? [];
  const termino = busqueda.trim().toLowerCase();
  const items = todos.filter(
    (i) =>
      (tipo === "todos" || i.tipo === tipo) &&
      (!termino || `${i.codigo} ${i.nombre} ${i.categoria}`.toLowerCase().includes(termino)),
  );

  return (
    <div className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-linea p-4">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-tinta/35" />
          <input
            className="campo pl-12"
            placeholder="Buscar por nombre, código o categoría"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Segmentado
          opciones={[
            { id: "todos", texto: "Todos" },
            { id: "SERVICIO", texto: "Servicios", icono: Scissors },
            { id: "PRODUCTO", texto: "Productos", icono: Package },
          ]}
          valor={tipo}
          alCambiar={setTipo}
        />
        <label className="flex h-12 cursor-pointer items-center gap-3 px-2 text-tinta/70">
          <input
            type="checkbox"
            className="h-5 w-5 accent-tinta"
            checked={verInactivos}
            onChange={(e) => setVerInactivos(e.target.checked)}
          />
          Ver desactivados
        </label>
      </div>

      {catalogo.isLoading ? (
        <Vacio titulo="Cargando…" />
      ) : todos.length === 0 ? (
        <Vacio
          icono={LayoutGrid}
          titulo="El catálogo está vacío"
          accion={
            <button className="boton-primario" onClick={alNuevo}>
              <Plus className="h-5 w-5" />
              Crear el primer servicio o producto
            </button>
          }
        >
          Carga los servicios de la barbería (cortes, barba…) y los productos que venden (ceras, trimmers…).
        </Vacio>
      ) : items.length === 0 ? (
        <Vacio icono={Search} titulo="Nada coincide">
          Prueba con otro nombre o cambia el filtro.
        </Vacio>
      ) : (
        <div className="scroll-fino overflow-x-auto">
          <table className="tabla tabla-clic">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Tipo</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} onClick={() => alAbrir(i)} className={i.activo ? "" : "text-tinta/40"}>
                  <td className="cifra font-semibold">{i.codigo}</td>
                  <td>
                    <span className="font-medium">{i.nombre}</span>
                    {!i.activo ? (
                      <span className="ml-2">
                        <Pastilla>Desactivado</Pastilla>
                      </span>
                    ) : null}
                  </td>
                  <td className="text-tinta/65">{i.categoria}</td>
                  <td className="text-tinta/65">{i.tipo === "PRODUCTO" ? "Producto" : "Servicio"}</td>
                  <td className="cifra text-right font-semibold">{aTextoConSimbolo(i.precio)}</td>
                  <td className="cifra text-right">
                    {i.tipo === "PRODUCTO" ? (
                      <span className={i.stock! < 0 ? "font-semibold text-mal" : ""}>{i.stock}</span>
                    ) : (
                      <span className="text-tinta/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const [nombre, setNombre] = useState(item?.nombre ?? "");
  const [tipo, setTipo] = useState<"SERVICIO" | "PRODUCTO">(item?.tipo ?? "SERVICIO");
  const [categoria, setCategoria] = useState(item?.categoria ?? "");
  const [precio, setPrecio] = useState(item ? aTexto(item.precio) : "");
  const [stockMinimo, setStockMinimo] = useState(String(item?.stockMinimo ?? 0));
  const [stockInicial, setStockInicial] = useState("0");

  const siguiente = useQuery({
    queryKey: ["siguiente-codigo", tipo],
    queryFn: () => api.get<{ codigo: string }>(`/catalogo/siguiente-codigo?tipo=${tipo}`),
    enabled: !item,
  });

  const centimos = aCentimos(precio);
  const faltan: string[] = [];
  if (!nombre.trim()) faltan.push("el nombre");
  if (!categoria.trim()) faltan.push("la categoría");
  if (centimos === null || precio.trim() === "") faltan.push("el precio");

  const guardar = useMutation({
    mutationFn: async () => {
      const datos = {
        nombre,
        categoria,
        precio: centimos ?? 0,
        stockMinimo: tipo === "PRODUCTO" ? Number(stockMinimo) || 0 : undefined,
      };
      if (item) return api.patch(`/catalogo/${item.id}`, { ...datos, codigo: item.codigo });
      return api.post("/catalogo", {
        ...datos,
        tipo,
        stockInicial: tipo === "PRODUCTO" ? Number(stockInicial) || 0 : undefined,
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
      titulo={item ? "Editar" : "Nuevo servicio o producto"}
      subtitulo={item ? `${item.codigo} · ${item.nombre}` : undefined}
      alCerrar={alCerrar}
      pie={
        <div className="space-y-3">
          {faltan.length > 0 ? (
            <p className="ayuda text-center">Para guardar falta {faltan.join(", ").replace(/, ([^,]*)$/, " y $1")}.</p>
          ) : null}
          <div className="flex gap-3">
            {item ? (
              <button className={item.activo ? "boton-peligro" : "boton-suave"} onClick={() => desactivar.mutate()}>
                {item.activo ? "Desactivar" : "Reactivar"}
              </button>
            ) : null}
            <button className="boton-suave ml-auto" onClick={alCerrar}>
              Cancelar
            </button>
            <button
              className="boton-primario"
              disabled={faltan.length > 0 || guardar.isPending}
              onClick={() => guardar.mutate()}
            >
              <Check className="h-5 w-5" />
              {guardar.isPending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {fallo ? (
          <Aviso tono="mal" titulo={fallo.message}>
            {fallo.sugerencia}
          </Aviso>
        ) : null}

        {!item ? (
          <div>
            <span className="etiqueta mb-2 block">¿Qué es?</span>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { id: "SERVICIO", texto: "Servicio", detalle: "Corte, barba… No lleva stock.", icono: Scissors },
                  { id: "PRODUCTO", texto: "Producto", detalle: "Cera, trimmer… Lleva stock.", icono: Package },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTipo(t.id)}
                  className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                    tipo === t.id ? "border-tinta bg-tinta text-white" : "border-linea hover:bg-hueso"
                  }`}
                >
                  <t.icono className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>
                    <span className="block font-semibold">{t.texto}</span>
                    <span className={`block text-sm ${tipo === t.id ? "text-white/70" : "text-tinta/55"}`}>
                      {t.detalle}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <Campo etiqueta="Nombre">
          <input
            className="campo"
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={tipo === "SERVICIO" ? "Por ejemplo: Corte degradado" : "Por ejemplo: Cera mate"}
          />
        </Campo>

        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Categoría">
            <CampoCategoria valor={categoria} alCambiar={setCategoria} />
          </Campo>
          <Campo etiqueta="Precio">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta/40">S/</span>
              <input
                className="campo cifra pl-11 text-right"
                value={precio}
                inputMode="decimal"
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </Campo>
        </div>

        {tipo === "PRODUCTO" ? (
          <div className="grid grid-cols-2 gap-4">
            {!item ? (
              <Campo etiqueta="Unidades que hay hoy" ayuda="El stock con el que empieza.">
                <input
                  className="campo cifra text-right"
                  value={stockInicial}
                  inputMode="numeric"
                  onChange={(e) => setStockInicial(e.target.value)}
                />
              </Campo>
            ) : null}
            <Campo etiqueta="Avisar cuando queden" ayuda="Por debajo de esto, el sistema avisa.">
              <input
                className="campo cifra text-right"
                value={stockMinimo}
                inputMode="numeric"
                onChange={(e) => setStockMinimo(e.target.value)}
              />
            </Campo>
          </div>
        ) : null}

        <Campo
          etiqueta="Código"
          ayuda={
            item
              ? "Lo asignó el sistema. Es lo que se teclea o se escanea para vender."
              : "Lo asigna el sistema al guardar."
          }
        >
          <div className="campo cifra flex items-center bg-hueso text-tinta/65">
            {item ? item.codigo : (siguiente.data?.codigo ?? "…")}
          </div>
        </Campo>

        {item ? (
          <p className="ayuda">
            Cambiar el precio no afecta a las ventas ya hechas: cada una guardó el precio al que se vendió.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Categoría con autocompletado.
 *
 * Al tocarlo se despliegan las categorías que ya existen. Si lo escrito
 * coincide con una salvo mayúsculas, espacios o tildes, se usa la existente
 * (el servidor aplica la misma regla, así que no se cuela ningún duplicado).
 */
function CampoCategoria({ valor, alCambiar }: { valor: string; alCambiar: (v: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const refCampo = useRef<HTMLInputElement>(null);

  const categorias = useQuery({
    queryKey: ["catalogo", "categorias"],
    queryFn: () => api.get<{ categorias: string[] }>("/catalogo?incluirInactivos=true"),
  });

  const todas = categorias.data?.categorias ?? [];
  const clave = normalizar(valor);
  const filtradas = clave ? todas.filter((c) => normalizar(c).includes(clave)) : todas;
  const exacta = clave ? todas.find((c) => normalizar(c) === clave) : undefined;
  const limpio = valor.trim().replace(/\s+/g, " ");

  const rect = abierto ? refCampo.current?.getBoundingClientRect() : undefined;
  const haciaArriba = rect ? window.innerHeight - rect.bottom < 260 && rect.top > window.innerHeight - rect.bottom : false;

  function elegir(c: string) {
    alCambiar(c);
    setAbierto(false);
  }

  return (
    <div>
      <input
        ref={refCampo}
        className="campo"
        value={valor}
        autoComplete="off"
        placeholder="Elige o escribe"
        onFocus={() => setAbierto(true)}
        onClick={() => setAbierto(true)}
        onChange={(e) => {
          alCambiar(e.target.value);
          setAbierto(true);
        }}
        onBlur={() =>
          setTimeout(() => {
            setAbierto(false);
            alCambiar(exacta ?? limpio);
          }, 150)
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && abierto && filtradas.length > 0) {
            e.preventDefault();
            elegir(exacta ?? filtradas[0]);
          }
        }}
      />

      {abierto && rect && (filtradas.length > 0 || limpio) ? (
        // Posición fija: dentro del formulario con scroll quedaría recortada.
        <div
          className="scroll-fino fixed z-[60] overflow-y-auto rounded-xl border border-linea bg-white py-1 shadow-xl"
          style={{
            left: rect.left,
            width: rect.width,
            maxHeight: "15rem",
            ...(haciaArriba ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
          }}
        >
          {filtradas.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(c);
              }}
              className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-hueso ${
                c === exacta ? "font-semibold" : ""
              }`}
            >
              {c}
              {c === exacta ? <Check className="h-4 w-4 text-laton-oscuro" /> : null}
            </button>
          ))}
          {limpio && !exacta ? (
            <div className={`ayuda px-4 py-3 ${filtradas.length ? "border-t border-linea" : ""}`}>
              {filtradas.length ? "Si no eliges una, se crea la categoría " : "Se crea la categoría nueva "}
              <strong className="text-tinta">{limpio.charAt(0).toUpperCase() + limpio.slice(1)}</strong>
            </div>
          ) : exacta && exacta !== valor ? (
            <div className="ayuda border-t border-linea px-4 py-3">
              Ya existe como <strong className="text-tinta">{exacta}</strong>: se usará esa.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function Barberos() {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Barbero | null>(null);

  const barberos = useQuery({
    queryKey: ["barberos", "admin"],
    queryFn: () => api.get<{ barberos: Barbero[] }>("/barberos?incluirInactivos=true"),
  });
  const refrescar = () => qc.invalidateQueries({ queryKey: ["barberos"] });

  const crear = useMutation({
    mutationFn: () => api.post("/barberos", { nombre }),
    onSuccess: () => {
      setNombre("");
      refrescar();
    },
  });
  const cambiarEstado = useMutation({
    mutationFn: (b: Barbero) => api.post(`/barberos/${b.id}/${b.activo ? "desactivar" : "reactivar"}`),
    onSuccess: () => {
      setConfirmando(null);
      refrescar();
    },
  });

  const lista = barberos.data?.barberos ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="tarjeta overflow-hidden">
        {lista.length === 0 ? (
          <Vacio icono={UserRound} titulo="Todavía no hay barberos">
            Agrégalos con el formulario. Sirven para saber quién atendió cada servicio.
          </Vacio>
        ) : (
          <ul className="divide-y divide-linea">
            {lista.map((b) => (
              <li key={b.id} className="flex items-center gap-4 px-5 py-4">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-semibold ${
                    b.activo ? "bg-laton-claro text-laton-oscuro" : "bg-hueso text-tinta/35"
                  }`}
                >
                  {b.nombre.charAt(0).toUpperCase()}
                </span>
                {editando === b.id ? (
                  <RenombrarBarbero
                    barbero={b}
                    alTerminar={() => {
                      setEditando(null);
                      refrescar();
                    }}
                  />
                ) : (
                  <>
                    <span className={`min-w-0 flex-1 truncate text-lg font-medium ${b.activo ? "" : "text-tinta/40"}`}>
                      {b.nombre}
                    </span>
                    {!b.activo ? <Pastilla>Inactivo</Pastilla> : null}
                    <button className="boton-icono" onClick={() => setEditando(b.id)} aria-label={`Renombrar a ${b.nombre}`} title="Renombrar">
                      <Pencil className="h-5 w-5" />
                    </button>
                    {b.activo ? (
                      <button className="boton-suave boton-chico" onClick={() => setConfirmando(b)}>
                        Desactivar
                      </button>
                    ) : (
                      <button className="boton-suave boton-chico" onClick={() => cambiarEstado.mutate(b)}>
                        <RotateCcw className="h-4 w-4" />
                        Reactivar
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4">
        <div className="tarjeta p-5">
          <h2 className="mb-4 text-lg font-semibold">Agregar barbero</h2>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (nombre.trim()) crear.mutate();
            }}
          >
            <input
              className="campo"
              placeholder="Nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            <button type="submit" className="boton-primario w-full" disabled={!nombre.trim() || crear.isPending}>
              <Plus className="h-5 w-5" />
              Agregar
            </button>
          </form>
          {crear.error ? (
            <div className="mt-3">
              <Aviso tono="mal">{(crear.error as Error).message}</Aviso>
            </div>
          ) : null}
        </div>
        <Aviso tono="info">
          Solo se registra quién atendió, como dato para los reportes. <strong>No se calculan comisiones</strong>: en La
          Cúpula los barberos tienen sueldo fijo.
        </Aviso>
      </div>

      {confirmando ? (
        <Modal
          titulo={`¿Desactivar a ${confirmando.nombre}?`}
          alCerrar={() => setConfirmando(null)}
          pie={
            <div className="flex justify-end gap-3">
              <button className="boton-suave" onClick={() => setConfirmando(null)}>
                Cancelar
              </button>
              <button className="boton-primario" disabled={cambiarEstado.isPending} onClick={() => cambiarEstado.mutate(confirmando)}>
                Sí, desactivar
              </button>
            </div>
          }
        >
          <p className="text-tinta/75">
            Deja de aparecer al cobrar. Sus ventas anteriores y su producción en los reportes se conservan, y puedes
            reactivarlo cuando quieras.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function RenombrarBarbero({ barbero, alTerminar }: { barbero: Barbero; alTerminar: () => void }) {
  const [nombre, setNombre] = useState(barbero.nombre);
  const guardar = useMutation({
    mutationFn: () => api.patch(`/barberos/${barbero.id}`, { nombre }),
    onSuccess: alTerminar,
  });
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.select(), []);

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (nombre.trim()) guardar.mutate();
      }}
    >
      <input ref={campo} className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <button type="submit" className="boton-primario" disabled={!nombre.trim() || guardar.isPending}>
        Guardar
      </button>
      <button type="button" className="boton-icono" onClick={alTerminar} aria-label="Cancelar">
        <X className="h-5 w-5" />
      </button>
    </form>
  );
}
