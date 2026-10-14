import { describe, expect, it } from "vitest";

import { ServicioDeIntentosDeLogin } from "../src/servicios/IntentosDeLogin";
import { relojFijo } from "./ayuda";

describe("ServicioDeIntentosDeLogin", () => {
  it("no bloquea antes del tope", () => {
    const s = new ServicioDeIntentosDeLogin(relojFijo());
    for (let i = 0; i < 4; i++) s.registrarFallo("ana");
    expect(s.estaBloqueado("ana")).toBe(false);
  });

  it("bloquea al llegar al tope de fallos consecutivos", () => {
    const s = new ServicioDeIntentosDeLogin(relojFijo());
    for (let i = 0; i < 5; i++) s.registrarFallo("ana");
    expect(s.estaBloqueado("ana")).toBe(true);
  });

  it("el bloqueo se levanta solo pasada la ventana", () => {
    const reloj = relojFijo();
    const s = new ServicioDeIntentosDeLogin(reloj);
    for (let i = 0; i < 5; i++) s.registrarFallo("ana");
    expect(s.estaBloqueado("ana")).toBe(true);

    reloj.avanzar(15 * 60 * 1000 + 1);
    expect(s.estaBloqueado("ana")).toBe(false);
  });

  it("un login correcto resetea el contador", () => {
    const s = new ServicioDeIntentosDeLogin(relojFijo());
    for (let i = 0; i < 4; i++) s.registrarFallo("ana");
    s.registrarExito("ana");

    s.registrarFallo("ana");
    expect(s.estaBloqueado("ana")).toBe(false);
  });

  it("no mezcla el contador de una cuenta con el de otra", () => {
    const s = new ServicioDeIntentosDeLogin(relojFijo());
    for (let i = 0; i < 5; i++) s.registrarFallo("ana");
    expect(s.estaBloqueado("bruno")).toBe(false);
  });
});
