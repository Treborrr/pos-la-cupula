/**
 * La pantalla de cobro. El 90% del uso del sistema ocurre aquí.
 *
 * Está pensada como un recorrido de tres pasos que siempre están a la vista
 * (agregar, forma de pago, cobrar), con una línea que dice qué falta. Quien
 * la usa por primera vez no tiene que adivinar el siguiente movimiento.
 *
 * Tres cosas que el Excel hacía mal y que esta pantalla arregla:
 *  · La cantidad se edita en la línea, con botones del tamaño de un dedo.
 *  · Agregar el mismo ítem dos veces suma cantidad en vez de duplicar la fila.
 *  · Cuando algo no existe, se dice qué hacer.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  LayoutGrid,
  Lock,
  Minus,
  Pencil,
  Percent,
  Plus,
  Printer,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";

import {
  api,
  FalloDeApi,
  type Barbero,
  type Cliente,
  type EstadoGeneral,
  type Item,
  type Pago,
  type ResultadoImpresion,
  type RespuestaEscaneo,
  type Venta,
} from "../lib/api";
import { aCentimos, aTexto, aTextoConSimbolo, cantidad as fmtCantidad, nombreConMarca } from "../lib/formato";
import { useAtajos, useEscaner } from "../lib/escaneo";
import { abrirLector, esQrDeTicket } from "../lib/lector";
import { subtotalDe, totalDe, usarCarrito } from "../estado/carrito";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { BotonesDeMedio, DetalleDePagos, MEDIOS } from "../componentes/PanelDePago";
import { CampoCliente, normalizarNombre } from "../componentes/CampoCliente";
import { CampoBarbero } from "../componentes/CampoBarbero";

interface VentaRecienCobrada {
  venta: Venta;
  advertencias: string[];
  impresion: ResultadoImpresion;
}

export function Cobrar() {
  const qc = useQueryClient();
  const carrito = usarCarrito();

  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [mensaje, setMensaje] = useState<{ tono: "aviso" | "mal" | "bien"; texto: string } | null>(null);
  const [cobrada, setCobrada] = useState<VentaRecienCobrada | null>(null);
  const [ambiguo, setAmbiguo] = useState<Extract<RespuestaEscaneo, { tipo: "clienteAmbiguo" }> | null>(null);

  const refBusqueda = useRef<HTMLInputElement>(null);
  const refDetallePago = useRef<HTMLDivElement>(null);

  const catalogo = useQuery({
    queryKey: ["catalogo"],
    queryFn: () => api.get<{ items: Item[]; categorias: string[] }>("/catalogo"),
  });

  const barberos = useQuery({
    queryKey: ["barberos"],
    queryFn: () => api.get<{ barberos: Barbero[] }>("/barberos"),
  });

  const estado = useQuery({ queryKey: ["estado"], queryFn: () => api.get<EstadoGeneral>("/estado") });

  const items = catalogo.data?.items ?? [];
  const barberosActivos = barberos.data?.barberos ?? [];
  const hayServicios = carrito.lineas.some((l) => l.tipo === "SERVICIO");
  const subtotal = subtotalDe(carrito.lineas);
  const total = totalDe(carrito.lineas, carrito.descuento);
  const cubierto = pagos.reduce((a, p) => a + p.monto, 0);
  const falta = total - cubierto;
  const efectivoCorto = pagos.find((p) => p.medio === "EFECTIVO" && p.recibido !== undefined && p.recibido < p.monto);
  const hayLineas = carrito.lineas.length > 0;
  const totalEnCero = hayLineas && total === 0;
  const pagoListo = pagos.length > 0 && falta === 0 && !efectivoCorto;
  const clienteListo = Boolean(carrito.clienteId) || (carrito.nombreCliente ?? "").trim().length >= 2;
  const puedeCobrar = hayLineas && clienteListo && pagoListo && total > 0;

  /**
   * Cuántos ítems quedan fuera de la grilla por no tener precio.
   *
   * Se cuenta sobre el catálogo COMPLETO y no sobre lo filtrado: el aviso es
   * sobre el estado del catálogo, no sobre la búsqueda en curso.
   */
  const sinPrecio = useMemo(() => items.filter((i) => i.precio === null).length, [items]);

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    return items.filter((i) => {
      // Sin precio de lista no se puede vender, así que no se muestra: un botón
      // que al tocarlo siempre falla es peor que no tener el botón. Están en
      // Catálogo, que es donde se resuelve.
      if (i.precio === null) return false;
      if (categoria && i.categoria !== categoria) return false;
      if (!termino) return true;
      // La marca entra en la búsqueda: quien escribe "forajido" espera ver sus
      // ceras aunque la palabra no esté en el nombre de ninguna.
      const texto = `${i.codigo} ${i.marca} ${i.nombre}`.toLowerCase();
      return termino.split(/\s+/).every((p) => texto.includes(p));
    });
  }, [items, busqueda, categoria]);

  const cobro = useMutation({
    mutationFn: async () => {
      const clienteId = carrito.clienteId ?? (await registrarCliente(carrito.nombreCliente ?? ""));
      carrito.ponerCliente(clienteId, carrito.nombreCliente);
      return api.post<VentaRecienCobrada>("/ventas", {
        lineas: carrito.lineas.map((l) => ({
          itemId: l.itemId,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          // El barbero es uno por venta, pero el evento lo guarda línea por
          // línea: se copia a los servicios. Los productos no los "atiende"
          // nadie, así que van en null como siempre.
          barberoId: l.tipo === "SERVICIO" ? carrito.barberoId : null,
        })),
        pagos,
        descuento: carrito.descuento,
        clienteId,
        notas: carrito.notas || undefined,
        claveIdempotencia: carrito.claveIdempotencia,
      });
    },
    onSuccess: (r) => {
      setCobrada({ venta: r.venta, advertencias: r.advertencias, impresion: r.impresion });
      // `reiniciar` y no `vaciar`: estrena la clave de idempotencia, que es lo
      // que permite que el SIGUIENTE ticket sea un cobro distinto.
      carrito.reiniciar();
      setPagos([]);
      setBusqueda("");
      setMensaje(null);
      qc.invalidateQueries({ queryKey: ["estado"] });
      qc.invalidateQueries({ queryKey: ["catalogo"] });
      qc.invalidateQueries({ queryKey: ["ventas"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e) => {
      setMensaje({
        tono: "mal",
        texto: e instanceof FalloDeApi ? `${e.message}${e.sugerencia ? ` ${e.sugerencia}` : ""}` : String(e),
      });
    },
  });

  /** Registra el cliente nuevo; si otro lo creó recién, usa ese. */
  async function registrarCliente(nombre: string): Promise<string> {
    try {
      const r = await api.post<{ cliente: Cliente }>("/clientes", { nombre: nombre.trim() });
      return r.cliente.id;
    } catch (e) {
      if (e instanceof FalloDeApi && e.info.codigo === "CLIENTE_REPETIDO") {
        const r = await api.get<{ clientes: Cliente[] }>(`/clientes?q=${encodeURIComponent(nombre)}&limite=50`);
        const mismo = r.clientes.find((c) => normalizarNombre(c.nombre) === normalizarNombre(nombre));
        if (mismo) return mismo.id;
      }
      throw e;
    }
  }

  function agregarItem(item: Item) {
    // Un ítem sin precio no se vende. Puede llegar acá por la pistola de
    // escaneo aunque no esté en la grilla, así que se explica en vez de no
    // hacer nada: un toque que no produce efecto parece que el sistema falló.
    if (item.precio === null) {
      setMensaje({
        tono: "aviso",
        texto: `"${item.nombreCompleto}" todavía no tiene precio y no se puede vender. Ponle precio desde Catálogo.`,
      });
      return;
    }
    carrito.agregar(item);
    setMensaje(null);
    // Los pagos se invalidan al cambiar el total: dejarlos puestos haría que
    // "cuadra" mostrara un importe que ya no corresponde.
    setPagos([]);
  }

  async function alEscanear(valor: string) {
    const ticket = esQrDeTicket(valor);
    if (ticket) {
      abrirLector(ticket);
      return;
    }
    try {
      const r = await api.get<RespuestaEscaneo>(`/escaneo?valor=${encodeURIComponent(valor)}`);

      if (r.tipo === "item") {
        agregarItem(r.item);
        setMensaje({ tono: "bien", texto: `${r.item.nombreCompleto} agregado` });
      } else if (r.tipo === "cliente") {
        carrito.ponerCliente(r.cliente.id, r.cliente.nombre);
        setMensaje({
          tono: "bien",
          texto: `Cliente: ${r.cliente.nombre}${r.exacto ? "" : " (identificado por nombre)"}`,
        });
      } else if (r.tipo === "clienteAmbiguo") {
        setAmbiguo(r);
      } else if (r.tipo === "venta") {
        abrirLector(r.venta.correlativo);
      } else {
        setMensaje({ tono: "aviso", texto: `${r.mensaje} ${r.sugerencia ?? ""}` });
      }
    } catch (e) {
      setMensaje({ tono: "mal", texto: e instanceof Error ? e.message : "Falló la lectura" });
    }
  }

  useEscaner({ alEscanear, activo: !cobrada && !ambiguo });

  useAtajos(
    {
      F2: () => refBusqueda.current?.focus(),
      F4: () => puedeCobrar && !cobro.isPending && cobro.mutate(),
      Escape: () => {
        if (cobrada) setCobrada(null);
        else if (busqueda) setBusqueda("");
      },
    },
    !ambiguo,
  );

  // ── Guía: qué paso toca y qué falta ─────────────────────────────────────
  const pasoActual = !hayLineas ? 1 : !clienteListo ? 2 : !pagoListo ? 3 : 4;
  const guia = !hayLineas
    ? "Toca un servicio o producto de la izquierda, o escanéalo con la pistola."
    : !clienteListo
      ? "Escribe el nombre del cliente."
      : totalEnCero
      ? "El total es S/ 0.00. El sistema no registra ventas sin monto: revisa el precio o el descuento."
      : pagos.length === 0
      ? "Elige cómo paga el cliente."
      : falta > 0
        ? `Faltan ${aTextoConSimbolo(falta)} por cubrir.`
        : falta < 0
          ? `Los pagos suman ${aTextoConSimbolo(-falta)} de más.`
          : efectivoCorto
            ? "El efectivo que entrega no alcanza para el monto."
            : "Todo listo. Cobra con el botón o con la tecla F4.";

  const cajaCerrada = estado.data && !estado.data.turnoAbierto;

  // Al elegir un medio, el detalle (monto, "paga con", vuelto) se trae a la
  // vista: en pantallas bajas quedaría escondido debajo de las líneas.
  useEffect(() => {
    if (pagos.length > 0) refDetallePago.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [pagos.length]);

  return (
    <div className="scroll-fino flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      {/* ── Izquierda: catálogo ────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col px-4 pt-4 md:px-6 md:pt-6 lg:min-h-0 lg:flex-1 xl:px-8">
        <div className="mb-4 flex gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-tinta/35" />
            <input
              ref={refBusqueda}
              className="campo h-14 pl-12 text-lg"
              placeholder="Buscar por nombre o código"
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
              <button
                onClick={() => setBusqueda("")}
                className="boton-icono absolute top-1/2 right-1.5 -translate-y-1/2"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-5 w-5" />
              </button>
            ) : (
              <span className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 items-center gap-1.5 text-sm text-tinta/35 lg:flex">
                <ScanLine className="h-4 w-4" /> o escanea · F2
              </span>
            )}
          </div>
        </div>

        {(catalogo.data?.categorias.length ?? 0) > 1 ? (
          <div className="scroll-fino mb-4 flex gap-2 overflow-x-auto pb-1">
            <Chip activo={categoria === null} onClick={() => setCategoria(null)}>
              Todo
            </Chip>
            {catalogo.data!.categorias.map((c) => (
              <Chip key={c} activo={categoria === c} onClick={() => setCategoria(c)}>
                {c}
              </Chip>
            ))}
          </div>
        ) : null}

        {/* Por qué faltan productos en la grilla. Sin esta línea, el cajero
            busca una cera que sabe que está en el depósito, no la encuentra, y
            concluye que el sistema perdió el catálogo. */}
        {sinPrecio > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-aviso/30 bg-aviso/5 px-4 py-3">
            <span className="font-semibold text-aviso">
              {sinPrecio} {sinPrecio === 1 ? "producto no aparece" : "productos no aparecen"} acá
            </span>
            <span className="ayuda">
              No tienen precio, así que no se pueden vender todavía.
            </span>
            <Link to="/catalogo" className="boton-suave boton-chico ml-auto">
              Ponerles precio
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : null}

        <div className="scroll-fino -mx-1 px-1 pb-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {catalogo.isLoading ? (
            <Vacio titulo="Cargando el catálogo…" />
          ) : items.length === 0 ? (
            <Vacio
              icono={LayoutGrid}
              titulo="Todavía no hay nada para vender"
              accion={
                <Link to="/catalogo" className="boton-primario">
                  Cargar servicios y productos
                  <ArrowRight className="h-5 w-5" />
                </Link>
              }
            >
              Primero carga los servicios y productos con sus precios. Después aparecen aquí para cobrarlos con
              un toque.
            </Vacio>
          ) : visibles.length === 0 ? (
            <Vacio icono={Search} titulo="Nada coincide">
              No hay ningún servicio o producto que coincida con «{busqueda}».
            </Vacio>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
              {visibles.map((item) => (
                <BotonDeItem
                  key={item.id}
                  item={item}
                  enTicket={carrito.lineas.filter((l) => l.itemId === item.id).reduce((a, l) => a + l.cantidad, 0)}
                  onClick={() => agregarItem(item)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Derecha: la venta ──────────────────────────────────────────── */}
      <aside id="venta-actual" className="flex shrink-0 flex-col border-t border-linea bg-white lg:w-[27rem] lg:border-t-0 lg:border-l 2xl:w-[31rem]">
        <div className="shrink-0 border-b border-linea px-5 pt-3 pb-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-3 text-xl font-semibold">
              Venta actual
              {cajaCerrada ? (
                <Link
                  to="/caja"
                  className="pastilla bg-hueso-hondo text-tinta/65 hover:text-tinta"
                  title="Se puede cobrar, pero conviene abrir el turno"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Caja cerrada
                </Link>
              ) : null}
            </h2>
            {hayLineas ? (
              <button
                className="boton-fantasma boton-chico text-tinta/55 hover:text-mal"
                onClick={() => {
                  carrito.vaciar();
                  setPagos([]);
                  setMensaje(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Vaciar
              </button>
            ) : null}
          </div>
          <Pasos actual={pasoActual} />

          <div className="mt-3">
            <CampoCliente
              clienteId={carrito.clienteId}
              nombre={carrito.nombreCliente ?? ""}
              alCambiar={carrito.ponerCliente}
            />
          </div>

          {/* Solo si hay servicios en el ticket: a un producto suelto no lo
              atiende nadie, y preguntarlo sería ruido. */}
          {barberosActivos.length > 0 && hayServicios ? (
            <div className="mt-3">
              <CampoBarbero
                barberos={barberosActivos}
                barberoId={carrito.barberoId}
                alCambiar={carrito.ponerBarbero}
              />
            </div>
          ) : null}
        </div>

        <div className="scroll-fino lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {!hayLineas ? (
            <Vacio icono={ShoppingCart} titulo="La venta está vacía">
              Toca un servicio o producto de la izquierda para agregarlo.
            </Vacio>
          ) : (
            <div className="divide-y divide-linea">
              {carrito.lineas.map((linea, i) => (
                <LineaDelTicket
                  key={`${linea.itemId}-${i}`}
                  linea={linea}
                  alCambiar={() => setPagos([])}
                  indice={i}
                />
              ))}
            </div>
          )}

          {hayLineas ? (
            <div ref={refDetallePago} className="space-y-4 border-t border-linea px-5 py-4">
              <Descuento
                key={carrito.claveIdempotencia}
                subtotal={subtotal}
                descuento={carrito.descuento}
                alCambiar={(c) => {
                  carrito.ponerDescuento(c);
                  setPagos([]);
                }}
              />
              <DetalleDePagos total={total} pagos={pagos} alCambiar={setPagos} />
            </div>
          ) : null}
        </div>

        <div className="sticky bottom-0 shrink-0 space-y-3 border-t border-linea bg-white px-5 py-4 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.15)]">
          {mensaje ? (
            <div className="relative">
              <Aviso tono={mensaje.tono}>
                <span className="pr-6">{mensaje.texto}</span>
              </Aviso>
              <button
                onClick={() => setMensaje(null)}
                className="absolute top-2 right-2 rounded-md p-1 opacity-60 hover:opacity-100"
                aria-label="Cerrar mensaje"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {hayLineas ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">Total</span>
                <span className="cifra text-4xl font-semibold tracking-tight">{aTextoConSimbolo(total)}</span>
              </div>
              {total > 0 ? <BotonesDeMedio total={total} pagos={pagos} alCambiar={setPagos} /> : null}
            </>
          ) : null}

          <div>
            <p
              className={`mb-2 flex items-center justify-center gap-2 text-center text-[0.95rem] ${
                puedeCobrar ? "font-semibold text-bien" : falta < 0 || efectivoCorto || totalEnCero ? "font-semibold text-mal" : "text-tinta/60"
              }`}
            >
              {puedeCobrar ? <CheckCircle2 className="h-5 w-5" /> : null}
              {guia}
            </p>
            <button
              className="boton-primario boton-grande h-16 w-full text-xl"
              disabled={!puedeCobrar || cobro.isPending}
              onClick={() => cobro.mutate()}
            >
              {cobro.isPending ? "Cobrando…" : hayLineas ? `Cobrar ${aTextoConSimbolo(total)}` : "Cobrar"}
            </button>
          </div>
        </div>
      </aside>

      {/* En el celular la venta queda debajo del catálogo: un atajo para bajar. */}
      {hayLineas ? (
        <button
          className="boton-primario fixed right-4 bottom-4 left-4 z-40 h-14 shadow-xl lg:hidden"
          onClick={() => document.getElementById("venta-actual")?.scrollIntoView({ behavior: "smooth" })}
        >
          <ShoppingCart className="h-5 w-5" />
          Ver la venta · {aTextoConSimbolo(total)}
        </button>
      ) : null}

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

function Pasos({ actual }: { actual: number }) {
  const pasos = ["Agregar", "Cliente", "Pago", "Cobrar"];
  return (
    <ol className="mt-3 flex items-center gap-2">
      {pasos.map((p, i) => {
        const n = i + 1;
        const hecho = n < actual;
        const activo = n === actual;
        return (
          <li key={p} className={`flex items-center gap-2 ${n < pasos.length ? "min-w-0 flex-1" : ""}`} title={p}>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                hecho ? "bg-bien text-white" : activo ? "bg-tinta text-white" : "bg-hueso-hondo text-tinta/45"
              }`}
            >
              {hecho ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
            </span>
            {/* Con cuatro pasos no entran todas las etiquetas: se nombra solo el actual. */}
            {activo ? <span className="shrink-0 text-sm font-semibold text-tinta">{p}</span> : null}
            {n < pasos.length ? <span className="h-px min-w-3 flex-1 bg-linea" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-11 shrink-0 rounded-full border px-5 text-[0.95rem] font-semibold transition-colors ${
        activo ? "border-tinta bg-tinta text-white" : "border-linea bg-white text-tinta/70 hover:border-tinta/30 hover:text-tinta"
      }`}
    >
      {children}
    </button>
  );
}

function BotonDeItem({ item, enTicket, onClick }: { item: Item; enTicket: number; onClick: () => void }) {
  const sinStock = item.tipo === "PRODUCTO" && item.stock !== null && item.stock <= 0;

  return (
    <button
      onClick={onClick}
      className={`relative flex min-h-32 flex-col justify-between rounded-2xl border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] ${
        enTicket > 0 ? "border-tinta ring-1 ring-tinta" : "border-linea hover:border-tinta/25"
      }`}
    >
      {enTicket > 0 ? (
        <span className="cifra absolute top-3 right-3 flex h-7 min-w-7 items-center justify-center rounded-full bg-tinta px-2 text-sm font-semibold text-white">
          {fmtCantidad(enTicket)}
        </span>
      ) : null}
      <span className={enTicket > 0 ? "pr-9" : ""}>
        {/* La marca va arriba y más chica: distingue el TALCO de una marca del de
            otra sin robarle espacio al nombre, que es lo que se busca con la
            vista. */}
        {item.marca ? (
          <span className="mb-0.5 block truncate text-xs font-semibold tracking-wide text-tinta/45 uppercase">
            {item.marca}
          </span>
        ) : null}
        <span className="line-clamp-2 text-base leading-snug font-semibold">{item.nombre}</span>
        {item.tipo === "PRODUCTO" ? (
          // El stock se muestra pero NO bloquea: negarse a cobrar con el
          // cliente delante es peor que un inventario desfasado.
          <span className={`mt-1 block text-sm ${sinStock ? "font-semibold text-mal" : "text-tinta/45"}`}>
            {sinStock ? "Sin stock" : `${fmtCantidad(item.stock ?? 0)} en stock`}
          </span>
        ) : null}
      </span>
      {/* Los ítems sin precio no llegan a esta grilla —no se pueden vender—,
          así que acá el precio siempre existe. */}
      <span className="cifra mt-3 text-xl font-semibold tracking-tight">{aTextoConSimbolo(item.precio ?? 0)}</span>
    </button>
  );
}

function LineaDelTicket({
  linea,
  indice,
  alCambiar,
}: {
  linea: ReturnType<typeof usarCarrito.getState>["lineas"][number];
  indice: number;
  alCambiar: () => void;
}) {
  const carrito = usarCarrito();
  const [editandoPrecio, setEditandoPrecio] = useState(false);
  const [precioTexto, setPrecioTexto] = useState(aTexto(linea.precioUnitario));
  // Sin precio de lista no hay ajuste que marcar: el precio se escribió porque
  // el ítem no tenía ninguno, no porque alguien lo cambiara.
  const ajustado = linea.precioLista !== null && linea.precioUnitario !== linea.precioLista;
  const escritoAMano = linea.precioLista === null;

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1 pt-2 leading-snug font-semibold">{nombreConMarca(linea)}</span>
        <span className="cifra pt-2 text-lg font-semibold">
          {aTextoConSimbolo(Math.round(linea.precioUnitario * linea.cantidad))}
        </span>
        <button
          onClick={() => {
            carrito.quitar(indice);
            alCambiar();
          }}
          className="boton-icono -mr-2 hover:text-mal"
          aria-label={`Quitar ${nombreConMarca(linea)}`}
          title="Quitar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="flex items-center rounded-xl border border-linea">
          <button
            className="flex h-11 w-11 items-center justify-center rounded-l-xl text-tinta/60 hover:bg-hueso"
            onClick={() => {
              carrito.cambiarCantidad(indice, linea.cantidad - 1);
              alCambiar();
            }}
            aria-label="Uno menos"
          >
            <Minus className="h-5 w-5" />
          </button>
          <input
            className="cifra h-11 w-12 border-x border-linea text-center text-lg font-semibold outline-none"
            value={fmtCantidad(linea.cantidad)}
            inputMode="decimal"
            aria-label="Cantidad"
            onChange={(e) => {
              const n = Number(e.target.value.replace(",", "."));
              if (Number.isFinite(n)) {
                carrito.cambiarCantidad(indice, n);
                alCambiar();
              }
            }}
          />
          <button
            className="flex h-11 w-11 items-center justify-center rounded-r-xl text-tinta/60 hover:bg-hueso"
            onClick={() => {
              carrito.cambiarCantidad(indice, linea.cantidad + 1);
              alCambiar();
            }}
            aria-label="Uno más"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {editandoPrecio ? (
          <input
            autoFocus
            className="campo cifra h-11 w-28 text-right"
            value={precioTexto}
            inputMode="decimal"
            aria-label="Precio unitario"
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
            className={`cifra inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-[0.95rem] hover:bg-hueso ${
              ajustado || escritoAMano ? "font-semibold text-laton-oscuro" : "text-tinta/55"
            }`}
            title={
              escritoAMano
                ? "Precio escrito al cobrar: este ítem no tiene precio de lista"
                : ajustado
                  ? `Precio de lista: ${aTexto(linea.precioLista!)}`
                  : "Tocar para ajustar el precio"
            }
          >
            × {aTexto(linea.precioUnitario)}
            <Pencil className="h-3.5 w-3.5 opacity-60" />
          </button>
        )}
      </div>
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
      <div className="flex items-center justify-between text-tinta/60">
        <button
          className="inline-flex items-center gap-1.5 text-[0.95rem] font-medium hover:text-tinta"
          onClick={() => setAbierto(true)}
          disabled={subtotal === 0}
        >
          <Percent className="h-4 w-4" />
          Aplicar descuento
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-tinta/60">
        <span>Subtotal</span>
        <span className="cifra">{aTextoConSimbolo(subtotal)}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex-1 text-tinta/60">Descuento</span>
        <div className="relative w-36">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-tinta/40">S/</span>
          <input
            className="campo cifra h-11 pl-9 text-right"
            placeholder="0.00"
            inputMode="decimal"
            value={texto}
            autoFocus
            aria-label="Monto del descuento"
            onChange={(e) => {
              setTexto(e.target.value);
              const c = aCentimos(e.target.value);
              alCambiar(c === null ? 0 : Math.min(c, subtotal));
            }}
          />
        </div>
        <button
          className="boton-icono h-11 w-11"
          aria-label="Quitar descuento"
          onClick={() => {
            setTexto("");
            alCambiar(0);
            setAbierto(false);
          }}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function VentaCobrada({
  venta,
  advertencias,
  impresion: impresionInicial,
  alCerrar,
}: VentaRecienCobrada & { alCerrar: () => void }) {
  const reintento = useMutation({
    mutationFn: () => api.post<{ impresion: ResultadoImpresion }>(`/ventas/${venta.id}/reimprimir`),
  });
  const impresion = reintento.data?.impresion ?? impresionInicial;
  const vueltos = venta.pagos.filter((p) => p.recibido !== undefined && p.recibido > p.monto);

  return (
    <Modal
      titulo="Venta cobrada"
      subtitulo={`Ticket ${venta.correlativo}`}
      alCerrar={alCerrar}
      pie={
        <button className="boton-primario boton-grande w-full" onClick={alCerrar} autoFocus>
          Siguiente venta
          <span className="text-base font-normal text-white/55">Esc</span>
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col items-center rounded-2xl bg-bien/[0.07] px-4 py-6 text-center">
          <CheckCircle2 className="mb-2 h-10 w-10 text-bien" strokeWidth={1.75} />
          <div className="cifra text-4xl font-semibold tracking-tight">{aTextoConSimbolo(venta.total)}</div>
          <div className="ayuda mt-1 text-base">
            {venta.pagos.map((p) => MEDIOS.find((m) => m.id === p.medio)?.texto ?? p.medio).join(" + ")}
          </div>
        </div>

        {vueltos.map((p, i) => (
          <div key={i} className="flex items-center justify-between rounded-2xl bg-laton-claro px-6 py-5">
            <span className="text-lg font-semibold text-laton-oscuro">Entregar de vuelto</span>
            <span className="cifra text-4xl font-semibold tracking-tight text-laton-oscuro">
              {aTextoConSimbolo(p.recibido! - p.monto)}
            </span>
          </div>
        ))}

        {impresion.sinImpresora ? null : impresion.impreso ? (
          <div className="flex items-center gap-2 text-tinta/60">
            <Printer className="h-5 w-5" />
            {reintento.data ? "Copia del ticket impresa." : "Ticket impreso."}
          </div>
        ) : (
          <Aviso
            tono="mal"
            titulo="El ticket no salió en papel"
            accion={
              <button className="boton-suave boton-chico" disabled={reintento.isPending} onClick={() => reintento.mutate()}>
                <Printer className="h-4 w-4" />
                {reintento.isPending ? "Imprimiendo…" : "Reintentar (sale como copia)"}
              </button>
            }
          >
            La venta sí quedó registrada. {impresion.motivo}
          </Aviso>
        )}
        {reintento.error ? <Aviso tono="mal">{(reintento.error as Error).message}</Aviso> : null}

        {advertencias.map((a, i) => (
          <Aviso key={i} tono="aviso" titulo="Atención">
            {a}
          </Aviso>
        ))}

        <details>
          <summary className="cursor-pointer font-medium text-tinta/60">Ver el ticket</summary>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-tinta p-4 font-mono text-xs leading-snug text-hueso">
            {impresion.vistaPrevia}
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
    <Modal titulo="¿Cuál de estos clientes es?" alCerrar={alCerrar}>
      <Aviso tono="aviso">
        {info.mensaje} La tarjeta de fidelidad lleva el <strong>nombre</strong>, no un identificador único, así que
        dos personas que se llaman igual no se pueden distinguir solas.
      </Aviso>

      <div className="mt-4 space-y-2">
        {info.candidatos.map((c) => (
          <button
            key={c.id}
            onClick={() => alElegir(c)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-linea p-4 text-left transition-colors hover:border-tinta/30 hover:bg-hueso"
          >
            <span>
              <span className="block font-semibold">{c.nombre}</span>
              {c.telefono ? <span className="ayuda cifra">{c.telefono}</span> : null}
            </span>
            <span className="ayuda">
              {c.visitas} {c.visitas === 1 ? "visita" : "visitas"}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
