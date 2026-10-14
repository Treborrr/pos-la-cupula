/**
 * Inventario: existencias, movimientos y kardex. Solo productos físicos.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  PackageMinus,
  PackagePlus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { api, FalloDeApi, type Item } from "../lib/api";
import { aCentimos, aTextoConSimbolo, cantidad, fechaYHora, montoOAusente } from "../lib/formato";
import { usarUsuario } from "../lib/sesion";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { Campo, EncabezadoPagina, Pagina, Pastilla, Recuadro, Segmentado } from "../componentes/Piezas";

interface ProductoConStock extends Item {
  stock: number;
  bajoMinimo: boolean;
  enNegativo: boolean;
  /** `null` cuando falta el costo o el precio: no se puede valorizar sin el dato. */
  valorizadoCosto: number | null;
  valorizadoVenta: number | null;
}

interface RespuestaInventario {
  productos: ProductoConStock[];
  alertas: unknown[];
  valorTotalCosto: number;
  valorTotalVenta: number;
  sinCosto: number;
  sinPrecio: number;
}

interface Movimiento {
  ts: string;
  cantidad: number;
  saldo: number;
  motivo: string;
  origen: "venta" | "anulacion" | "entrada" | "ajuste" | "merma";
  referencia?: string;
}

type Accion = "entrada" | "ajuste" | "merma";

const NOMBRE_ORIGEN: Record<Movimiento["origen"], string> = {
  venta: "Venta",
  anulacion: "Anulación",
  entrada: "Entrada",
  ajuste: "Conteo",
  merma: "Merma",
};

