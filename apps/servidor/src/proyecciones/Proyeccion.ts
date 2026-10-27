/**
 * La proyección: reproduce el log de eventos y arma el estado consultable.
 *
 * Todo lo que la pantalla pregunta sale de aquí, en memoria, en microsegundos.
 * Nunca se consulta el disco para responder una pantalla.
 *
 * Dos propiedades que hay que sostener al tocar este archivo:
 *
 *  · `aplicar` tiene que ser DETERMINISTA y depender solo del evento y del
 *    estado previo. Nada de `Date.now()`, nada de azar: reproducir el mismo
 *    log dos veces tiene que dar exactamente lo mismo.
 *  · Los índices (por código, por correlativo, por nombre) se mantienen al
 *    aplicar, no se recalculan al consultar.
 */

import { normalizar, esDeTipo, SEDE_PRINCIPAL, type Centimos, type Evento } from "@cupula/contratos";

import {
  mediosEnCero,
  type Barbero,
  type Cliente,
  type Egreso,
  type Item,
  type Liquidacion,
  type Propina,
  type ResumenCorreosDelDia,
  type Sede,
  type Turno,
  type TotalesPorMedio,
  type Usuario,
  type Venta,
} from "./tipos";

/**
 * Versión de la FORMA de la proyección. Si se cambia la estructura de las
 * vistas, se sube este número y las instantáneas viejas se ignoran solas: se
 * reconstruye desde el log, que nunca queda desactualizado.
 *
 * Sin esto, una instantánea escrita por el código viejo se hidrataría con el
 * código nuevo y produciría un estado silenciosamente mal — el peor tipo de
 * bug que puede tener un sistema de dinero.
 */
export const FORMATO_PROYECCION = 8;

/**
 * La clave del mapa de stock y del de precios por sucursal.
 *
 * Se usa `\u0000` como separador y no `:` ni `-` porque es el único byte que no
 * puede aparecer ni en un slug de sucursal ni en un ULID: con cualquier otro
 * separador existiría, al menos en teoría, un par (sucursal, ítem) distinto que
 * produce la misma clave y pisa el stock del otro.
 */
export function claveStock(sedeId: string, itemId: string): string {
  return `${sedeId}\u0000${itemId}`;
}

/**
 * La sucursal de un evento que puede no traerla.
 *
 * Los eventos escritos antes de que el sistema fuera multisucursal no tienen
 * `sedeId`, y significan la principal: cuando se escribieron había un solo
 * local y era ese. Ver la nota de `VERSION_ACTUAL` en el contrato.
 */
export function sedeDe(datos: { sedeId?: string }): string {
  return datos.sedeId ?? SEDE_PRINCIPAL;
}

export class Proyeccion {
  /** Último `seq` aplicado. Define desde dónde seguir reproduciendo. */
  seq = 0;

  /**
   * Las sucursales, por su slug. Siempre hay al menos una: el arranque siembra
   * `principal` si el log no trae ninguna (ver `ServicioPos`).
   */
  readonly sedes = new Map<string, Sede>();

  readonly items = new Map<string, Item>();
  /** código (mayúsculas) → itemId. Garantiza códigos únicos. */
  readonly porCodigo = new Map<string, string>();
  /**
   * marca normalizada → itemIds (activos e inactivos).
   *
   * Es una LISTA y no un mapa a uno: una marca tiene muchos productos, que es
   * justamente para lo que sirve el índice (filtrar el catálogo por marca y
   * reportar ventas por marca sin recorrer los 137 ítems en cada consulta).
   */
  readonly porMarca = new Map<string, string[]>();
  /**
   * (sucursal, ítem) → unidades. Solo PRODUCTO. Puede quedar negativo (ver abajo).
   *
   * La clave la arma `claveStock()`. El stock es lo más claramente LOCAL que
   * tiene el sistema: son unidades físicas en un estante concreto, y sumarlas
   * entre locales daría un número que no se puede ir a contar a ningún lado.
   */
  readonly stock = new Map<string, number>();

  /**
   * (sucursal, ítem) → precio propio de esa sucursal, en céntimos.
   *
   * Solo están los ítems que la sucursal se apartó del precio de la cadena. Lo
   * que NO está acá hereda `Item.precio`. Ver `item.precio_sede_cambiado`.
   */
  readonly preciosPorSede = new Map<string, Centimos>();

  readonly ventas = new Map<string, Venta>();
  readonly porCorrelativo = new Map<string, string>();
  /** claveIdempotencia → ventaId. Lo que impide cobrar dos veces. */
  readonly porIdempotencia = new Map<string, string>();
  /** "2026-09-16" → ventaIds, en orden de emisión. */
  readonly ventasPorDia = new Map<string, string[]>();
  /**
   * sucursal → mayor correlativo emitido en ESA sucursal. Sin entrada = ninguno.
   *
   * Cada local lleva su propia serie: compartir una sola entre sucursales
   * obligaría a coordinarlas para no repetir número y dejaría la secuencia de
   * cada una llena de saltos sin explicación (los números que se llevó el otro
   * local). Un contador no puede explicar eso.
   */
  readonly ultimoCorrelativoPorSede = new Map<string, number>();

