/**
 * Rutas de sistema: salud, estado general, configuración y el enrutador de
 * escaneos del lado servidor.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { pareceSerialDeTarjetaCloud, identificarPorEscaneo } from "../../dominio/clientes/clientes";
import { stockBajo } from "../../dominio/inventario/inventario";
import { siguienteCorrelativo } from "../../dominio/venta/registrar";
import { calcularAlertas } from "../../consultas/alertas";
import type { Dependencias } from "../app";

export async function rutasSistema(
  app: FastifyInstance,
  { pos, impresora, respaldos, notificaciones, version, enNube }: Dependencias,
) {
  /**
   * Diagnóstico. Es la PRIMERA pregunta cuando algo falla, y está pensada para
   * poder leerse por teléfono: todo lo que importa en una sola respuesta.
   */
  app.get("/salud", { config: { rol: "PUBLICO" } }, async () => {
    const integridad = await pos.almacen.verificar();
    const memoria = process.memoryUsage();

    return {
      version,
      ahora: new Date().toISOString(),
      log: {
        ultimaSeq: integridad.ultimaSeq,
        eventos: integridad.eventos,
        integro: integridad.ok,
        huecos: integridad.huecos.slice(0, 20),
        hashRotos: integridad.hashRotos.slice(0, 20),
        enCuarentena: integridad.enCuarentena,
        relojAtrasado: pos.almacen.diagnosticoDeArranque().relojAtrasado,
      },
      impresora: await impresora.estado(),
      memoria: {
        usadaMB: Math.round(memoria.rss / 1024 / 1024),
        // El objetivo del proyecto es una PC de 4 GB: si esto empieza a crecer
        // sin techo, se ve aquí antes de que el cliente lo sufra.
        proyeccionMB: Math.round(memoria.heapUsed / 1024 / 1024),
      },
      datos: {
        items: pos.p.items.size,
        ventas: pos.p.ventas.size,
        clientes: pos.p.clientes.size,
        barberos: pos.p.barberos.size,
      },
    };
  });

  /** Lo que la PWA necesita al arrancar, en una sola llamada. */
  app.get("/estado", { config: { rol: "CAJERO" } }, async (peticion) => {
    const sede = pos.p.sede(peticion.sede);
    const estadoImpresora = await impresora.estado();
    const modoImpresora = pos.config<string>("impresora.modo");

    return {
      /**
       * Los datos que salen impresos en el ticket.
       *
       * El NOMBRE y el RUC son de la empresa; la DIRECCIÓN y la CIUDAD, del
       * local donde se está cobrando (en Perú, un RUC con varios
       * establecimientos anexos). El pie es el de la sucursal si lo tiene y si
       * no el del negocio.
       */
      negocio: {
        nombre: pos.config<string>("negocio.nombre"),
        direccion: sede?.direccion || pos.config<string>("negocio.direccion"),
        ciudad: sede?.ciudad || pos.config<string>("negocio.ciudad"),
        ruc: pos.config<string>("negocio.ruc"),
        pie: sede?.pie || pos.config<string>("negocio.pie"),
      },
      /** En qué sucursal está operando esta sesión. */
      sede: sede ? { id: sede.id, nombre: sede.nombre, prefijoTicket: sede.prefijoTicket } : null,
      /**
       * Las sucursales entre las que puede moverse quien pregunta.
       *
       * Un CAJERO ve SOLO la suya, aunque la pantalla no le muestre el
       * selector: no tiene por qué saber qué otros locales existen, y una
       * lista que llega "por si acaso" es la que termina apareciendo en
       * alguna pantalla el día que alguien la reutilice sin mirar el rol.
       */
      sedes:
        peticion.sesion?.rol === "ADMIN"
          ? pos.p.sedesActivas().map((s) => ({ id: s.id, nombre: s.nombre }))
          : sede
            ? [{ id: sede.id, nombre: sede.nombre }]
            : [],
      siguienteCorrelativo: siguienteCorrelativo(
        pos.p,
        peticion.sede,
        pos.config<number>("ventas.correlativoInicial") ?? 1,
      ),
      turnoAbierto: pos.p.turnoAbiertoDe(peticion.sede),
      exigirTurnoAbierto: pos.config<boolean>("ventas.exigirTurnoAbierto"),
      alertasDeStock: stockBajo(pos.p, peticion.sede).length,
      correos: notificaciones.contadorDeHoy(),
      impresora: estadoImpresora,
      // Barato a propósito: nada de lo que entra acá vuelve a tocar el disco
      // ni la red. Ver `consultas/alertas.ts`.
      alertas: calcularAlertas({
        ...pos.almacen.diagnosticoDeArranque(),
        respaldos: respaldos.estadoCacheado(),
        impresoraConfigurada: Boolean(modoImpresora && modoImpresora !== "vistaPrevia"),
        impresora: estadoImpresora,
        enNube,
        redesCajero: pos.config<string>("seguridad.redesCajero"),
      }),
    };
  });

  app.get("/config", { config: { rol: "ADMIN" } }, async () => pos.configCompleta());

  app.put("/config", { config: { rol: "ADMIN" } }, async (peticion) => {
    const cuerpo = z.record(z.unknown()).parse(peticion.body);
    for (const [clave, valor] of Object.entries(cuerpo)) {
      await pos.guardarConfig(clave, valor, peticion.actor);
    }

    // El servicio de respaldos guarda el destino en memoria, así que cambiar la
    // configuración sin avisarle lo dejaba escribiendo en el destino anterior
    // —o en ninguno— hasta el siguiente reinicio. La configuración es la fuente
    // de verdad; esto la mantiene mandando.
    if ("respaldos.destinoExterno" in cuerpo) {
      respaldos.configurarDestino(pos.config<string>("respaldos.destinoExterno") || null);
    }

    return pos.configCompleta();
  });

  /**
   * Resuelve lo que llegó por la pistola QR.
   *
   * El front ya decidió que fue un escaneo (por la cadencia de las teclas);
   * aquí se decide QUÉ es. El orden de las reglas no es casual: primero lo
   * inequívoco (nuestro prefijo, un serial conocido) y al final lo ambiguo
   * (un nombre suelto), nunca al revés.
   */
  app.get("/escaneo", { config: { rol: "CAJERO" } }, async (peticion) => {
    const { valor } = z.object({ valor: z.string().min(1).max(200) }).parse(peticion.query);
    const texto = valor.trim();

    // 1. Ticket nuestro: "CUP1|V|NV000030"
    const ticket = /^CUP1\|V\|(NV\d{6})$/i.exec(texto);
    if (ticket) {
      const venta = pos.p.ventaPorCorrelativo(ticket[1].toUpperCase());
      return venta
        ? { tipo: "venta", venta }
        : {
            tipo: "nada",
            leido: texto,
            mensaje: `El ticket ${ticket[1]} no está en este sistema.`,
            sugerencia: "Puede ser de otra instalación o de antes de la migración.",
          };
    }

    // 2. Un correlativo tecleado a mano.
    const correlativo = /^(NV\d{6})$/i.exec(texto);
    if (correlativo) {
      const venta = pos.p.ventaPorCorrelativo(correlativo[1].toUpperCase());
      if (venta) return { tipo: "venta", venta };
    }

    // 3. Código del catálogo: agrega la línea al ticket en curso.
    const item = pos.p.itemPorCodigo(texto);
    // `itemParaPantalla` y no el ítem crudo: la pantalla de cobro espera el
    // mismo objeto que le da `/catalogo` —con `nombreCompleto` y `stock`— y
    // devolverlo a medias hacía que un escaneo mostrara "undefined".
    if (item && item.activo) return { tipo: "item", item: pos.p.itemParaPantalla(item, peticion.sede) };

    // 4. Tarjeta de fidelidad, por serial o por nombre.
    const identificacion = identificarPorEscaneo(pos.p, texto);
    if (identificacion.estado === "exacto" || identificacion.estado === "unico") {
      return { tipo: "cliente", cliente: identificacion.cliente, exacto: identificacion.porSerial };
    }
    if (identificacion.estado === "ambiguo") {
      return {
        tipo: "clienteAmbiguo",
        candidatos: identificacion.candidatos,
        leido: identificacion.nombreLeido,
        // El QR de La Cúpula lleva el NOMBRE, no el serial: dos personas que
        // se llaman igual son indistinguibles. La pantalla tiene que preguntar.
        mensaje: `Hay ${identificacion.candidatos.length} clientes que se llaman así.`,
      };
    }

    return {
      tipo: "nada",
      leido: texto,
      esSerialDeTarjeta: pareceSerialDeTarjetaCloud(texto),
      mensaje: pareceSerialDeTarjetaCloud(texto)
        ? "Tarjeta de fidelidad no registrada en este local."
        : `No hay ningún ítem ni cliente que coincida con "${texto}".`,
      sugerencia: pareceSerialDeTarjetaCloud(texto)
        ? "Puedes vincularla a un cliente desde su ficha."
        : "Revisa el código, o dalo de alta en Catálogo.",
    };
  });
}
