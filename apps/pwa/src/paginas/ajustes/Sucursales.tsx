/**
 * Las sucursales de la cadena: alta, edición y baja.
 *
 * Qué es de cada local y qué es de la cadena está explicado en
 * `PLAN-MULTISUCURSAL.md`, y resumido en el aviso de arriba de la pantalla:
 * hace falta que quien abre un local segundo entienda, antes de cargar nada,
 * que el catálogo y los clientes NO se duplican.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Power, Search, Store } from "lucide-react";

import { api, FalloDeApi, type Sede } from "../../lib/api";
import { Aviso, Modal } from "../../componentes/Modal";
import { Campo, Pastilla } from "../../componentes/Piezas";

export function SeccionSucursales() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Sede | null>(null);
  const [creando, setCreando] = useState(false);

  const sedes = useQuery({
    queryKey: ["sedes"],
    queryFn: () => api.get<{ sedes: Sede[] }>("/sedes"),
  });

  const [busqueda, setBusqueda] = useState("");

  const lista = sedes.data?.sedes ?? [];
  const activas = lista.filter((s) => s.activa).length;
  const conCajaAbierta = lista.filter((s) => s.cajaAbierta).length;

  /**
   * El buscador aparece recién con unas cuantas sucursales. Con dos o tres,
   * un campo de búsqueda sobre una lista que entra entera en la pantalla es
   * una cosa más que leer y decidir, para nada.
   */
  const valeLaPenaBuscar = lista.length > 8;

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((s) =>
      [s.nombre, s.ciudad, s.direccion, s.prefijoTicket].some((campo) =>
        (campo ?? "").toLowerCase().includes(q),
      ),
    );
  }, [lista, busqueda]);

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["sedes"] });
    qc.invalidateQueries({ queryKey: ["estado"] });
  };

  const cambiarEstado = useMutation({
    mutationFn: (s: Sede) => api.post(`/sedes/${s.id}/${s.activa ? "desactivar" : "reactivar"}`),
    onSuccess: refrescar,
  });

  return (
    <div className="space-y-5">
      <Aviso tono="info" titulo="Qué se comparte entre locales y qué no">
        El <strong>catálogo, los precios generales, los clientes y su fidelidad</strong> son de toda la
        cadena: se cargan una sola vez. Lo que lleva cada sucursal por separado es su{" "}
        <strong>stock, su caja, sus barberos y su numeración de tickets</strong>. Un cliente que se
        atiende en dos locales sigue siendo una sola persona.
      </Aviso>

      {cambiarEstado.error ? (
        <Aviso tono="mal" titulo={(cambiarEstado.error as FalloDeApi).message}>
          {(cambiarEstado.error as FalloDeApi).sugerencia}
        </Aviso>
      ) : null}

      {/* Un resumen de la cadena antes de la lista: con veinte locales, lo
          primero que se quiere saber no es el detalle de uno sino cuántos hay
          y cuántos están operando ahora mismo. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-hueso px-5 py-4">
        <span>
          <span className="cifra text-2xl font-semibold">{activas}</span>{" "}
          <span className="ayuda">{activas === 1 ? "sucursal activa" : "sucursales activas"}</span>
        </span>
        <span>
          <span className="cifra text-2xl font-semibold text-bien">{conCajaAbierta}</span>{" "}
          <span className="ayuda">con la caja abierta ahora</span>
        </span>
        {lista.length > activas ? (
          <span>
            <span className="cifra text-2xl font-semibold text-tinta/40">{lista.length - activas}</span>{" "}
            <span className="ayuda">desactivadas</span>
          </span>
        ) : null}
      </div>

      {valeLaPenaBuscar ? (
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-tinta/35" />
          <input
            className="campo pl-12"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, ciudad o prefijo…"
          />
        </label>
      ) : null}

      <div className="tarjeta divide-y divide-linea">
        {visibles.length === 0 ? (
          <p className="ayuda p-5">Ninguna sucursal coincide con «{busqueda}».</p>
        ) : null}
        {visibles.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hueso-hondo">
              <Store className="h-5 w-5 text-tinta/50" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-semibold ${s.activa ? "" : "text-tinta/40"}`}>{s.nombre}</span>
                <Pastilla tono="laton">Tickets {s.prefijoTicket}</Pastilla>
                {!s.activa ? <Pastilla>Desactivada</Pastilla> : null}
                {s.cajaAbierta ? <Pastilla tono="bien">Caja abierta</Pastilla> : null}
              </div>
              <div className="ayuda">
                {[s.direccion, s.ciudad].filter(Boolean).join(" · ") || "Sin dirección cargada"}
                {s.ticketsEmitidos ? ` · ${s.ticketsEmitidos} tickets emitidos` : ""}
              </div>
            </div>

            <button type="button" className="boton-suave boton-chico" onClick={() => setEditando(s)}>
              Editar
            </button>
            <button
              type="button"
              className="boton-suave boton-chico"
              disabled={cambiarEstado.isPending}
              onClick={() => cambiarEstado.mutate(s)}
            >
              <Power className="h-4 w-4" />
              {s.activa ? "Desactivar" : "Reactivar"}
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="boton-suave" onClick={() => setCreando(true)}>
        <Plus className="h-5 w-5" />
        Abrir otra sucursal
      </button>
      <p className="ayuda">
        {activas === 1
          ? "Hoy hay un solo local. Al abrir el segundo aparece un selector arriba para moverte entre ellos, y una opción «Todas» para ver la cadena entera."
          : "Usa el selector de arriba para trabajar en un local, o «Todas las sucursales» para ver el consolidado. Los reportes comparan los locales entre sí."}
      </p>

      {creando ? <FormularioDeSede alCerrar={() => setCreando(false)} alGuardar={refrescar} /> : null}
      {editando ? (
        <FormularioDeSede sede={editando} alCerrar={() => setEditando(null)} alGuardar={refrescar} />
      ) : null}
    </div>
  );
}

function FormularioDeSede({
  sede,
  alCerrar,
  alGuardar,
}: {
  sede?: Sede;
  alCerrar: () => void;
  alGuardar: () => void;
}) {
  const [nombre, setNombre] = useState(sede?.nombre ?? "");
  const [direccion, setDireccion] = useState(sede?.direccion ?? "");
  const [ciudad, setCiudad] = useState(sede?.ciudad ?? "");
  const [pie, setPie] = useState(sede?.pie ?? "");
  const [prefijo, setPrefijo] = useState(sede?.prefijoTicket ?? "");

  /**
   * El prefijo se congela en cuanto la sucursal emitió su primer ticket:
   * cambiarlo después partiría su numeración en dos series y un contador no
   * puede explicar eso. El servidor lo rechaza igual; acá se esconde el campo
   * para no ofrecer algo que va a fallar.
   */
  const prefijoCongelado = (sede?.ticketsEmitidos ?? 0) > 0;

  /**
   * El prefijo se propone solo a partir del nombre, y el servidor garantiza
   * que esté libre.
   *
   * Con veinte locales, pedirle al dueño que invente veinte códigos que además
   * no se repitan es trabajo manual puro: prueba uno, el sistema se lo
   * rechaza, prueba otro. Sigue pudiendo escribir el suyo; lo que cambia es
   * que no tiene que hacerlo.
   *
   * Solo al crear: en una sucursal que ya existe, pisarle el prefijo mientras
   * se le corrige el nombre sería cambiarle la serie sin que lo pida.
   */
  const sugerencia = useQuery({
    queryKey: ["prefijo-sugerido", nombre.trim()],
    queryFn: () =>
      api.get<{ prefijo: string }>(`/sedes/prefijo-sugerido?nombre=${encodeURIComponent(nombre.trim())}`),
    enabled: !sede && nombre.trim().length >= 2,
  });

  const [prefijoTocado, setPrefijoTocado] = useState(false);
  const prefijoEfectivo = prefijoTocado || sede ? prefijo : (sugerencia.data?.prefijo ?? prefijo);

  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        nombre: nombre.trim(),
        direccion: direccion.trim(),
        ciudad: ciudad.trim(),
        pie: pie.trim(),
        ...(prefijoCongelado ? {} : { prefijoTicket: prefijoEfectivo.trim().toUpperCase() }),
      };
      return sede ? api.patch(`/sedes/${sede.id}`, datos) : api.post("/sedes", datos);
    },
    onSuccess: () => {
      alGuardar();
      alCerrar();
    },
  });

  const faltan: string[] = [];
  if (!nombre.trim()) faltan.push("el nombre");
  if (!prefijoCongelado && !/^[A-Za-z][A-Za-z0-9]{1,3}$/.test(prefijoEfectivo.trim())) {
    faltan.push("el prefijo del ticket");
  }

  const fallo = guardar.error instanceof FalloDeApi ? guardar.error : null;

  return (
    <Modal
      titulo={sede ? `Editar ${sede.nombre}` : "Abrir otra sucursal"}
      alCerrar={alCerrar}
      pie={
        <>
          <button type="button" className="boton-suave" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className="boton"
            disabled={faltan.length > 0 || guardar.isPending}
            onClick={() => guardar.mutate()}
          >
            {guardar.isPending ? "Guardando…" : sede ? "Guardar" : "Abrir sucursal"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {fallo ? <Aviso tono="mal" titulo={fallo.message}>{fallo.sugerencia}</Aviso> : null}

        <Campo etiqueta="Nombre del local" ayuda="Cómo lo van a llamar entre ustedes.">
          <input
            className="campo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Centro"
            autoFocus
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Dirección" opcional ayuda="Sale impresa en el ticket de ESTE local.">
            <input className="campo" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </Campo>
          <Campo etiqueta="Ciudad" opcional>
            <input className="campo" value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
          </Campo>
        </div>

        <Campo etiqueta="Mensaje al pie del ticket" opcional ayuda="Si lo dejas vacío, usa el del negocio.">
          <input className="campo" value={pie} onChange={(e) => setPie(e.target.value)} />
        </Campo>

        {prefijoCongelado ? (
          <Campo etiqueta="Prefijo del ticket">
            <div className="flex items-center gap-3">
              <span className="cifra text-lg font-semibold">{sede!.prefijoTicket}</span>
              <span className="ayuda">
                Ya emitió {sede!.ticketsEmitidos} tickets, así que no se puede cambiar: partiría su
                numeración en dos series.
              </span>
            </div>
          </Campo>
        ) : (
          <Campo
            etiqueta="Prefijo del ticket"
            ayuda={
              prefijoTocado || sede
                ? "De 2 a 4 caracteres, empezando por letra. Cada local necesita el suyo para que dos tickets nunca lleven el mismo número."
                : "Lo propone el sistema a partir del nombre, y ya verificó que esté libre. Puedes cambiarlo."
            }
          >
            <input
              className="campo uppercase"
              value={prefijoEfectivo}
              maxLength={4}
              onChange={(e) => {
                setPrefijoTocado(true);
                setPrefijo(e.target.value.toUpperCase());
              }}
              placeholder="BG"
            />
          </Campo>
        )}

        {!sede ? (
          <p className="ayuda">
            La numeración de esta sucursal empieza en {prefijoEfectivo.trim().toUpperCase() || "XX"}000001.
            No continúa la de ningún otro local.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
