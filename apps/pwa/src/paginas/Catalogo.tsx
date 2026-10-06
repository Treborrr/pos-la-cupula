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
import { Check, LayoutGrid, Package, Pencil, Plus, RotateCcw, Scissors, Search, Tags, UserRound, X } from "lucide-react";

import { api, FalloDeApi, type Barbero, type Item } from "../lib/api";
import { aCentimos, aTexto, aTextoConSimbolo, margenLegible, montoOAusente } from "../lib/formato";
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

interface RespuestaCatalogo {
  items: Item[];
  categorias: string[];
  marcas: { marca: string; items: number }[];
  sinPrecio: number;
}

function ListaDeItems({ alAbrir, alNuevo }: { alAbrir: (i: Item) => void; alNuevo: () => void }) {
  const [verInactivos, setVerInactivos] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState<"todos" | "SERVICIO" | "PRODUCTO">("todos");
  const [marca, setMarca] = useState("");
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);
  const [completandoPrecios, setCompletandoPrecios] = useState(false);

  const catalogo = useQuery({
    queryKey: ["catalogo", "admin", verInactivos],
    queryFn: () => api.get<RespuestaCatalogo>(`/catalogo${verInactivos ? "?incluirInactivos=true" : ""}`),
  });

  const todos = catalogo.data?.items ?? [];
  const marcas = catalogo.data?.marcas ?? [];
  const sinPrecio = catalogo.data?.sinPrecio ?? 0;

  const termino = busqueda.trim().toLowerCase();
  const items = todos.filter(
    (i) =>
      (tipo === "todos" || i.tipo === tipo) &&
      (!marca || i.marca === marca) &&
      (!soloSinPrecio || i.precio === null) &&
      // La marca entra en la búsqueda: quien escribe "forajido" espera ver sus
      // ceras, aunque la palabra no esté en el nombre de ninguna.
      (!termino || `${i.codigo} ${i.marca} ${i.nombre} ${i.categoria}`.toLowerCase().includes(termino)),
  );

  return (
    <>
      {/* El aviso de precios faltantes va ARRIBA de la tabla y no escondido en
          una columna: con 119 de 137 productos sin precio, es el estado del
          catálogo, no un detalle de una fila. */}
      {sinPrecio > 0 ? (
        <div className="mb-6">
          <Aviso
            tono="aviso"
            titulo={`${sinPrecio} ${sinPrecio === 1 ? "ítem no tiene" : "ítems no tienen"} precio de lista`}
          >
            <p>
              <strong>No se pueden vender hasta que se lo pongas</strong>: no aparecen en la pantalla de cobro. Están
              en el catálogo y en el inventario, así que su stock sí se lleva. Ponles precio y pasan a la grilla.
            </p>
            <button className="boton-primario mt-3" onClick={() => setCompletandoPrecios(true)}>
              <Tags className="h-5 w-5" />
              Completar precios
            </button>
          </Aviso>
        </div>
      ) : null}

      <div className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-linea p-4">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-tinta/35" />
            <input
              className="campo pl-12"
              placeholder="Buscar por marca, nombre, código o categoría"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          {marcas.length > 0 ? (
            <select className="campo w-auto" value={marca} onChange={(e) => setMarca(e.target.value)}>
              <option value="">Todas las marcas · {marcas.length}</option>
              {marcas.map((m) => (
                <option key={m.marca} value={m.marca}>
                  {m.marca} · {m.items}
                </option>
              ))}
            </select>
          ) : null}

          <Segmentado
            opciones={[
              { id: "todos", texto: "Todos" },
              { id: "SERVICIO", texto: "Servicios", icono: Scissors },
              { id: "PRODUCTO", texto: "Productos", icono: Package },
            ]}
            valor={tipo}
            alCambiar={setTipo}
          />

          {sinPrecio > 0 ? (
            <label className="flex h-12 cursor-pointer items-center gap-3 px-2 text-tinta/70">
              <input
                type="checkbox"
                className="h-5 w-5 accent-tinta"
                checked={soloSinPrecio}
                onChange={(e) => setSoloSinPrecio(e.target.checked)}
              />
              Solo sin precio
            </label>
          ) : null}

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
            Carga los servicios de la barbería (cortes, barba…) y los productos que venden (ceras, vapes…). Si tienes
            muchos, conviene cargarlos de una vez con la plantilla de Excel desde Ajustes.
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
                  <th>Marca</th>
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th className="text-right">Compra</th>
                  <th className="text-right">Venta</th>
                  <th className="text-right">Margen</th>
                  <th className="text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} onClick={() => alAbrir(i)} className={i.activo ? "" : "text-tinta/40"}>
                    <td className="cifra font-semibold">{i.codigo}</td>
                    <td className="text-tinta/65">{i.marca || <span className="text-tinta/30">—</span>}</td>
                    <td>
                      <span className="font-medium">{i.nombre}</span>
                      {!i.activo ? (
                        <span className="ml-2">
                          <Pastilla>Desactivado</Pastilla>
                        </span>
                      ) : null}
                    </td>
                    <td className="text-tinta/65">{i.categoria}</td>
                    <td className="cifra text-right text-tinta/55">{montoOAusente(i.costo)}</td>
                    <td className="cifra text-right font-semibold">
                      {i.precio === null ? (
                        <span className="text-aviso">sin precio</span>
                      ) : (
                        aTextoConSimbolo(i.precio)
                      )}
                    </td>
                    <td className="cifra text-right text-tinta/55">{margenLegible(margenDe(i))}</td>
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

      {completandoPrecios ? (
        <CompletarPrecios
          items={todos.filter((i) => i.precio === null && i.activo)}
          alCerrar={() => setCompletandoPrecios(false)}
        />
      ) : null}
    </>
  );
}

