/**
 * La pantalla de cobro. El 90% del uso del sistema ocurre aquí.
 *
 * Tres cosas que el Excel hacía mal y que esta pantalla existe para arreglar:
 *
 *  · La cantidad entraba SIEMPRE como 1, y corregirla exigía activar un modo
 *    especial y volver a hacer clic en la fila. Aquí se edita en la línea, con
 *    dos botones del tamaño de un dedo.
 *  · Agregar el mismo ítem dos veces creaba dos filas. Aquí suma cantidad.
 *  · El código había que teclearlo a ciegas y el error era "El Item no existe".
 *    Aquí hay grilla, buscador y pistola, y cuando algo no existe se dice qué
 *    hacer.
 */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, FalloDeApi, type Barbero, type Item, type Pago, type RespuestaEscaneo, type Venta } from "../lib/api";
import { aCentimos, aTexto, aTextoConSimbolo, cantidad as fmtCantidad } from "../lib/formato";
import { useAtajos, useEscaner } from "../lib/escaneo";
import { subtotalDe, totalDe, usarCarrito } from "../estado/carrito";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { PanelDePago } from "../componentes/PanelDePago";

export function Cobrar() {
  const qc = useQueryClient();
  const carrito = usarCarrito();

  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [mensaje, setMensaje] = useState<{ tono: "aviso" | "mal" | "bien"; texto: string } | null>(null);
  const [cobrada, setCobrada] = useState<{ venta: Venta; advertencias: string[]; vistaPrevia: string } | null>(null);
  const [ambiguo, setAmbiguo] = useState<Extract<RespuestaEscaneo, { tipo: "clienteAmbiguo" }> | null>(null);

  const refBusqueda = useRef<HTMLInputElement>(null);

  const catalogo = useQuery({
    queryKey: ["catalogo"],
    queryFn: () => api.get<{ items: Item[]; categorias: string[] }>("/catalogo"),
  });

  const barberos = useQuery({
    queryKey: ["barberos"],
    queryFn: () => api.get<{ barberos: Barbero[] }>("/barberos"),
  });

  const items = catalogo.data?.items ?? [];
  const subtotal = subtotalDe(carrito.lineas);
  const total = totalDe(carrito.lineas, carrito.descuento);
  const cubierto = pagos.reduce((a, p) => a + p.monto, 0);
  const puedeCobrar = carrito.lineas.length > 0 && pagos.length > 0 && cubierto === total && total >= 0;

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    return items.filter((i) => {
      if (categoria && i.categoria !== categoria) return false;
      if (!termino) return true;
      const texto = `${i.codigo} ${i.nombre}`.toLowerCase();
      return termino.split(/\s+/).every((p) => texto.includes(p));
    });
  }, [items, busqueda, categoria]);

  const cobro = useMutation({
    mutationFn: () =>
      api.post<{ venta: Venta; advertencias: string[]; impresion: { vistaPrevia: string } }>("/ventas", {
        lineas: carrito.lineas.map((l) => ({
          itemId: l.itemId,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          barberoId: l.barberoId,
        })),
        pagos,
        descuento: carrito.descuento,
        clienteId: carrito.clienteId,
        notas: carrito.notas || undefined,
        claveIdempotencia: carrito.claveIdempotencia,
      }),
    onSuccess: (r) => {
      setCobrada({ venta: r.venta, advertencias: r.advertencias, vistaPrevia: r.impresion.vistaPrevia });
      // `reiniciar` y no `vaciar`: estrena la clave de idempotencia, que es lo
      // que permite que el SIGUIENTE ticket sea un cobro distinto.
      carrito.reiniciar();
      setPagos([]);
      setBusqueda("");
      qc.invalidateQueries({ queryKey: ["estado"] });
      qc.invalidateQueries({ queryKey: ["catalogo"] });
    },
    onError: (e) => {
      setMensaje({
        tono: "mal",
        texto: e instanceof FalloDeApi ? `${e.message}${e.sugerencia ? ` ${e.sugerencia}` : ""}` : String(e),
      });
    },
  });

  function agregarItem(item: Item) {
    carrito.agregar(item);
    setMensaje(null);
    // Los pagos se invalidan al cambiar el total: dejarlos puestos haría que
    // "cuadra" mostrara un importe que ya no corresponde.
    setPagos([]);
  }

  async function alEscanear(valor: string) {
    try {
      const r = await api.get<RespuestaEscaneo>(`/escaneo?valor=${encodeURIComponent(valor)}`);

      if (r.tipo === "item") {
        agregarItem(r.item);
        setMensaje({ tono: "bien", texto: `${r.item.nombre} agregado` });
      } else if (r.tipo === "cliente") {
        carrito.ponerCliente(r.cliente.id, r.cliente.nombre);
        setMensaje({
          tono: "bien",
          texto: `Cliente: ${r.cliente.nombre}${r.exacto ? "" : " (identificado por nombre)"}`,
        });
      } else if (r.tipo === "clienteAmbiguo") {
        setAmbiguo(r);
      } else if (r.tipo === "venta") {
        setMensaje({
          tono: "aviso",
          texto: `Ese es el ticket ${r.venta.correlativo}. Para consultarlo o anularlo, ve a Ventas.`,
        });
      } else {
        setMensaje({ tono: "aviso", texto: `${r.mensaje} ${r.sugerencia ?? ""}` });
      }
    } catch (e) {
      setMensaje({ tono: "mal", texto: e instanceof Error ? e.message : "Falló la lectura" });
    }
  }

  useEscaner({ alEscanear, activo: !cobrada && !ambiguo });

  useAtajos({
    F2: () => refBusqueda.current?.focus(),
    F4: () => puedeCobrar && cobro.mutate(),
    Escape: () => {
      if (cobrada) setCobrada(null);
      else if (busqueda) setBusqueda("");
      else {
        carrito.vaciar();
        setPagos([]);
      }
    },
  });

  return (
    <div className="flex h-full">
      {/* ── Izquierda: catálogo ────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col p-3">
        <div className="mb-2 flex gap-2">
          <input
            ref={refBusqueda}
            className="campo"
            placeholder="Buscar servicio o producto, o teclear el código…  (F2)"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              // Enter con un único resultado lo agrega: es el flujo de quien
              // teclea el código y no quiere soltar el teclado.
              if (e.key === "Enter" && visibles.length === 1) {
                agregarItem(visibles[0]);
                setBusqueda("");
              }
            }}
          />
          {busqueda ? (
            <button className="boton-suave px-3" onClick={() => setBusqueda("")}>
              Limpiar
            </button>
          ) : null}
        </div>

        <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
          <Chip activo={categoria === null} onClick={() => setCategoria(null)}>
            Todo
          </Chip>
          {(catalogo.data?.categorias ?? []).map((c) => (
            <Chip key={c} activo={categoria === c} onClick={() => setCategoria(c)}>
              {c}
            </Chip>
          ))}
        </div>

        <div className="scroll-fino min-h-0 flex-1 overflow-y-auto">
          {catalogo.isLoading ? (
            <Vacio titulo="Cargando el catálogo…" />
          ) : visibles.length === 0 ? (
            <Vacio titulo={items.length === 0 ? "El catálogo está vacío" : "Nada coincide"}>
              {items.length === 0
                ? "Carga los servicios y productos desde la pantalla de Catálogo."
                : `No hay ningún ítem que coincida con "${busqueda}".`}
            </Vacio>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {visibles.map((item) => (
                <BotonDeItem key={item.id} item={item} onClick={() => agregarItem(item)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Derecha: el ticket ─────────────────────────────────────────── */}
      <aside className="flex w-[27rem] shrink-0 flex-col border-l border-black/10 bg-white">
        <div className="flex items-center justify-between border-b border-black/10 px-3 py-2">
          <h2 className="font-bold">Ticket</h2>
          <div className="flex items-center gap-2">
            {carrito.nombreCliente ? (
              <button
                onClick={() => carrito.ponerCliente(null, null)}
                className="rounded-md bg-laton/15 px-2 py-1 text-xs font-semibold text-laton"
                title="Quitar cliente"
              >
                {carrito.nombreCliente} ×
              </button>
            ) : null}
            {carrito.lineas.length > 0 ? (
              <button
                className="text-sm font-semibold text-tinta/50 hover:text-mal"
                onClick={() => {
                  carrito.vaciar();
                  setPagos([]);
                }}
              >
                Vaciar
              </button>
            ) : null}
          </div>
        </div>

        <div className="scroll-fino min-h-0 flex-1 overflow-y-auto">
          {carrito.lineas.length === 0 ? (
            <Vacio titulo="Ticket vacío">
              Toca un servicio, escribe su código o disparale con la pistola.
            </Vacio>
          ) : (
            carrito.lineas.map((linea, i) => (
              <LineaDelTicket
                key={`${linea.itemId}-${i}`}
                linea={linea}
                barberos={barberos.data?.barberos ?? []}
                alCambiar={() => setPagos([])}
                indice={i}
              />
            ))
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-black/10 p-3">
          {mensaje ? (
            <Aviso tono={mensaje.tono}>
              <div className="flex items-start justify-between gap-2">
                <span>{mensaje.texto}</span>
                <button onClick={() => setMensaje(null)} className="shrink-0 font-bold">
                  ×
                </button>
              </div>
            </Aviso>
          ) : null}

          <Descuento
            subtotal={subtotal}
            descuento={carrito.descuento}
            alCambiar={(c) => {
              carrito.ponerDescuento(c);
              setPagos([]);
            }}
          />

          <div className="flex items-baseline justify-between">
            <span className="text-lg font-bold">TOTAL</span>
            <span className="cifra text-3xl font-bold">{aTextoConSimbolo(total)}</span>
          </div>

          <PanelDePago total={total} pagos={pagos} alCambiar={setPagos} />

          <button
            className="boton-primario w-full text-lg"
            disabled={!puedeCobrar || cobro.isPending}
            onClick={() => cobro.mutate()}
          >
            {cobro.isPending ? "Cobrando…" : `Cobrar ${aTextoConSimbolo(total)}  (F4)`}
          </button>
        </div>
      </aside>

      {cobrada ? <VentaCobrada {...cobrada} alCerrar={() => setCobrada(null)} /> : null}

      {ambiguo ? (
        <ElegirCliente
          info={ambiguo}
          alElegir={(c) => {
            carrito.ponerCliente(c.id, c.nombre);
            setAmbiguo(null);
          }}
          alCerrar={() => setAmbiguo(null)}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
        activo ? "bg-tinta text-hueso" : "bg-black/5 text-tinta/70 hover:bg-black/10"
      }`}
    >
      {children}
    </button>
  );
}

function BotonDeItem({ item, onClick }: { item: Item; onClick: () => void }) {
  const sinStock = item.tipo === "PRODUCTO" && item.stock !== null && item.stock <= 0;

  return (
    <button
      onClick={onClick}
      className="tarjeta flex min-h-24 flex-col justify-between p-3 text-left transition-transform hover:border-laton hover:shadow-md active:scale-[0.98]"
    >
      <span className="line-clamp-2 text-sm leading-tight font-semibold">{item.nombre}</span>
      <span className="mt-2 flex items-end justify-between">
        <span className="cifra text-lg font-bold">{aTexto(item.precio)}</span>
        {item.tipo === "PRODUCTO" ? (
          // El stock se muestra pero NO bloquea: negarse a cobrar con el
          // cliente delante es peor que un inventario desfasado.
          <span className={`text-xs font-semibold ${sinStock ? "text-mal" : "text-tinta/40"}`}>
            {item.stock} u.
          </span>
        ) : null}
      </span>
    </button>
  );
}

function LineaDelTicket({
  linea,
  indice,
  barberos,
  alCambiar,
}: {
  linea: ReturnType<typeof usarCarrito.getState>["lineas"][number];
  indice: number;
  barberos: Barbero[];
  alCambiar: () => void;
}) {
  const carrito = usarCarrito();
  const [editandoPrecio, setEditandoPrecio] = useState(false);
  const [precioTexto, setPrecioTexto] = useState(aTexto(linea.precioUnitario));
  const ajustado = linea.precioUnitario !== linea.precioLista;

  return (
    <div className="border-b border-black/5 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 text-sm leading-tight font-semibold">{linea.nombre}</span>
        <button
          onClick={() => {
            carrito.quitar(indice);
            alCambiar();
          }}
          className="shrink-0 text-lg leading-none text-tinta/30 hover:text-mal"
          aria-label="Quitar"
        >
          ×
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {/* Cantidad editable EN LA LÍNEA. Éste es el arreglo del peor defecto
            de uso del Excel. */}
        <div className="flex items-center rounded-lg border border-black/15">
          <button
            className="h-10 w-10 text-xl font-bold text-tinta/60 hover:bg-black/5"
            onClick={() => {
              carrito.cambiarCantidad(indice, linea.cantidad - 1);
              alCambiar();
            }}
          >
            −
          </button>
          <input
            className="cifra h-10 w-12 border-x border-black/10 text-center font-semibold outline-none"
            value={fmtCantidad(linea.cantidad)}
            inputMode="decimal"
            onChange={(e) => {
              const n = Number(e.target.value.replace(",", "."));
              if (Number.isFinite(n)) {
                carrito.cambiarCantidad(indice, n);
                alCambiar();
              }
            }}
          />
          <button
            className="h-10 w-10 text-xl font-bold text-tinta/60 hover:bg-black/5"
            onClick={() => {
              carrito.cambiarCantidad(indice, linea.cantidad + 1);
              alCambiar();
            }}
          >
            +
          </button>
        </div>

        {editandoPrecio ? (
          <input
            autoFocus
            className="campo cifra w-24 py-2 text-right"
            value={precioTexto}
            inputMode="decimal"
            onChange={(e) => setPrecioTexto(e.target.value)}
            onBlur={() => {
              const c = aCentimos(precioTexto);
              if (c !== null) {
                carrito.cambiarPrecio(indice, c);
                alCambiar();
              }
              setEditandoPrecio(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        ) : (
          <button
            onClick={() => {
              setPrecioTexto(aTexto(linea.precioUnitario));
              setEditandoPrecio(true);
            }}
            className={`cifra rounded-md px-2 py-2 text-sm hover:bg-black/5 ${ajustado ? "font-bold text-laton" : "text-tinta/60"}`}
            title={ajustado ? `Precio de lista: ${aTexto(linea.precioLista)}` : "Tocar para ajustar el precio"}
          >
            × {aTexto(linea.precioUnitario)}
            {ajustado ? " ✎" : ""}
          </button>
        )}

        <span className="cifra ml-auto text-lg font-bold">
          {aTexto(Math.round(linea.precioUnitario * linea.cantidad))}
        </span>
      </div>

      {barberos.length > 0 ? (
        <select
          className="mt-1.5 w-full rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-xs text-tinta/70"
          value={linea.barberoId ?? ""}
          onChange={(e) => carrito.cambiarBarbero(indice, e.target.value || null)}
        >
          <option value="">¿Quién atendió? (opcional)</option>
          {barberos.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nombre}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function Descuento({
  subtotal,
  descuento,
  alCambiar,
}: {
  subtotal: number;
  descuento: number;
  alCambiar: (centimos: number) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");

  if (!abierto && descuento === 0) {
    return (
      <button
        className="text-xs font-semibold text-tinta/40 hover:text-laton"
        onClick={() => setAbierto(true)}
        disabled={subtotal === 0}
      >
        + Aplicar descuento
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-tinta/60">Descuento</span>
      <input
        className="campo cifra flex-1 py-2 text-right"
        placeholder="0.00"
        inputMode="decimal"
        value={texto}
        autoFocus
        onChange={(e) => {
          setTexto(e.target.value);
          const c = aCentimos(e.target.value);
          alCambiar(c === null ? 0 : Math.min(c, subtotal));
        }}
      />
      <button
        className="text-lg text-tinta/40 hover:text-mal"
        onClick={() => {
          setTexto("");
          alCambiar(0);
          setAbierto(false);
        }}
      >
        ×
      </button>
    </div>
  );
}

function VentaCobrada({
  venta,
  advertencias,
  vistaPrevia,
  alCerrar,
}: {
  venta: Venta;
  advertencias: string[];
  vistaPrevia: string;
  alCerrar: () => void;
}) {
  return (
    <Modal
      titulo={`Cobrado · ${venta.correlativo}`}
      alCerrar={alCerrar}
      pie={
        <button className="boton-primario w-full" onClick={alCerrar} autoFocus>
          Siguiente venta (Esc)
        </button>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-bien/10 px-4 py-3 text-center">
          <div className="cifra text-3xl font-bold text-bien">{aTextoConSimbolo(venta.total)}</div>
          <div className="text-sm text-bien/80">{venta.pagos.map((p) => p.medio).join(" + ")}</div>
        </div>

        {venta.pagos
          .filter((p) => p.recibido !== undefined && p.recibido > p.monto)
          .map((p, i) => (
            <div key={i} className="rounded-lg bg-laton/15 px-4 py-3 text-center">
              <div className="etiqueta text-laton">Vuelto</div>
              <div className="cifra text-2xl font-bold text-laton">
                {aTextoConSimbolo(p.recibido! - p.monto)}
              </div>
            </div>
          ))}

        {advertencias.map((a, i) => (
          <Aviso key={i} tono="aviso" titulo="Atención">
            {a}
          </Aviso>
        ))}

        <details>
          <summary className="cursor-pointer text-sm font-semibold text-tinta/60">
            Ver el ticket
          </summary>
          {/* La ticketera todavía no está configurada (falta el modelo): el
              ticket se arma igual y se puede revisar aquí. */}
          <pre className="mt-2 overflow-x-auto rounded-lg bg-tinta p-3 text-[11px] leading-tight text-hueso">
            {vistaPrevia}
          </pre>
        </details>
      </div>
    </Modal>
  );
}

function ElegirCliente({
  info,
  alElegir,
  alCerrar,
}: {
  info: Extract<RespuestaEscaneo, { tipo: "clienteAmbiguo" }>;
  alElegir: (c: { id: string; nombre: string }) => void;
  alCerrar: () => void;
}) {
  return (
    <Modal titulo="¿Cuál de todos?" alCerrar={alCerrar}>
      <Aviso tono="aviso">
        {info.mensaje} El QR de la tarjeta de fidelidad lleva el <strong>nombre</strong>, no un
        identificador único, así que dos personas que se llaman igual no se pueden distinguir solas.
      </Aviso>

      <div className="mt-3 space-y-2">
        {info.candidatos.map((c) => (
          <button
            key={c.id}
            onClick={() => alElegir(c)}
            className="tarjeta flex w-full items-center justify-between p-3 text-left hover:border-laton"
          >
            <span>
              <span className="font-semibold">{c.nombre}</span>
              {c.telefono ? <span className="ml-2 text-sm text-tinta/50">{c.telefono}</span> : null}
            </span>
            <span className="text-sm text-tinta/50">
              {c.visitas} visita{c.visitas === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