  readonly turnos = new Map<string, Turno>();
  /**
   * sucursal → su turno abierto. Dos locales pueden tener caja abierta a la
   * vez; lo que sigue siendo imposible es que UNO tenga dos.
   */
  readonly turnosAbiertos = new Map<string, Turno>();

  /**
   * Las salidas de efectivo del cajón, por id.
   *
   * Van en su propio mapa y no colgando del turno porque un egreso puede
   * registrarse con la caja cerrada —y entonces no tiene turno al que
   * colgarse—, igual que una venta.
   */
  readonly egresos = new Map<string, Egreso>();

  /**
   * Propinas, por id. Igual que los egresos, van en su propio mapa y no
   * colgando de la venta: la venta ya está sellada cuando se registra una
   * propina atrasada, y es más simple agregar sin tener que mutarla.
   */
  readonly propinas = new Map<string, Propina>();
  /** ventaId → propinas de esa venta, para "esta línea ya tiene propina". */
  readonly propinasPorVenta = new Map<string, Propina[]>();

  readonly clientes = new Map<string, Cliente>();
  /** nombre normalizado → clienteIds. Es una LISTA: los homónimos existen. */
  readonly clientesPorNombre = new Map<string, string[]>();
  /** serial de tarjeta de fidelidad → clienteId. */
  readonly clientesPorSerial = new Map<string, string>();

  readonly barberos = new Map<string, Barbero>();
  readonly liquidaciones = new Map<string, Liquidacion>();
  /** barberoId → su liquidación más reciente. Es el cursor del saldo pendiente. */
  readonly ultimaLiquidacionPorBarbero = new Map<string, Liquidacion>();

  readonly usuarios = new Map<string, Usuario>();
  /**
   * handle (minúsculas) → usuarioId. Solo activos — mismo patrón que
   * `porCodigo`: se libera al desactivar, así que un handle que dejó de usarse
   * puede dárselo a una persona nueva sin tocar la cuenta vieja.
   */
  readonly porNombreDeUsuario = new Map<string, string>();

  readonly config = new Map<string, unknown>();

  /** "2026-09-16" → resumen de correos de ese día. Ver `ResumenCorreosDelDia`. */
  readonly correosPorDia = new Map<string, ResumenCorreosDelDia>();

  // ───────────────────────────────────────────────────────────────────────────
  // Reducer
  // ───────────────────────────────────────────────────────────────────────────