export function Inventario() {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<ProductoConStock | null>(null);
  const [comprando, setComprando] = useState(false);
  const [filtro, setFiltro] = useState<"todos" | "alerta">("todos");

  const inventario = useQuery({
    queryKey: ["inventario"],
    queryFn: () => api.get<RespuestaInventario>("/inventario"),
  });

  const productos = inventario.data?.productos ?? [];
  const enNegativo = productos.filter((p) => p.enNegativo);
  const enAlerta = productos.filter((p) => p.bajoMinimo || p.enNegativo || p.stock <= 0);
  const visibles = filtro === "alerta" ? enAlerta : productos;

  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Inventario"
        descripcion="Cuántas unidades hay de cada producto. Toca uno para registrar mercadería que llegó, un conteo o una pérdida."
        acciones={
          productos.length > 0 ? (
            <button className="boton-primario" onClick={() => setComprando(true)}>
              <ShoppingCart className="h-5 w-5" />
              Registrar compra
            </button>
          ) : undefined
        }
      />

      {productos.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Recuadro etiqueta="Productos" valor={String(productos.length)} />
          <Recuadro
            etiqueta="Para reponer"
            valor={String(enAlerta.length)}
            tono={enAlerta.length > 0 ? "aviso" : undefined}
            nota={enAlerta.length > 0 ? "Sin stock o por debajo del mínimo" : "Todo en orden"}
          />
          {/* Dos valorizaciones porque responden preguntas distintas: a costo es
              cuánta plata está inmovilizada, a precio de venta es cuánto
              entraría si se vendiera todo. Cada una dice cuántos productos
              quedaron afuera por falta de dato, para que un total bajo no se
              lea como "hay poca mercadería" cuando es "faltan costos". */}
          <Recuadro
            etiqueta="Plata en stock"
            valor={aTextoConSimbolo(inventario.data?.valorTotalCosto ?? 0)}
            nota={
              inventario.data?.sinCosto
                ? `A costo · ${inventario.data.sinCosto} sin costo cargado`
                : "A precio de compra"
            }
            tono={inventario.data?.sinCosto ? "aviso" : undefined}
          />
          <Recuadro
            etiqueta="Si se vendiera todo"
            valor={aTextoConSimbolo(inventario.data?.valorTotalVenta ?? 0)}
            nota={
              inventario.data?.sinPrecio
                ? `A venta · ${inventario.data.sinPrecio} sin precio`
                : "A precio de venta"
            }
          />
        </div>
      ) : null}

      {enNegativo.length > 0 ? (
        <div className="mb-6">
          <Aviso tono="mal" titulo={`${enNegativo.length} producto(s) con stock negativo`}>
            Se vendió más de lo que el sistema creía tener. El POS no bloquea una venta por falta de stock —con el
            cliente delante sería peor—, pero conviene contar y registrar el conteo.
          </Aviso>
        </div>
      ) : null}

      <div className="tarjeta overflow-hidden">
        {productos.length > 0 ? (
          <div className="flex items-center justify-between gap-3 border-b border-linea p-4">
            <Segmentado
              opciones={[
                { id: "todos", texto: `Todos · ${productos.length}` },
                { id: "alerta", texto: `Para reponer · ${enAlerta.length}` },
              ]}
              valor={filtro}
              alCambiar={setFiltro}
            />
          </div>
        ) : null}

        {inventario.isLoading ? (
          <Vacio titulo="Cargando…" />
        ) : productos.length === 0 ? (
          <Vacio
            icono={Boxes}
            titulo="No hay productos cargados"
            accion={
              <Link to="/catalogo" className="boton-primario">
                <Plus className="h-5 w-5" />
                Crear un producto en Catálogo
              </Link>
            }
          >
            El inventario es solo para lo físico: ceras, pomadas, trimmers. Los servicios no llevan stock.
          </Vacio>
        ) : visibles.length === 0 ? (
          <Vacio icono={Boxes} titulo="Nada para reponer">
            Todos los productos están por encima de su mínimo.
          </Vacio>
        ) : (
          <div className="scroll-fino overflow-x-auto">
            <table className="tabla tabla-clic">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Estado</th>
                  <th className="text-right">Stock</th>
                  <th className="text-right">Mínimo</th>
                  <th className="text-right">Compra</th>
                  <th className="text-right">Venta</th>
                  <th className="text-right">Plata parada</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id} onClick={() => setAbierto(p)}>
                    <td>
                      <div className="font-medium">{p.nombreCompleto}</div>
                      <div className="ayuda cifra">{p.codigo}</div>
                    </td>
                    <td>
                      <EstadoDeStock producto={p} />
                    </td>
                    <td className={`cifra text-right text-lg font-semibold ${p.enNegativo ? "text-mal" : ""}`}>
                      {cantidad(p.stock)}
                    </td>
                    <td className="cifra text-right text-tinta/55">{p.stockMinimo}</td>
                    <td className="cifra text-right text-tinta/55">{montoOAusente(p.costo)}</td>
                    <td className={`cifra text-right ${p.precio === null ? "text-aviso" : ""}`}>
                      {montoOAusente(p.precio, "sin precio")}
                    </td>
                    <td className="cifra text-right text-tinta/65">{montoOAusente(p.valorizadoCosto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {abierto ? (
        <FichaDeProducto
          producto={productos.find((p) => p.id === abierto.id) ?? abierto}
          alCerrar={() => setAbierto(null)}
        />
      ) : null}

      {comprando ? (
        <RegistrarCompra
          productos={productos}
          alCerrar={() => setComprando(false)}
          alHecho={() => {
            qc.invalidateQueries({ queryKey: ["inventario"] });
            qc.invalidateQueries({ queryKey: ["caja"] });
            qc.invalidateQueries({ queryKey: ["estado"] });
          }}
        />
      ) : null}
    </Pagina>
  );
}

function EstadoDeStock({ producto: p }: { producto: ProductoConStock }) {
  if (p.enNegativo) return <Pastilla tono="mal">Negativo</Pastilla>;
  if (p.stock <= 0) return <Pastilla tono="mal">Sin stock</Pastilla>;
  if (p.bajoMinimo) return <Pastilla tono="aviso">Stock bajo</Pastilla>;
  return <Pastilla tono="bien">Disponible</Pastilla>;
}

const ACCIONES: { id: Accion; titulo: string; detalle: string; icono: LucideIcon; soloAdmin?: boolean }[] = [
  { id: "entrada", titulo: "Llegó mercadería", detalle: "Suma unidades", icono: PackagePlus },
  // ADMIN, no cajero: un conteo puede absorber en silencio una merma real
  // (por ejemplo, un robo) bajo "conté y había menos", sin ninguna señal
  // secundaria para el dueño — misma razón que en el servidor.
  { id: "ajuste", titulo: "Hice un conteo", detalle: "Corrige el stock", icono: ClipboardCheck, soloAdmin: true },
  { id: "merma", titulo: "Se perdió o dañó", detalle: "Resta unidades", icono: PackageMinus },
];

function FichaDeProducto({ producto, alCerrar }: { producto: ProductoConStock; alCerrar: () => void }) {
  const qc = useQueryClient();
  const usuario = usarUsuario();
  const acciones = ACCIONES.filter((a) => !a.soloAdmin || usuario.rol === "ADMIN");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const kardex = useQuery({
    queryKey: ["kardex", producto.id],
    queryFn: () => api.get<{ stock: number; movimientos: Movimiento[] }>(`/inventario/${producto.id}/kardex`),
  });

  const stock = kardex.data?.stock ?? producto.stock;

  return (
    <Modal titulo={producto.nombreCompleto} subtitulo={producto.codigo} alCerrar={alCerrar} ancho="max-w-3xl">
      <div className="space-y-6">
        <div className="flex items-center justify-between rounded-2xl bg-hueso px-6 py-5">
          <div>
            <div className="etiqueta">Stock actual</div>
            <div className={`cifra mt-1 text-4xl font-semibold tracking-tight ${stock < 0 ? "text-mal" : ""}`}>
              {cantidad(stock)} <span className="text-lg font-normal text-tinta/50">unidades</span>
            </div>
          </div>
          <EstadoDeStock producto={{ ...producto, stock }} />
        </div>

        {hecho ? <Aviso tono="bien">{hecho}</Aviso> : null}

        {accion ? (
          <FormularioDeMovimiento
            producto={{ ...producto, stock }}
            accion={accion}
            alCancelar={() => setAccion(null)}
            alGuardar={(texto) => {
              qc.invalidateQueries({ queryKey: ["inventario"] });
              qc.invalidateQueries({ queryKey: ["kardex", producto.id] });
              qc.invalidateQueries({ queryKey: ["catalogo"] });
              qc.invalidateQueries({ queryKey: ["estado"] });
              setAccion(null);
              setHecho(texto);
            }}
          />
        ) : (
          <div>
            <div className="etiqueta mb-2">¿Qué pasó con este producto?</div>
            <div className="grid grid-cols-3 gap-3">
              {acciones.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setHecho(null);
                    setAccion(a.id);
                  }}
                  className="flex flex-col items-start gap-3 rounded-xl border border-linea p-4 text-left transition-colors hover:border-tinta/30 hover:bg-hueso"
                >
                  <a.icono className="h-6 w-6 text-laton-oscuro" />
                  <span>
                    <span className="block font-semibold">{a.titulo}</span>
                    <span className="ayuda block">{a.detalle}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="etiqueta mb-2">Movimientos</div>
          <div className="scroll-fino max-h-80 overflow-y-auto rounded-xl border border-linea">
            {(kardex.data?.movimientos.length ?? 0) === 0 ? (
              <p className="ayuda p-6 text-center">Sin movimientos todavía.</p>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Movimiento</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">Queda</th>
                  </tr>
                </thead>
                <tbody>
                  {kardex.data!.movimientos.map((m, i) => (
                    <tr key={i}>
                      <td className="cifra text-sm whitespace-nowrap text-tinta/60">{fechaYHora(m.ts)}</td>
                      <td>
                        <span className="font-medium">{NOMBRE_ORIGEN[m.origen] ?? m.origen}</span>
                        {m.motivo ? <span className="ayuda block">{m.motivo}</span> : null}
                      </td>
                      <td className={`cifra text-right font-semibold ${m.cantidad > 0 ? "text-bien" : "text-mal"}`}>
                        {m.cantidad > 0 ? "+" : ""}
                        {cantidad(m.cantidad)}
                      </td>
                      <td className="cifra text-right text-tinta/65">{cantidad(m.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
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
  accion: Accion;
  alCancelar: () => void;
  alGuardar: (texto: string) => void;
}) {
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");

  const textos = {
    entrada: {
      titulo: "Llegó mercadería",
      campo: "¿Cuántas unidades llegaron?",
      motivo: "Compra a proveedor",
    },
    ajuste: {
      titulo: "Registrar un conteo",
      campo: "¿Cuántas unidades contaste?",
      motivo: "Conteo del mes",
    },
    merma: {
      titulo: "Unidades perdidas o dañadas",
      campo: "¿Cuántas unidades se perdieron?",
      motivo: "Se rompió o se venció",
    },
  }[accion];

  const n = Number(valor.replace(",", "."));
  const valido = valor.trim() !== "" && Number.isFinite(n) && (accion === "ajuste" ? n >= 0 : n > 0);
  const resultado = !valido ? null : accion === "entrada" ? producto.stock + n : accion === "merma" ? producto.stock - n : n;

  const guardar = useMutation({
    mutationFn: () => {
      const m = motivo.trim() || textos.motivo;
      if (accion === "entrada") return api.post("/inventario/entrada", { itemId: producto.id, cantidad: n, motivo: m });
      if (accion === "merma") return api.post("/inventario/merma", { itemId: producto.id, cantidad: n, motivo: m });
      return api.post("/inventario/ajuste", { itemId: producto.id, cantidadContada: n, motivo: m });
    },
    onSuccess: () => alGuardar(`Listo. El stock quedó en ${cantidad(resultado ?? 0)} unidades.`),
  });

  return (
    <div className="space-y-4 rounded-2xl border border-linea p-5">
      <div className="flex items-center gap-2">
        <button className="boton-icono -ml-2" onClick={alCancelar} aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="text-lg font-semibold">{textos.titulo}</h3>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="etiqueta mb-2 block">{textos.campo}</span>
          <input
            className="campo cifra h-14 text-right text-2xl"
            autoFocus
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="etiqueta mb-2 block">
            Motivo <span className="font-normal text-tinta/40">· opcional</span>
          </span>
          <input className="campo h-14" placeholder={textos.motivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
      </div>

      {resultado !== null ? (
        <p className="text-tinta/70">
          El stock pasa de <strong className="cifra">{cantidad(producto.stock)}</strong> a{" "}
          <strong className={`cifra ${resultado < 0 ? "text-mal" : ""}`}>{cantidad(resultado)}</strong> unidades.
        </p>
      ) : null}

      {guardar.error ? <Aviso tono="mal">{(guardar.error as Error).message}</Aviso> : null}

      <div className="flex justify-end gap-3">
        <button className="boton-suave" onClick={alCancelar}>
          Cancelar
        </button>
        <button className="boton-primario" disabled={!valido || guardar.isPending} onClick={() => guardar.mutate()}>
          {guardar.isPending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

interface LineaEnEdicion {
  itemId: string;
  nombre: string;
  codigo: string;
  cantidad: string;
  costo: string;
}

/**
 * Varios productos de un proveedor en una sola acción: cada línea entra al
 * inventario con su costo y, si de verdad salió plata del cajón, un solo
 * egreso por el total —no hay que anotarlo dos veces.
 */
function RegistrarCompra({
  productos,
  alCerrar,
  alHecho,
}: {
  productos: ProductoConStock[];
  alCerrar: () => void;
  alHecho: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [lineas, setLineas] = useState<LineaEnEdicion[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [salioDeLaCaja, setSalioDeLaCaja] = useState(true);

  const coincidencias = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    if (!termino) return [];
    const yaAgregados = new Set(lineas.map((l) => l.itemId));
    return productos
      .filter((p) => !yaAgregados.has(p.id))
      .filter((p) => `${p.codigo} ${p.nombreCompleto}`.toLowerCase().includes(termino))
      .slice(0, 8);
  }, [productos, busqueda, lineas]);

  function agregar(p: ProductoConStock) {
    setLineas((ls) => [
      ...ls,
      {
        itemId: p.id,
        nombre: p.nombreCompleto,
        codigo: p.codigo,
        cantidad: "1",
        costo: p.costo !== null ? (p.costo / 100).toFixed(2) : "",
      },
    ]);
    setBusqueda("");
  }

  function quitar(itemId: string) {
    setLineas((ls) => ls.filter((l) => l.itemId !== itemId));
  }

  function actualizar(itemId: string, campo: "cantidad" | "costo", valor: string) {
    setLineas((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, [campo]: valor } : l)));
  }

  const lineasParseadas = lineas.map((l) => ({
    ...l,
    n: Number(l.cantidad.replace(",", ".")),
    centimos: aCentimos(l.costo),
  }));

  const todoValido =
    lineasParseadas.length > 0 &&
    lineasParseadas.every((l) => Number.isFinite(l.n) && l.n > 0 && l.centimos !== null && l.centimos >= 0);

  const total = todoValido ? lineasParseadas.reduce((a, l) => a + l.n * (l.centimos ?? 0), 0) : 0;

  const guardar = useMutation({
    mutationFn: () =>
      api.post("/inventario/compra", {
        lineas: lineasParseadas.map((l) => ({ itemId: l.itemId, cantidad: l.n, costoUnitario: l.centimos })),
        proveedor: proveedor.trim() || undefined,
        comprobante: comprobante.trim() || undefined,
        salioDeLaCaja,
      }),
    onSuccess: () => {
      alHecho();
      alCerrar();
    },
  });
  const fallo = guardar.error as FalloDeApi | undefined;

  return (
    <Modal
      titulo="Registrar una compra"
      subtitulo="Varios productos de un proveedor, en una sola acción"
      alCerrar={alCerrar}
      ancho="max-w-2xl"
      pie={
        <div className="flex items-center gap-3">
          <div className="mr-auto text-sm text-tinta/60">
            {lineas.length > 0 ? (
              <>
                Total: <strong className="cifra text-tinta">{aTextoConSimbolo(total)}</strong>
              </>
            ) : null}
          </div>
          <button className="boton-suave" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="boton-primario" disabled={!todoValido || guardar.isPending} onClick={() => guardar.mutate()}>
            {guardar.isPending ? "Guardando…" : "Registrar compra"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {fallo ? (
          <Aviso tono="mal" titulo={fallo.message}>
            {fallo.sugerencia}
          </Aviso>
        ) : null}

        <Campo etiqueta="Agregar producto">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-tinta/35" />
            <input
              className="campo h-12 pl-11"
              autoFocus
              placeholder="Buscar por nombre o código"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && coincidencias.length === 1) agregar(coincidencias[0]);
              }}
            />
          </div>
          {coincidencias.length > 0 ? (
            <div className="scroll-fino mt-2 max-h-48 overflow-y-auto rounded-xl border border-linea">
              {coincidencias.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hueso"
                  onClick={() => agregar(p)}
                >
                  <span>
                    <span className="block font-medium">{p.nombreCompleto}</span>
                    <span className="ayuda cifra">{p.codigo}</span>
                  </span>
                  <span className="ayuda cifra">{montoOAusente(p.costo)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </Campo>

        {lineas.length === 0 ? (
          <p className="ayuda rounded-xl border border-dashed border-linea p-6 text-center">
            Busca y agrega los productos que llegaron.
          </p>
        ) : (
          <div className="scroll-fino overflow-x-auto rounded-xl border border-linea">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Costo unitario</th>
                  <th className="text-right">Subtotal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lineasParseadas.map((l) => (
                  <tr key={l.itemId}>
                    <td>
                      <div className="font-medium">{l.nombre}</div>
                      <div className="ayuda cifra">{l.codigo}</div>
                    </td>
                    <td className="text-right">
                      <input
                        className="campo cifra h-10 w-20 text-right"
                        inputMode="decimal"
                        value={l.cantidad}
                        onChange={(e) => actualizar(l.itemId, "cantidad", e.target.value)}
                      />
                    </td>
                    <td className="text-right">
                      <div className="relative inline-block">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tinta/40">
                          S/
                        </span>
                        <input
                          className="campo cifra h-10 w-28 pl-7 text-right"
                          inputMode="decimal"
                          value={l.costo}
                          onChange={(e) => actualizar(l.itemId, "costo", e.target.value)}
                        />
                      </div>
                    </td>
                    <td className="cifra text-right font-medium">
                      {Number.isFinite(l.n) && l.centimos !== null ? aTextoConSimbolo(l.n * l.centimos) : "—"}
                    </td>
                    <td>
                      <button className="boton-icono" aria-label="Quitar" onClick={() => quitar(l.itemId)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Proveedor" opcional>
            <input
              className="campo h-12"
              placeholder="Distribuidora…"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Comprobante" opcional>
            <input
              className="campo h-12"
              placeholder="N° de boleta o factura"
              value={comprobante}
              onChange={(e) => setComprobante(e.target.value)}
            />
          </Campo>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-linea p-4">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={salioDeLaCaja}
            onChange={(e) => setSalioDeLaCaja(e.target.checked)}
          />
          <span>
            <span className="block font-medium">Salió plata del cajón</span>
            <span className="ayuda block">
              Desactívalo si se pagó por otro lado —transferencia, crédito del proveedor— y no debe descontarse del
              efectivo esperado.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