/** Margen de un ítem con los dos datos cargados. `null` si falta alguno. */
function margenDe(i: Item): number | null {
  if (i.precio === null || i.costo === null || i.precio === 0) return null;
  return Math.round(((i.precio - i.costo) / i.precio) * 1000) / 10;
}

/**
 * Poner precio a muchos ítems de una vez.
 *
 * Existe porque el catálogo del cliente llegó con 119 productos sin precio, y
 * abrir 119 veces el formulario de edición no es una tarea que alguien vaya a
 * terminar. Van agrupados por marca —que es como está ordenada la cabeza de
 * quien los va a tipear, no alfabéticamente— y se guardan todos en una sola
 * tanda: si algo falla, no queda la mitad hecha.
 */
function CompletarPrecios({ items, alCerrar }: { items: Item[]; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});

  const escritos = Object.entries(valores)
    .map(([itemId, texto]) => ({ itemId, precio: aCentimos(texto), texto }))
    .filter((v) => v.texto.trim() !== "");
  const invalidos = escritos.filter((v) => v.precio === null);
  const listos = escritos.filter((v) => v.precio !== null) as { itemId: string; precio: number }[];

  const guardar = useMutation({
    mutationFn: () => api.post("/catalogo/precios", { precios: listos, motivo: "Carga de precios pendientes" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogo"] });
      qc.invalidateQueries({ queryKey: ["inventario"] });
      alCerrar();
    },
  });

  // Agrupados por marca, en el orden en que los va a tipear una persona que
  // tiene los productos delante.
  const porMarca = new Map<string, Item[]>();
  for (const i of items) {
    const clave = i.marca || "Sin marca";
    porMarca.set(clave, [...(porMarca.get(clave) ?? []), i]);
  }

  const fallo = guardar.error as FalloDeApi | undefined;

  return (
    <Modal
      titulo="Completar precios"
      subtitulo={`${items.length} ${items.length === 1 ? "ítem" : "ítems"} sin precio de lista`}
      alCerrar={alCerrar}
      pie={
        <div className="space-y-3">
          {invalidos.length > 0 ? (
            <p className="ayuda text-center text-mal">
              {invalidos.length} {invalidos.length === 1 ? "precio no es un número" : "precios no son números"}. Escribe
              solo la cifra, por ejemplo 35 o 35.50
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <span className="ayuda">
              {listos.length === 0
                ? "Escribe los precios que sepas; los demás pueden quedar para después."
                : `${listos.length} ${listos.length === 1 ? "precio listo" : "precios listos"} para guardar`}
            </span>
            <button className="boton-suave ml-auto" onClick={alCerrar}>
              Cancelar
            </button>
            <button
              className="boton-primario"
              disabled={listos.length === 0 || invalidos.length > 0 || guardar.isPending}
              onClick={() => guardar.mutate()}
            >
              <Check className="h-5 w-5" />
              {guardar.isPending ? "Guardando…" : `Guardar ${listos.length || ""}`.trim()}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {fallo ? (
          <Aviso tono="mal" titulo={fallo.message}>
            {fallo.sugerencia}
          </Aviso>
        ) : null}

        <p className="ayuda">
          No hace falta completarlos todos de una vez: lo que guardes queda, y los que dejes vacíos siguen apareciendo
          acá la próxima vez.
        </p>

        {[...porMarca.entries()].map(([marca, deLaMarca]) => (
          <div key={marca}>
            <h3 className="etiqueta mb-2 border-b border-linea pb-2">
              {marca} · {deLaMarca.length}
            </h3>
            <div className="divide-y divide-linea">
              {deLaMarca.map((i) => (
                <div key={i.id} className="flex items-center gap-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.nombre}</span>
                    <span className="ayuda cifra">
                      {i.codigo}
                      {i.costo !== null ? ` · compra ${aTextoConSimbolo(i.costo)}` : ""}
                      {i.tipo === "PRODUCTO" && i.stock !== null ? ` · ${i.stock} en stock` : ""}
                    </span>
                  </span>
                  <div className="relative w-36 shrink-0">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-tinta/40">
                      S/
                    </span>
                    <input
                      className="campo cifra pl-10 text-right"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={valores[i.id] ?? ""}
                      onChange={(e) => setValores((v) => ({ ...v, [i.id]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
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
  const [marca, setMarca] = useState(item?.marca ?? "");
  const [nombre, setNombre] = useState(item?.nombre ?? "");
  const [tipo, setTipo] = useState<"SERVICIO" | "PRODUCTO">(item?.tipo ?? "SERVICIO");
  const [categoria, setCategoria] = useState(item?.categoria ?? "");
  const [precio, setPrecio] = useState(item?.precio != null ? aTexto(item.precio) : "");
  const [costo, setCosto] = useState(item?.costo != null ? aTexto(item.costo) : "");
  const [stockMinimo, setStockMinimo] = useState(String(item?.stockMinimo ?? 0));
  const [stockInicial, setStockInicial] = useState("0");

  const siguiente = useQuery({
    queryKey: ["siguiente-codigo", tipo],
    queryFn: () => api.get<{ codigo: string }>(`/catalogo/siguiente-codigo?tipo=${tipo}`),
    enabled: !item,
  });

  // Vacío es válido en los dos precios y significa "no tiene / no se sabe", no
  // cero. Lo que no es válido es escribir algo que no sea un número.
  const sinPrecio = precio.trim() === "";
  const sinCosto = costo.trim() === "";
  const centimos = sinPrecio ? null : aCentimos(precio);
  const centimosCosto = sinCosto ? null : aCentimos(costo);

  const faltan: string[] = [];
  if (!nombre.trim()) faltan.push("el nombre");
  if (!categoria.trim()) faltan.push("la categoría");

  const malEscritos: string[] = [];
  if (!sinPrecio && centimos === null) malEscritos.push("el precio de venta");
  if (!sinCosto && centimosCosto === null) malEscritos.push("el precio de compra");

  const margen =
    centimos !== null && centimosCosto !== null && centimos > 0
      ? Math.round(((centimos - centimosCosto) / centimos) * 1000) / 10
      : null;

  const guardar = useMutation({
    mutationFn: async () => {
      const datos = {
        marca: marca.trim(),
        nombre,
        categoria,
        precio: centimos,
        costo: tipo === "PRODUCTO" ? centimosCosto : null,
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
          {malEscritos.length > 0 ? (
            <p className="ayuda text-center text-mal">
              Revisa {malEscritos.join(" y ")}: escribe solo el número, por ejemplo 35.50
            </p>
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
              disabled={faltan.length > 0 || malEscritos.length > 0 || guardar.isPending}
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

        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <Campo
            etiqueta="Marca"
            ayuda={tipo === "SERVICIO" ? "Déjala vacía: el servicio lo hace la barbería." : "NIVEL TRES, FORAJIDO, VIDA POD…"}
          >
            <CampoMarca valor={marca} alCambiar={setMarca} />
          </Campo>
          <Campo etiqueta="Nombre">
            <input
              className="campo"
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={tipo === "SERVICIO" ? "Por ejemplo: Corte degradado" : "Por ejemplo: Cera mate finish"}
            />
          </Campo>
        </div>

        {/* Cómo va a verse en el ticket y en la grilla de cobro. Se muestra
            porque marca y nombre se escriben en dos campos y se leen juntos: sin
            esto, nadie se da cuenta de que quedó "FORAJIDO FORAJIDO PASTA". */}
        {marca.trim() && nombre.trim() ? (
          <p className="ayuda">
            Se va a ver como <strong className="text-tinta">{`${marca.trim()} ${nombre.trim()}`}</strong>
            {tipo === "SERVICIO" ? " en pantalla; en el ticket, solo el nombre." : " en pantalla y en el ticket."}
          </p>
        ) : null}

        <Campo etiqueta="Categoría" ayuda="Agrupa los botones en la pantalla de cobro.">
          <CampoCategoria valor={categoria} alCambiar={setCategoria} />
        </Campo>

        <div className="grid grid-cols-2 gap-4">
          <Campo
            etiqueta="Precio de venta"
            ayuda={sinPrecio ? "Vacío: habrá que escribirlo al cobrar." : "A cuánto se vende."}
          >
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta/40">S/</span>
              <input
                className={`campo cifra pl-11 text-right ${sinPrecio ? "border-aviso" : ""}`}
                value={precio}
                inputMode="decimal"
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="sin precio"
              />
            </div>
          </Campo>

          {tipo === "PRODUCTO" ? (
            <Campo etiqueta="Precio de compra" ayuda="A cuánto lo compras. Es la base del margen.">
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta/40">S/</span>
                <input
                  className="campo cifra pl-11 text-right"
                  value={costo}
                  inputMode="decimal"
                  onChange={(e) => setCosto(e.target.value)}
                  placeholder="no lo sé"
                />
              </div>
            </Campo>
          ) : null}
        </div>

        {/* El margen en vivo: es lo que convierte dos números sueltos en una
            decisión. Y avisa del dedo más común, invertir compra y venta. */}
        {margen !== null ? (
          <p className={`ayuda ${margen < 0 ? "text-mal" : ""}`}>
            {margen < 0
              ? `Cuidado: se vendería a pérdida, ${aTextoConSimbolo(centimosCosto! - centimos!)} por unidad. ¿Están invertidos los precios?`
              : `Ganancia de ${aTextoConSimbolo(centimos! - centimosCosto!)} por unidad · margen ${margen}%`}
          </p>
        ) : null}

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
            Cambiar el precio o el costo no afecta a las ventas ya hechas: cada una guardó el precio al que se vendió y
            el costo que el producto tenía ese día.
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
  const categorias = useQuery({
    queryKey: ["catalogo", "categorias"],
    queryFn: () => api.get<RespuestaCatalogo>("/catalogo?incluirInactivos=true"),
  });

  return (
    <CampoConSugerencias
      valor={valor}
      alCambiar={alCambiar}
      opciones={categorias.data?.categorias ?? []}
      placeholder="Elige o escribe"
      nombreSingular="categoría"
      capitalizar
    />
  );
}

/**
 * Marca con autocompletado.
 *
 * Elegir de la lista en vez de teclear es lo que evita que "NIVEL TRES" y
 * "NIVEL TRES " terminen siendo dos marcas. El servidor unifica igual, pero verlo
 * antes de guardar ahorra la sorpresa.
 */
function CampoMarca({ valor, alCambiar }: { valor: string; alCambiar: (v: string) => void }) {
  const catalogo = useQuery({
    queryKey: ["catalogo", "marcas"],
    queryFn: () => api.get<RespuestaCatalogo>("/catalogo?incluirInactivos=true"),
  });

  return (
    <CampoConSugerencias
      valor={valor}
      alCambiar={alCambiar}
      opciones={(catalogo.data?.marcas ?? []).map((m) => m.marca)}
      placeholder="Sin marca"
      nombreSingular="marca"
    />
  );
}

/**
 * Un campo de texto con las opciones que ya existen al alcance.
 *
 * Es el mismo comportamiento para marca y categoría, y estaba escrito dos veces
 * en versiones anteriores de esta pantalla: la segunda copia se desincronizaba
 * de la primera cada vez que se corregía algo del despliegue.
 */
function CampoConSugerencias({
  valor,
  alCambiar,
  opciones,
  placeholder,
  nombreSingular,
  capitalizar = false,
}: {
  valor: string;
  alCambiar: (v: string) => void;
  opciones: string[];
  placeholder: string;
  nombreSingular: string;
  capitalizar?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const refCampo = useRef<HTMLInputElement>(null);

  const todas = opciones;
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
        placeholder={placeholder}
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
              {filtradas.length ? `Si no eliges una, se crea la ${nombreSingular} ` : `Se crea la ${nombreSingular} nueva `}
              <strong className="text-tinta">
                {capitalizar ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : limpio}
              </strong>
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
