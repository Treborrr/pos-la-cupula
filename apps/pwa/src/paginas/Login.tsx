/**
 * Login. Dos pantallas —mostrador por defecto, admin aparte en `/login/admin`—
 * que mandan al MISMO `POST /auth/login`: el rol sale de la cuenta, nunca de
 * cuál pantalla se usó para entrar. La distinción es puro gesto para el
 * cajero del día a día, no un límite de seguridad.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, Scissors, ShieldCheck } from "lucide-react";

import { api, FalloDeApi, type Usuario } from "../lib/api";
import { Aviso } from "../componentes/Modal";

export function Login({ modoAdmin = false, mensaje }: { modoAdmin?: boolean; mensaje?: string | null }) {
  const qc = useQueryClient();
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");

  const entrar = useMutation({
    mutationFn: () => api.post<{ usuario: Usuario }>("/auth/login", { usuario: usuario.trim(), contrasena }),
    onSuccess: () => {
      // La misma sonda que usa el shell al arrancar: al invalidarla, `App`
      // la vuelve a pedir, ve la sesión nueva y cambia de pantalla solo.
      qc.invalidateQueries({ queryKey: ["auth", "yo"] });
    },
  });
  const fallo = entrar.error as FalloDeApi | undefined;
  const listo = usuario.trim().length > 0 && contrasena.length > 0;

  return (
    <div className={`flex h-full items-center justify-center p-6 ${modoAdmin ? "bg-tinta" : "bg-hueso"}`}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${
              modoAdmin ? "bg-white/10" : "bg-white"
            }`}
          >
            {modoAdmin ? (
              <ShieldCheck className="h-8 w-8 text-laton" />
            ) : (
              <Scissors className="h-8 w-8 text-laton-oscuro" />
            )}
          </div>
          <h1 className={`text-2xl font-semibold ${modoAdmin ? "text-white" : "text-tinta"}`}>
            {modoAdmin ? "Acceso de administrador" : "La Cúpula"}
          </h1>
          <p className={modoAdmin ? "mt-1 text-hueso/60" : "mt-1 text-tinta/60"}>
            {modoAdmin ? "Para el dueño del negocio" : "Inicia sesión para cobrar"}
          </p>
        </div>

        {mensaje ? (
          <div className="mb-4">
            <Aviso tono="aviso">{mensaje}</Aviso>
          </div>
        ) : null}

        <form
          className="tarjeta space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) entrar.mutate();
          }}
        >
          {fallo ? <Aviso tono="mal">{fallo.message}</Aviso> : null}

          <label className="block">
            <span className="etiqueta mb-2 block">Usuario</span>
            <input
              className="campo h-12"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="etiqueta mb-2 block">Contraseña</span>
            <input
              className="campo h-12"
              type="password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
            />
          </label>

          <button
            type="submit"
            className="boton-primario h-12 w-full justify-center"
            disabled={entrar.isPending || !listo}
          >
            <LockKeyhole className="h-5 w-5" />
            {entrar.isPending ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <div className="mt-6 text-center">
          {modoAdmin ? (
            <Link to="/login" className="text-sm font-medium text-hueso/60 hover:text-hueso">
              ← Volver al inicio de mostrador
            </Link>
          ) : (
            <Link to="/login/admin" className="text-sm font-medium text-tinta/50 hover:text-tinta">
              ¿Sos el dueño? Entrar como administrador
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