  aplicar(e: Evento): void {
    switch (e.tipo) {
      case "sede.creada": {
        const d = e.datos;
        this.sedes.set(d.sedeId, {
          id: d.sedeId,
          nombre: d.nombre,
          direccion: d.direccion ?? "",
          ciudad: d.ciudad ?? "",
          pie: d.pie ?? "",
          prefijoTicket: d.prefijoTicket,
          activa: true,
          creadaEn: e.ts,
        });
        break;
      }

      case "sede.actualizada": {
        const d = e.datos;
        const sede = this.sedes.get(d.sedeId);
        if (!sede) break;
        if (d.nombre !== undefined) sede.nombre = d.nombre;
        if (d.direccion !== undefined) sede.direccion = d.direccion;
        if (d.ciudad !== undefined) sede.ciudad = d.ciudad;
        if (d.pie !== undefined) sede.pie = d.pie;
        if (d.prefijoTicket !== undefined) sede.prefijoTicket = d.prefijoTicket;
        break;
      }

      case "sede.desactivada": {
        const sede = this.sedes.get(e.datos.sedeId);
        if (sede) sede.activa = false;
        break;
      }

      case "sede.reactivada": {
        const sede = this.sedes.get(e.datos.sedeId);
        if (sede) sede.activa = true;
        break;
      }

      case "item.creado": {
        const d = e.datos;
        const item: Item = {
          id: d.itemId,
          codigo: d.codigo,
          marca: d.marca ?? "",
          nombre: d.nombre,
          tipo: d.tipo,
          categoria: d.categoria,
          precio: d.precio,
          costo: d.costo ?? null,
          stockMinimo: d.stockMinimo ?? 0,
          orden: d.orden ?? 0,
          activo: true,
          creadoEn: e.ts,
          actualizadoEn: e.ts,
          foto: null,
        };
        this.items.set(item.id, item);
        this.porCodigo.set(item.codigo, item.id);
        this.indexarMarca(item.marca, item.id);

        // El local que lo dio de alta queda registrado como que lo maneja,
        // aunque empiece en cero. Ver `manejaProducto`.
        if (item.tipo === "PRODUCTO") {
          const clave = claveStock(sedeDe(d), item.id);
          if (!this.stock.has(clave)) this.stock.set(clave, 0);
        }
        break;
      }

      case "item.actualizado": {
        const item = this.items.get(e.datos.itemId);
        if (!item) break;
        if (e.datos.codigo !== undefined && e.datos.codigo !== item.codigo) {
          if (this.porCodigo.get(item.codigo) === item.id) this.porCodigo.delete(item.codigo);
          item.codigo = e.datos.codigo;
          if (item.activo) this.porCodigo.set(item.codigo, item.id);
        }
        if (e.datos.marca !== undefined && e.datos.marca !== item.marca) {
          this.desindexarMarca(item.marca, item.id);
          item.marca = e.datos.marca;
          this.indexarMarca(item.marca, item.id);
        }
        if (e.datos.nombre !== undefined) item.nombre = e.datos.nombre;
        if (e.datos.categoria !== undefined) item.categoria = e.datos.categoria;
        if (e.datos.stockMinimo !== undefined) item.stockMinimo = e.datos.stockMinimo;
        if (e.datos.orden !== undefined) item.orden = e.datos.orden;
        item.actualizadoEn = e.ts;
        break;
      }

      case "item.precio_cambiado": {
        const item = this.items.get(e.datos.itemId);
        if (!item) break;
        item.precio = e.datos.precioNuevo;
        item.actualizadoEn = e.ts;
        break;
      }

      case "item.precio_sede_cambiado": {
        const d = e.datos;
        const clave = claveStock(d.sedeId, d.itemId);
        // `null` NO es "sin precio": es volver a heredar el de la cadena, y
        // eso se representa quitando la entrada, no guardando un null.
        if (d.precioNuevo === null) this.preciosPorSede.delete(clave);
        else this.preciosPorSede.set(clave, d.precioNuevo);
        break;
      }

      case "item.costo_cambiado": {
        const item = this.items.get(e.datos.itemId);
        if (!item) break;
        // Fija el promedio, no lo pondera: esto es "el costo es este", que es
        // lo que corresponde cuando lo declara una persona o la planilla.
        item.costo = e.datos.costoNuevo;
        item.actualizadoEn = e.ts;
        break;
      }

      case "item.desactivado": {
        const item = this.items.get(e.datos.itemId);
        if (item) {
          item.activo = false;
          item.actualizadoEn = e.ts;
          // El código se LIBERA al desactivar: si el dueño quiere volver a usar
          // "COR" para otra cosa, puede. El ítem viejo sigue existiendo y las
          // ventas históricas lo siguen encontrando por su id.
          if (this.porCodigo.get(item.codigo) === item.id) this.porCodigo.delete(item.codigo);
        }
        break;
      }

      case "item.reactivado": {
        const item = this.items.get(e.datos.itemId);
        if (item) {
          item.activo = true;
          item.actualizadoEn = e.ts;
          this.porCodigo.set(item.codigo, item.id);
        }
        break;
      }

      case "item.foto_actualizada": {
        const item = this.items.get(e.datos.itemId);
        if (item) item.foto = e.datos.archivo;
        break;
      }

      case "stock.entrada":
        // El recosteo va ANTES de mover el stock: el promedio se pondera contra
        // las unidades que había, no contra las que quedan después de entrar.
        this.recostear(sedeDe(e.datos), e.datos.itemId, e.datos.cantidad, e.datos.costoUnitario);
        this.moverStock(sedeDe(e.datos), e.datos.itemId, e.datos.cantidad);
        break;

      case "stock.merma":
        this.moverStock(sedeDe(e.datos), e.datos.itemId, -e.datos.cantidad);
        break;

      case "stock.ajustado":
        // El ajuste FIJA el saldo, no lo suma: es el resultado de haber contado.
        this.stock.set(claveStock(sedeDe(e.datos), e.datos.itemId), e.datos.cantidadContada);
        break;

      case "stock.traslado": {
        // Los dos lados en el mismo paso: un traslado existe entero o no
        // existe. Ver la nota de `stock.traslado` en el contrato.
        const d = e.datos;
        this.moverStock(d.desdeSedeId, d.itemId, -d.cantidad);
        this.moverStock(d.haciaSedeId, d.itemId, d.cantidad);
        break;
      }

      case "venta.registrada": {
        const d = e.datos;
        const venta: Venta = {
          id: d.ventaId,
          correlativo: d.correlativo,
          sedeId: sedeDe(d),
          ts: e.ts,
          lineas: d.lineas,
          subtotal: d.subtotal,
          descuento: d.descuento,
          total: d.total,
          pagos: d.pagos,
          clienteId: d.clienteId,
          turnoId: d.turnoId,
          notas: d.notas,
          anulada: false,
          reimpresiones: 0,
        };
        this.ventas.set(venta.id, venta);
        this.porCorrelativo.set(venta.correlativo, venta.id);
        this.porIdempotencia.set(d.claveIdempotencia, venta.id);

        const dia = e.ts.slice(0, 10);
        const delDia = this.ventasPorDia.get(dia);
        if (delDia) delDia.push(venta.id);
        else this.ventasPorDia.set(dia, [venta.id]);

        // Los últimos 6 dígitos, sin suponer que el prefijo mide 2: desde que
        // cada sucursal tiene su serie, mide entre 2 y 4.
        const numero = Number(d.correlativo.slice(-6));
        const mayor = this.ultimoCorrelativoPorSede.get(venta.sedeId) ?? 0;
        if (numero > mayor) this.ultimoCorrelativoPorSede.set(venta.sedeId, numero);

        // El stock se descuenta DERIVÁNDOLO de la venta, sin un evento aparte.
        // Así es imposible que exista una venta sin su movimiento de stock:
        // son el mismo hecho, no dos que hay que mantener sincronizados.
        for (const linea of d.lineas) {
          if (linea.tipo === "PRODUCTO") this.moverStock(venta.sedeId, linea.itemId, -linea.cantidad);
        }

        if (venta.clienteId) this.sumarVisita(venta.clienteId, venta.total, e.ts);
        break;
      }

      case "venta.anulada": {
        const venta = this.ventas.get(e.datos.ventaId);
        if (!venta || venta.anulada) break;
        venta.anulada = true;
        venta.motivoAnulacion = e.datos.motivo;
        venta.anuladaEn = e.ts;

        for (const linea of venta.lineas) {
          if (linea.tipo === "PRODUCTO") this.moverStock(venta.sedeId, linea.itemId, linea.cantidad);
        }
        if (venta.clienteId) this.restarVisita(venta.clienteId, venta.total);
        break;
      }

      case "venta.reimpresa": {
        const venta = this.ventas.get(e.datos.ventaId);
        if (venta) venta.reimpresiones += 1;
        break;
      }

      case "venta.propina_registrada": {
        const d = e.datos;
        const propina: Propina = {
          id: d.propinaId,
          ts: e.ts,
          ventaId: d.ventaId,
          lineaIndex: d.lineaIndex,
          barberoId: d.barberoId,
          monto: d.monto,
          turnoId: d.turnoId,
        };
        this.propinas.set(propina.id, propina);
        const deLaVenta = this.propinasPorVenta.get(propina.ventaId);
        if (deLaVenta) deLaVenta.push(propina);
        else this.propinasPorVenta.set(propina.ventaId, [propina]);
        break;
      }

      case "caja.turno_abierto": {
        const turno: Turno = {
          id: e.datos.turnoId,
          sedeId: sedeDe(e.datos),
          abiertoEn: e.ts,
          montoInicial: e.datos.montoInicial,
          notas: e.datos.notas,
        };
        this.turnos.set(turno.id, turno);
        this.turnosAbiertos.set(turno.sedeId, turno);
        break;
      }

      case "caja.egreso_registrado": {
        const d = e.datos;
        this.egresos.set(d.egresoId, {
          id: d.egresoId,
          sedeId: sedeDe(d),
          ts: e.ts,
          turnoId: d.turnoId,
          monto: d.monto,
          motivo: d.motivo,
          comprobante: d.comprobante,
          categoria: d.categoria ?? "OTRO",
          barberoId: d.barberoId,
        });
        break;
      }

      case "caja.turno_cerrado": {
        const turno = this.turnos.get(e.datos.turnoId);
        if (turno) {
          turno.cerradoEn = e.ts;
          turno.contadoEfectivo = e.datos.contadoEfectivo;
          turno.diferencia = e.datos.diferencia;
          if (e.datos.notas) turno.notas = e.datos.notas;
        }
        // La sucursal se toma del TURNO guardado y no del evento de cierre: es
        // la misma, y el turno es la fuente que no puede discrepar.
        if (turno && this.turnosAbiertos.get(turno.sedeId)?.id === turno.id) {
          this.turnosAbiertos.delete(turno.sedeId);
        }
        break;
      }

      case "cliente.registrado": {
        const cliente: Cliente = {
          id: e.datos.clienteId,
          nombre: e.datos.nombre,
          telefono: e.datos.telefono,
          notas: e.datos.notas,
          seriales: [],
          visitas: 0,
          totalGastado: 0,
        };
        this.clientes.set(cliente.id, cliente);
        this.indexarNombre(cliente.nombre, cliente.id);
        break;
      }

      case "cliente.actualizado": {
        const cliente = this.clientes.get(e.datos.clienteId);
        if (!cliente) break;
        if (e.datos.nombre !== undefined && e.datos.nombre !== cliente.nombre) {
          this.desindexarNombre(cliente.nombre, cliente.id);
          cliente.nombre = e.datos.nombre;
          this.indexarNombre(cliente.nombre, cliente.id);
        }
        if (e.datos.telefono !== undefined) cliente.telefono = e.datos.telefono;
        if (e.datos.notas !== undefined) cliente.notas = e.datos.notas;
        break;
      }

      case "cliente.vinculado_fidelidad": {
        const cliente = this.clientes.get(e.datos.clienteId);
        if (!cliente) break;
        if (!cliente.seriales.includes(e.datos.serial)) cliente.seriales.push(e.datos.serial);
        this.clientesPorSerial.set(e.datos.serial, cliente.id);
        break;
      }

      case "barbero.creado":
        this.barberos.set(e.datos.barberoId, {
          id: e.datos.barberoId,
          nombre: e.datos.nombre,
          sedeId: sedeDe(e.datos),
          activo: true,
        });
        break;

      case "barbero.actualizado": {
        const b = this.barberos.get(e.datos.barberoId);
        if (!b) break;
        if (e.datos.nombre !== undefined) b.nombre = e.datos.nombre;
        if (e.datos.sedeId !== undefined) b.sedeId = e.datos.sedeId;
        break;
      }

      case "barbero.desactivado": {
        const b = this.barberos.get(e.datos.barberoId);
        if (b) b.activo = false;
        break;
      }

      case "barbero.liquidado": {
        const d = e.datos;
        const liquidacion: Liquidacion = {
          id: d.liquidacionId,
          ts: e.ts,
          barberoId: d.barberoId,
          monto: d.monto,
          notas: d.notas,
        };
        this.liquidaciones.set(liquidacion.id, liquidacion);
        // Para el cálculo del saldo pendiente solo importa la MÁS RECIENTE
        // por barbero: es el cursor "todo adelanto después de esta fecha
        // sigue pendiente".
        const actual = this.ultimaLiquidacionPorBarbero.get(d.barberoId);
        if (!actual || liquidacion.ts > actual.ts) {
          this.ultimaLiquidacionPorBarbero.set(d.barberoId, liquidacion);
        }
        break;
      }

      // También cubre la reactivación: se reemite con el mismo `usuarioId`
      // (igual que `barbero.creado`), así que simplemente vuelve a quedar
      // activo con el handle reindexado.
      case "usuario.creado":
        this.usuarios.set(e.datos.usuarioId, {
          id: e.datos.usuarioId,
          usuario: e.datos.usuario,
          nombre: e.datos.nombre,
          rol: e.datos.rol,
          hash: e.datos.hash,
          sedeId: sedeDe(e.datos),
          activo: true,
        });
        this.porNombreDeUsuario.set(e.datos.usuario, e.datos.usuarioId);
        break;

      case "usuario.sede_cambiada": {
        const u = this.usuarios.get(e.datos.usuarioId);
        if (u) u.sedeId = e.datos.sedeId;
        break;
      }

      case "usuario.contrasena_cambiada": {
        const u = this.usuarios.get(e.datos.usuarioId);
        if (u) u.hash = e.datos.hash;
        break;
      }

      case "usuario.datos_actualizados": {
        const u = this.usuarios.get(e.datos.usuarioId);
        if (!u) break;
        if (e.datos.nombre !== undefined) u.nombre = e.datos.nombre;
        if (e.datos.correo !== undefined) u.correo = e.datos.correo;
        if (e.datos.telefono !== undefined) u.telefono = e.datos.telefono;
        break;
      }

      case "usuario.desactivado": {
        const u = this.usuarios.get(e.datos.usuarioId);
        if (u) {
          u.activo = false;
          if (this.porNombreDeUsuario.get(u.usuario) === u.id) {
            this.porNombreDeUsuario.delete(u.usuario);
          }
        }
        break;
      }

      case "config.actualizada":
        this.config.set(e.datos.clave, e.datos.valor);
        break;

      case "correo.enviado": {
        const d = e.datos;
        const dia = e.ts.slice(0, 10);
        const resumen =
          this.correosPorDia.get(dia) ??
          ({
            usadosTotal: 0,
            usadosAlertas: 0,
            codigosAlertaNotificados: new Set<string>(),
            reporteDiaEnviado: false,
          } satisfies ResumenCorreosDelDia);

        // Un intento fallido (sin API key, Resend caído) no consumió cupo de
        // verdad: no cuenta contra el tope, y tampoco marca una alerta como
        // "ya avisada" — si se repite, se vuelve a intentar en el próximo lote.
        if (d.ok) {
          resumen.usadosTotal++;
          if (d.categoria === "alerta_tecnica") {
            resumen.usadosAlertas++;
            for (const codigo of d.codigosAlerta ?? []) resumen.codigosAlertaNotificados.add(codigo);
          }
          if (d.categoria === "reporte_dia") resumen.reporteDiaEnviado = true;
        }

        this.correosPorDia.set(dia, resumen);
        break;
      }

      default: {
        // Si aparece un tipo que este código no conoce, se ignora en vez de
        // reventar: un log escrito por una versión más nueva tiene que poder
        // leerse (degradado) y no dejar el sistema sin arrancar.
        const _exhaustivo: never = e;
        void _exhaustivo;
      }
    }

    this.seq = e.seq;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Auxiliares del reducer
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * El stock puede quedar NEGATIVO y es deliberado: bloquear una venta porque
   * el sistema cree que no hay stock es peor que vender y corregir después —
   * el cliente está con el billete en la mano. El negativo es una señal de que
   * hay que contar, y la pantalla lo muestra en rojo.
   */
  private moverStock(sedeId: string, itemId: string, delta: number): void {
    const clave = claveStock(sedeId, itemId);
    // Redondeo a 3 decimales: sin esto, sumar y restar fracciones acumula
    // 0.30000000000000004 y el stock deja de dar exacto.
    const nuevo = Math.round(((this.stock.get(clave) ?? 0) + delta) * 1000) / 1000;
    this.stock.set(clave, nuevo);
  }

  /**
   * Recalcula el COSTO PROMEDIO PONDERADO MÓVIL al entrar mercadería.
   *
   * Había 6 a 28 y entran 4 a 34 → (6×28 + 4×34) / 10 = 30.40. De ahí en más,
   * la utilidad de cada venta se mide contra 30.40. Vender no mueve el
   * promedio, y contar tampoco (`stock.ajustado` cambia cuántas hay, no a
   * cuánto se compraron): solo lo mueve una compra a otro precio.
   *
   * Una entrada SIN costo declarado no toca el promedio. Es deliberado:
   * suponerle costo cero a la mercadería que entró sin factura a mano
   * abarataría el promedio y el reporte mostraría una utilidad que no existe.
   */
  private recostear(sedeId: string, itemId: string, cantidad: number, costoUnitario?: number): void {
    if (costoUnitario === undefined) return;
    const item = this.items.get(itemId);
    if (!item) return;

    // Se pondera contra las unidades de LA SUCURSAL donde entró, no contra las
    // de toda la cadena: la mercadería que entró se mezcla físicamente con la
    // que ya estaba en ESE estante. El costo resultante sí es de la cadena
    // (ver la nota de `sedeId` en `stock.entrada`).
    const enMano = this.stock.get(claveStock(sedeId, itemId)) ?? 0;

    // Sin unidades con las que ponderar —o con stock negativo, que es un saldo
    // por corregir y no un valor de inventario— el costo que acaba de entrar es
    // el único dato real que hay. Ponderar contra un negativo daría un promedio
    // absurdo, incluso negativo.
    if (item.costo === null || enMano <= 0) {
      item.costo = costoUnitario;
      return;
    }

    const valorPrevio = item.costo * enMano;
    const valorNuevo = costoUnitario * cantidad;
    item.costo = Math.round((valorPrevio + valorNuevo) / (enMano + cantidad));
  }

  private indexarMarca(marca: string, itemId: string): void {
    const clave = normalizar(marca);
    if (!clave) return; // sin marca no se indexa: la mayoría de los servicios
    const lista = this.porMarca.get(clave);
    if (lista) {
      if (!lista.includes(itemId)) lista.push(itemId);
    } else {
      this.porMarca.set(clave, [itemId]);
    }
  }

  private desindexarMarca(marca: string, itemId: string): void {
    const clave = normalizar(marca);
    const lista = this.porMarca.get(clave);
    if (!lista) return;
    const i = lista.indexOf(itemId);
    if (i >= 0) lista.splice(i, 1);
    if (lista.length === 0) this.porMarca.delete(clave);
  }

  private indexarNombre(nombre: string, clienteId: string): void {
    const clave = normalizar(nombre);
    const lista = this.clientesPorNombre.get(clave);
    if (lista) {
      if (!lista.includes(clienteId)) lista.push(clienteId);
    } else {
      this.clientesPorNombre.set(clave, [clienteId]);
    }
  }

  private desindexarNombre(nombre: string, clienteId: string): void {
    const clave = normalizar(nombre);
    const lista = this.clientesPorNombre.get(clave);
    if (!lista) return;
    const i = lista.indexOf(clienteId);
    if (i >= 0) lista.splice(i, 1);
    if (lista.length === 0) this.clientesPorNombre.delete(clave);
  }

  private sumarVisita(clienteId: string, total: Centimos, ts: string): void {
    const c = this.clientes.get(clienteId);
    if (!c) return;
    c.visitas += 1;
    c.totalGastado += total;
    if (!c.primeraVisita) c.primeraVisita = ts;
    c.ultimaVisita = ts;
  }

  private restarVisita(clienteId: string, total: Centimos): void {
    const c = this.clientes.get(clienteId);
    if (!c) return;
    c.visitas = Math.max(0, c.visitas - 1);
    c.totalGastado -= total;
    // `ultimaVisita` no se recalcula: costaría recorrer todas sus ventas y el
    // dato "cuándo vino por última vez" no cambia porque se haya anulado el
    // cobro — el cliente igual estuvo aquí.
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Consultas de uso general
  // ───────────────────────────────────────────────────────────────────────────

  itemPorCodigo(codigo: string): Item | undefined {
    const id = this.porCodigo.get(codigo.trim().toUpperCase());
    return id ? this.items.get(id) : undefined;
  }

  ventaPorCorrelativo(correlativo: string): Venta | undefined {
    const id = this.porCorrelativo.get(correlativo.trim().toUpperCase());
    return id ? this.ventas.get(id) : undefined;
  }

  /** Unidades de un producto EN UNA SUCURSAL. */
  stockDe(sedeId: string, itemId: string): number {
    return this.stock.get(claveStock(sedeId, itemId)) ?? 0;
  }

  /**
   * ¿Esta sucursal maneja este producto?
   *
   * Hay entrada en el mapa de stock solo si alguna vez hubo un movimiento en
   * ESE local: una compra, un conteo, una merma, un traslado o una venta. Un
   * producto que el local nunca tocó no tiene entrada, y eso es distinto de
   * tener cero: cero es "se acabó", y sin entrada es "acá no se vende".
   *
   * La diferencia importa desde que el catálogo es de la cadena. Sin esto,
   * cada producto con stock mínimo aparecía como "bajo mínimo" en los veintidós
   * locales a la vez, incluso en los que nunca lo vendieron, y la alerta pasaba
   * de señalar lo que hay que reponer a ser un número que nadie mira.
   */
  manejaProducto(sedeId: string, itemId: string): boolean {
    return this.stock.has(claveStock(sedeId, itemId));
  }

  /** Unidades de un producto sumando TODAS las sucursales. Para el consolidado. */
  stockTotalDe(itemId: string): number {
    let total = 0;
    for (const sedeId of this.sedes.keys()) total += this.stockDe(sedeId, itemId);
    return Math.round(total * 1000) / 1000;
  }

  /**
   * El precio con el que una sucursal vende un ítem: el suyo si lo fijó, y si
   * no, el de la cadena. Ver `item.precio_sede_cambiado`.
   */
  precioEn(sedeId: string, itemId: string): Centimos | null {
    const propio = this.preciosPorSede.get(claveStock(sedeId, itemId));
    if (propio !== undefined) return propio;
    return this.items.get(itemId)?.precio ?? null;
  }

  /** El turno abierto de una sucursal, o null si tiene la caja cerrada. */
  turnoAbiertoDe(sedeId: string): Turno | null {
    return this.turnosAbiertos.get(sedeId) ?? null;
  }

  /** La sucursal, o la principal si la que se pide no existe. */
  sede(sedeId: string): Sede | undefined {
    return this.sedes.get(sedeId);
  }

  /** Las sucursales activas, ordenadas por nombre. */
  sedesActivas(): Sede[] {
    return [...this.sedes.values()]
      .filter((s) => s.activa)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  /**
   * Las marcas que existen, con cuántos ítems activos tiene cada una, ordenadas
   * alfabéticamente. Es lo que llena el desplegable de filtro del catálogo.
   *
   * Devuelve la forma CANÓNICA de cada marca —la del primer ítem que la usó— y
   * no la clave normalizada: el filtro tiene que decir "NIVEL TRES", no "nivel tres".
   */
  marcas(): { marca: string; items: number }[] {
    const salida: { marca: string; items: number }[] = [];
    for (const ids of this.porMarca.values()) {
      const activos = ids.map((id) => this.items.get(id)).filter((i) => i?.activo);
      if (activos.length === 0) continue;
      salida.push({ marca: activos[0]!.marca, items: activos.length });
    }
    return salida.sort((a, b) => a.marca.localeCompare(b.marca, "es"));
  }

  /**
   * Cómo se nombra un ítem donde el espacio alcanza: "DON NISH TALCO".
   *
   * Existe acá y no en cada pantalla porque hay tres lugares que necesitan la
   * misma respuesta —la grilla de cobro, el catálogo y los reportes— y si cada
   * uno la arma a su manera, el mismo producto aparece con dos nombres.
   */
  nombreCompleto(item: Pick<Item, "marca" | "nombre">): string {
    return item.marca ? `${item.marca} ${item.nombre}` : item.nombre;
  }

  /**
   * Un ítem tal como lo espera la pantalla, con lo derivado ya resuelto.
   *
   * TODAS las rutas que devuelven un ítem pasan por acá. No es ceremonia: cada
   * una lo serializaba a su manera y `/escaneo` devolvía el ítem crudo, sin
   * `nombreCompleto` ni `stock`. Al escanear el código de un producto sin
   * precio, la pantalla mostraba "undefined todavía no tiene precio". El bug no
   * estaba en el mensaje: estaba en que había seis formas de contestar la misma
   * pregunta y una se quedó atrás.
   */
  itemParaPantalla(
    item: Item,
    sedeId: string,
  ): Item & {
    nombreCompleto: string;
    stock: number | null;
    precioCadena: Centimos | null;
    precioPropio: boolean;
  } {
    const clave = claveStock(sedeId, item.id);
    const propio = this.preciosPorSede.get(clave);
    return {
      ...item,
      // `precio` es el EFECTIVO en esta sucursal, no el de la cadena. Así, todo
      // lo que ya leía `precio` (la grilla de cobro, el escaneo, el carrito)
      // cobra el precio del local sin enterarse de que existen los demás.
      precio: propio ?? item.precio,
      /** El de la cadena, para que Ajustes pueda mostrar de qué se apartó. */
      precioCadena: item.precio,
      /** true = esta sucursal fijó el suyo; false = hereda el de la cadena. */
      precioPropio: propio !== undefined,
      nombreCompleto: this.nombreCompleto(item),
      stock: item.tipo === "PRODUCTO" ? this.stockDe(sedeId, item.id) : null,
    };
  }

  /**
   * PRODUCTOS activos sin precio de compra cargado.
   *
   * Solo productos: un servicio no tiene costo de mercadería, así que incluirlo
   * haría que el contador nunca llegue a cero y el aviso dejara de significar
   * algo. Sin estos costos, todo el reporte de utilidad y margen queda en
   * blanco.
   */
  sinCosto(): Item[] {
    return [...this.items.values()]
      .filter((i) => i.activo && i.tipo === "PRODUCTO" && i.costo === null)
      .sort((a, b) => this.nombreCompleto(a).localeCompare(this.nombreCompleto(b), "es"));
  }

  /** Ítems activos que todavía no tienen precio: no se pueden vender de la grilla. */
  sinPrecio(): Item[] {
    return [...this.items.values()]
      .filter((i) => i.activo && i.precio === null)
      .sort((a, b) => this.nombreCompleto(a).localeCompare(this.nombreCompleto(b), "es"));
  }

  /** Ventas de un día (formato "2026-09-16"), en orden de emisión. */
  ventasDelDia(dia: string): Venta[] {
    return (this.ventasPorDia.get(dia) ?? [])
      .map((id) => this.ventas.get(id))
      .filter((v): v is Venta => v !== undefined);
  }

  /** Suma por medio de pago. Las anuladas NO cuentan. */
  totalesDe(ventas: Iterable<Venta>): { medios: TotalesPorMedio; total: Centimos; cantidad: number } {
    const medios = mediosEnCero();
    let total = 0;
    let cantidad = 0;
    for (const v of ventas) {
      if (v.anulada) continue;
      cantidad += 1;
      total += v.total;
      for (const p of v.pagos) medios[p.medio] += p.monto;
    }
    return { medios, total, cantidad };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Instantáneas
  // ───────────────────────────────────────────────────────────────────────────

  serializar(): unknown {
    return {
      formato: FORMATO_PROYECCION,
      seq: this.seq,
      sedes: [...this.sedes.values()],
      items: [...this.items.values()],
      stock: [...this.stock.entries()],
      preciosPorSede: [...this.preciosPorSede.entries()],
      ventas: [...this.ventas.values()],
      idempotencia: [...this.porIdempotencia.entries()],
      ultimoCorrelativoPorSede: [...this.ultimoCorrelativoPorSede.entries()],
      turnos: [...this.turnos.values()],
      turnosAbiertosIds: [...this.turnosAbiertos.values()].map((t) => t.id),
      egresos: [...this.egresos.values()],
      propinas: [...this.propinas.values()],
      clientes: [...this.clientes.values()],
      barberos: [...this.barberos.values()],
      liquidaciones: [...this.liquidaciones.values()],
      usuarios: [...this.usuarios.values()],
      config: [...this.config.entries()],
      correosPorDia: [...this.correosPorDia.entries()].map(([dia, r]) => [
        dia,
        { ...r, codigosAlertaNotificados: [...r.codigosAlertaNotificados] },
      ]),
    };
  }

  /**
   * Devuelve null si la instantánea es de otro formato. El que llama
   * reconstruye desde el log — nunca se intenta adivinar una forma vieja.
   */
  static hidratar(crudo: unknown): Proyeccion | null {
    const d = crudo as any;
    if (!d || d.formato !== FORMATO_PROYECCION) return null;

    const p = new Proyeccion();
    p.seq = d.seq ?? 0;
    for (const [k, v] of d.ultimoCorrelativoPorSede ?? []) p.ultimoCorrelativoPorSede.set(k, v);
    for (const sede of d.sedes ?? []) p.sedes.set(sede.id, sede);

    for (const item of d.items ?? []) {
      p.items.set(item.id, item);
      if (item.activo) p.porCodigo.set(item.codigo, item.id);
      p.indexarMarca(item.marca ?? "", item.id);
    }
    for (const [k, v] of d.stock ?? []) p.stock.set(k, v);
    for (const [k, v] of d.preciosPorSede ?? []) p.preciosPorSede.set(k, v);
    for (const venta of d.ventas ?? []) {
      p.ventas.set(venta.id, venta);
      p.porCorrelativo.set(venta.correlativo, venta.id);
      const dia = venta.ts.slice(0, 10);
      const delDia = p.ventasPorDia.get(dia);
      if (delDia) delDia.push(venta.id);
      else p.ventasPorDia.set(dia, [venta.id]);
    }
    for (const [k, v] of d.idempotencia ?? []) p.porIdempotencia.set(k, v);
    for (const turno of d.turnos ?? []) p.turnos.set(turno.id, turno);
    for (const egreso of d.egresos ?? []) p.egresos.set(egreso.id, egreso);
    for (const propina of d.propinas ?? []) {
      p.propinas.set(propina.id, propina);
      const deLaVenta = p.propinasPorVenta.get(propina.ventaId);
      if (deLaVenta) deLaVenta.push(propina);
      else p.propinasPorVenta.set(propina.ventaId, [propina]);
    }
    for (const id of d.turnosAbiertosIds ?? []) {
      const turno = p.turnos.get(id);
      if (turno) p.turnosAbiertos.set(turno.sedeId, turno);
    }
    for (const cliente of d.clientes ?? []) {
      p.clientes.set(cliente.id, cliente);
      p.indexarNombre(cliente.nombre, cliente.id);
      for (const serial of cliente.seriales ?? []) p.clientesPorSerial.set(serial, cliente.id);
    }
    for (const b of d.barberos ?? []) p.barberos.set(b.id, b);
    for (const l of d.liquidaciones ?? []) {
      p.liquidaciones.set(l.id, l);
      const actual = p.ultimaLiquidacionPorBarbero.get(l.barberoId);
      if (!actual || l.ts > actual.ts) p.ultimaLiquidacionPorBarbero.set(l.barberoId, l);
    }
    for (const u of d.usuarios ?? []) {
      p.usuarios.set(u.id, u);
      if (u.activo) p.porNombreDeUsuario.set(u.usuario, u.id);
    }
    for (const [k, v] of d.config ?? []) p.config.set(k, v);
    for (const [dia, r] of d.correosPorDia ?? []) {
      p.correosPorDia.set(dia, { ...r, codigosAlertaNotificados: new Set(r.codigosAlertaNotificados ?? []) });
    }

    return p;
  }
}
