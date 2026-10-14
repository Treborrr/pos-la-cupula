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

import { normalizar, esDeTipo, type Centimos, type Evento } from "@cupula/contratos";

import {
  mediosEnCero,
  type Barbero,
  type Cliente,
  type Egreso,
  type Item,
  type Liquidacion,
  type Propina,
  type ResumenCorreosDelDia,
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
export const FORMATO_PROYECCION = 7;

export class Proyeccion {
  /** Último `seq` aplicado. Define desde dónde seguir reproduciendo. */
  seq = 0;

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
  /** itemId → unidades. Solo PRODUCTO. Puede quedar negativo (ver abajo). */
  readonly stock = new Map<string, number>();

  readonly ventas = new Map<string, Venta>();
  readonly porCorrelativo = new Map<string, string>();
  /** claveIdempotencia → ventaId. Lo que impide cobrar dos veces. */
  readonly porIdempotencia = new Map<string, string>();
  /** "2026-09-16" → ventaIds, en orden de emisión. */
  readonly ventasPorDia = new Map<string, string[]>();
  /** Mayor correlativo emitido. 0 si todavía no hay ninguno. */
  ultimoCorrelativo = 0;

  readonly turnos = new Map<string, Turno>();
  turnoAbierto: Turno | null = null;

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
        if (item.tipo === "PRODUCTO" && !this.stock.has(item.id)) this.stock.set(item.id, 0);
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
        this.recostear(e.datos.itemId, e.datos.cantidad, e.datos.costoUnitario);
        this.moverStock(e.datos.itemId, e.datos.cantidad);
        break;

      case "stock.merma":
        this.moverStock(e.datos.itemId, -e.datos.cantidad);
        break;

      case "stock.ajustado":
        // El ajuste FIJA el saldo, no lo suma: es el resultado de haber contado.
        this.stock.set(e.datos.itemId, e.datos.cantidadContada);
        break;

      case "venta.registrada": {
        const d = e.datos;
        const venta: Venta = {
          id: d.ventaId,
          correlativo: d.correlativo,
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

        const numero = Number(d.correlativo.slice(2));
        if (numero > this.ultimoCorrelativo) this.ultimoCorrelativo = numero;

        // El stock se descuenta DERIVÁNDOLO de la venta, sin un evento aparte.
        // Así es imposible que exista una venta sin su movimiento de stock:
        // son el mismo hecho, no dos que hay que mantener sincronizados.
        for (const linea of d.lineas) {
          if (linea.tipo === "PRODUCTO") this.moverStock(linea.itemId, -linea.cantidad);
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
          if (linea.tipo === "PRODUCTO") this.moverStock(linea.itemId, linea.cantidad);
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
          abiertoEn: e.ts,
          montoInicial: e.datos.montoInicial,
          notas: e.datos.notas,
        };
        this.turnos.set(turno.id, turno);
        this.turnoAbierto = turno;
        break;
      }

      case "caja.egreso_registrado": {
        const d = e.datos;
        this.egresos.set(d.egresoId, {
          id: d.egresoId,
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
        if (this.turnoAbierto?.id === e.datos.turnoId) this.turnoAbierto = null;
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
          activo: true,
        });
        break;

      case "barbero.actualizado": {
        const b = this.barberos.get(e.datos.barberoId);
        if (b && e.datos.nombre !== undefined) b.nombre = e.datos.nombre;
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
          activo: true,
        });
        this.porNombreDeUsuario.set(e.datos.usuario, e.datos.usuarioId);
        break;

      case "usuario.contrasena_cambiada": {
        const u = this.usuarios.get(e.datos.usuarioId);
        if (u) u.hash = e.datos.hash;
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
  private moverStock(itemId: string, delta: number): void {
    // Redondeo a 3 decimales: sin esto, sumar y restar fracciones acumula
    // 0.30000000000000004 y el stock deja de dar exacto.
    const nuevo = Math.round(((this.stock.get(itemId) ?? 0) + delta) * 1000) / 1000;
    this.stock.set(itemId, nuevo);
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
  private recostear(itemId: string, cantidad: number, costoUnitario?: number): void {
    if (costoUnitario === undefined) return;
    const item = this.items.get(itemId);
    if (!item) return;

    const enMano = this.stock.get(itemId) ?? 0;

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

  stockDe(itemId: string): number {
    return this.stock.get(itemId) ?? 0;
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
  itemParaPantalla(item: Item): Item & { nombreCompleto: string; stock: number | null } {
    return {
      ...item,
      nombreCompleto: this.nombreCompleto(item),
      stock: item.tipo === "PRODUCTO" ? this.stockDe(item.id) : null,
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
      items: [...this.items.values()],
      stock: [...this.stock.entries()],
      ventas: [...this.ventas.values()],
      idempotencia: [...this.porIdempotencia.entries()],
      ultimoCorrelativo: this.ultimoCorrelativo,
      turnos: [...this.turnos.values()],
      turnoAbiertoId: this.turnoAbierto?.id ?? null,
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
    p.ultimoCorrelativo = d.ultimoCorrelativo ?? 0;

    for (const item of d.items ?? []) {
      p.items.set(item.id, item);
      if (item.activo) p.porCodigo.set(item.codigo, item.id);
      p.indexarMarca(item.marca ?? "", item.id);
    }
    for (const [k, v] of d.stock ?? []) p.stock.set(k, v);
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
    p.turnoAbierto = d.turnoAbiertoId ? (p.turnos.get(d.turnoAbiertoId) ?? null) : null;
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
