/**
 * El dueño actualiza su propio nombre, correo, teléfono y/o contraseña — todo
 * en un solo formulario, y nada se aplica hasta confirmar el código que
 * llega por correo. El código SIEMPRE va al correo YA registrado (si hay
 * uno), nunca al nuevo que se esté pidiendo — eso lo decide el servidor, acá
 * solo se muestra el resultado.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";

import { api, FalloDeApi } from "../../lib/api";
import { Aviso } from "../../componentes/Modal";
import { Campo, Dato } from "../../componentes/Piezas";

interface MiCuentaDatos {
  id: string;
  usuario: string;
  nombre: string;
  correo?: string;
  telefono?: string;
}

export function SeccionMiCuenta() {
  const qc = useQueryClient();
  const miCuenta = useQuery({
    queryKey: ["mi-cuenta"],
    queryFn: () => api.get<{ usuario: MiCuentaDatos }>("/mi-cuenta"),
  });
  const u = miCuenta.data?.usuario;

  const [editando, setEditando] = useState(false);
  const [paso, setPaso] = useState<"formulario" | "codigo">("formulario");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [contrasenaNueva, setContrasenaNueva] = useState("");
  const [confirmarContrasena, setConfirmarContrasena] = useState("");
  const [codigo, setCodigo] = useState("");

  function empezar() {
    setNombre(u?.nombre ?? "");
    setCorreo(u?.correo ?? "");
    setTelefono(u?.telefono ?? "");
    setContrasenaNueva("");
    setConfirmarContrasena("");
    setCodigo("");
    setPaso("formulario");
    setEditando(true);
    solicitar.reset();
    confirmar.reset();
  }

  function cancelar() {
    setEditando(false);
  }

  const cambioDeNombre = nombre.trim() !== (u?.nombre ?? "") ? nombre.trim() : undefined;
  const cambioDeCorreo = correo.trim() !== (u?.correo ?? "") ? correo.trim() : undefined;
  const cambioDeTelefono = telefono.trim() !== (u?.telefono ?? "") ? telefono.trim() : undefined;
  const hayContrasenaNueva = contrasenaNueva.length > 0;
  const contrasenasCoinciden = !hayContrasenaNueva || contrasenaNueva === confirmarContrasena;
  const contrasenaValida = !hayContrasenaNueva || contrasenaNueva.length >= 8;
  const hayAlgoQueGuardar = Boolean(cambioDeNombre || cambioDeCorreo || cambioDeTelefono || hayContrasenaNueva);
  const puedeSolicitar = hayAlgoQueGuardar && contrasenasCoinciden && contrasenaValida;

  const solicitar = useMutation({
    mutationFn: () =>
      api.post<{ enviado: boolean; detalle?: string }>("/mi-cuenta/solicitar-cambio", {
        nombre: cambioDeNombre,
        correo: cambioDeCorreo,
        telefono: cambioDeTelefono,
        contrasenaNueva: hayContrasenaNueva ? contrasenaNueva : undefined,
      }),
    onSuccess: (r) => {
      // Si no se pudo mandar (ej. se alcanzó el tope del día), no tiene
      // sentido pasar a la pantalla de "escribí el código" — nunca llegó
      // ninguno. Se queda en el formulario con el aviso de qué pasó.
      if (r.enviado) setPaso("codigo");
    },
  });

  const confirmar = useMutation({
    mutationFn: () => api.post<{ contrasenaCambiada: boolean }>("/mi-cuenta/confirmar-cambio", { codigo }),
    onSuccess: (r) => {
      if (r.contrasenaCambiada) {
        // Fuerza a `App` a notar la sesión cerrada YA, en vez de esperar su
        // sondeo cada 30 s — el servidor ya invalidó todas las sesiones de
        // esta cuenta al confirmar el cambio.
        qc.invalidateQueries({ queryKey: ["auth", "yo"] });
        return;
      }
      qc.invalidateQueries({ queryKey: ["mi-cuenta"] });
      setEditando(false);
    },
  });

  const falloSolicitar = solicitar.error as FalloDeApi | undefined;
  const falloConfirmar = confirmar.error as FalloDeApi | undefined;

  if (!u) return null;

  if (!editando) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Dato etiqueta="Nombre" valor={u.nombre} />
          <Dato etiqueta="Correo" valor={u.correo || "Sin registrar"} />
          <Dato etiqueta="Teléfono" valor={u.telefono || "Sin registrar"} />
        </div>
        <button className="boton-suave boton-chico" onClick={empezar}>
          <KeyRound className="h-4 w-4" />
          Actualizar mis datos
        </button>
      </div>
    );
  }

  if (paso === "codigo") {
    return (
      <form
        className="max-w-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (codigo.trim().length === 6) confirmar.mutate();
        }}
      >
        <Aviso tono="aviso">Te mandamos un código de 6 dígitos. Vence en 15 minutos. Nada se aplicó todavía.</Aviso>
        {solicitar.data?.enviado === false ? (
          <Aviso tono="mal">No se pudo mandar un código nuevo: {solicitar.data.detalle}</Aviso>
        ) : null}
        {falloConfirmar ? <Aviso tono="mal">{falloConfirmar.message}</Aviso> : null}

        <Campo etiqueta="Código">
          <input
            className="campo cifra text-center text-2xl tracking-widest"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
          />
        </Campo>

        <div className="flex gap-3">
          <button type="button" className="boton-suave" onClick={cancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="boton-suave"
            disabled={solicitar.isPending}
            onClick={() => solicitar.mutate()}
          >
            Pedir otro código
          </button>
          <button
            type="submit"
            className="boton-primario ml-auto"
            disabled={codigo.trim().length !== 6 || confirmar.isPending}
          >
            {confirmar.isPending ? "Confirmando…" : "Confirmar"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="max-w-sm space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (puedeSolicitar) solicitar.mutate();
      }}
    >
      {falloSolicitar ? <Aviso tono="mal">{falloSolicitar.message}</Aviso> : null}
      {solicitar.data?.enviado === false ? <Aviso tono="mal">{solicitar.data.detalle}</Aviso> : null}

      <Campo etiqueta="Nombre">
        <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <Campo etiqueta="Correo" ayuda="Ahí llega el código para confirmar cualquier cambio, incluido este.">
        <input className="campo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
      </Campo>
      <Campo etiqueta="Teléfono" opcional>
        <input className="campo" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
      </Campo>
      <Campo etiqueta="Contraseña nueva" ayuda="Dejar vacío para no cambiarla. Al menos 8 caracteres." opcional>
        <input
          className="campo"
          type="password"
          value={contrasenaNueva}
          onChange={(e) => setContrasenaNueva(e.target.value)}
        />
      </Campo>
      {hayContrasenaNueva ? (
        <Campo etiqueta="Confirmar contraseña nueva">
          <input
            className="campo"
            type="password"
            value={confirmarContrasena}
            onChange={(e) => setConfirmarContrasena(e.target.value)}
          />
        </Campo>
      ) : null}
      {hayContrasenaNueva && !contrasenasCoinciden ? <Aviso tono="mal">Las contraseñas no coinciden.</Aviso> : null}

      <div className="flex gap-3">
        <button type="button" className="boton-suave" onClick={cancelar}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario ml-auto" disabled={!puedeSolicitar || solicitar.isPending}>
          {solicitar.isPending ? "Enviando código…" : "Guardar (pide un código)"}
        </button>
      </div>
    </form>
  );
}
