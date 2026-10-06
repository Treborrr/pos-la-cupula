# POS La Cúpula — Arquitectura

Sistema de punto de venta para **LA CÚPULA TATTOO BARBER SHOP**, una barbería
de Lima. Reemplaza la planilla de Excel con macros que usaban para cobrar.

**Estado:** los ocho hitos implementados y probados. Lo único pendiente es
**confirmar el perfil de la ticketera con el modelo real** — la impresión está
construida, probada y verificada byte a byte contra el perfil genérico ESC/POS
de 80 mm; saber el modelo solo confirma o ajusta unos valores de configuración.
Ver el estado detallado en [`README.md`](./README.md).
**Fecha:** 16/09/2026.

---

## 1. Decisiones ya cerradas

Estas no se re-discuten. Si alguna cambia, cambia el documento primero.

| # | Decisión | Qué implica |
|---|---|---|
| D1 | **PWA servida por un servidor Node local** en la PC de la barbería | El navegador es solo pantalla. El servidor manda. El mismo API HTTP sube a la nube sin tocar el front |
| D2 | **Sin base de datos. Log append-only en archivos** (JSON Lines) | Cero instalación de motor de BD, cero administración, y cada línea del log es un `INSERT` el día que migremos |
| D3 | **Un solo usuario**, operando desde la PC del mostrador | Sin login, sin PIN, sin roles. El modelo de datos igual lleva `actor` para no rehacerlo después |
| D4 | **Impresión ESC/POS cruda desde el servidor** | Ticket idéntico siempre, corte automático, QR nítido, sin diálogo de Windows. Perfil genérico 80 mm hasta conocer el modelo |
| D5 | **Solo nota de venta interna.** Nada de SUNAT | Sin IGV desglosado, sin serie/tipo de comprobante, sin firma digital. Correlativo propio `NV######` |
| D6 | **Sin comisiones.** Los barberos tienen sueldo fijo | Se registra *quién atendió* como dato para reportes, pero no se calcula ni se liquida nada |
| D7 | **Pistola QR tipo keyboard-wedge** (escanea y "teclea" el contenido) | No hace falta driver ni SDK. Hace falta un enrutador de escaneos en el front, que es un problema real y está resuelto en §7 |
| D8 | **Migramos solo el catálogo** del Excel, sin el histórico de ventas | Arranca limpio. Correlativo continúa en `NV000030` para no romper la numeración que el cliente ya vio |
| D9 | Módulos v1: **ventas, catálogo, inventario, caja y clientes** | Los cinco. Ver §2 |

### Fuera de alcance en v1 (decidido, no olvidado)

Agenda de citas · promociones y paquetes · propinas · egresos de caja ·
comisiones · facturación electrónica · multiusuario y roles · multisucursal ·
app nativa · sincronización en la nube.

> **Advertencia honesta sobre los egresos.** Sin registrar las salidas de
> efectivo (compra de insumos, adelanto a un barbero, el taxi), el arqueo de
> caja **nunca va a cuadrar** contra el dinero real del cajón: el sistema va a
> decir S/ 480 y en el cajón van a haber S/ 430, y no habrá manera de saber por
> qué. El tipo de evento queda reservado en el log (§5.3) para poder encenderlo
> en una tarde, pero mientras tanto el arqueo es una referencia, no una verdad.

---

## 2. Funcionalidades de la v1

### 2.1 Venta (el corazón)

- Agregar líneas por **código tecleado**, por **búsqueda con nombre** (escribir
  "cor" y ver los resultados) o por **toque en la grilla** de servicios frecuentes.
- **Cantidad editable en la misma línea**, con botones `−`/`+`. Esto arregla el
  peor defecto del Excel, donde la cantidad siempre entraba como 1 y corregirla
  exigía activar un modo especial y volver a hacer clic en la fila.
- Si se agrega un ítem que ya está en el ticket, **suma cantidad** en vez de
  crear una línea duplicada.
- Editar precio de una línea (para un ajuste puntual), con el precio de lista
  guardado aparte, de modo que el reporte pueda mostrar cuánto se regaló.
- Quitar línea. Vaciar ticket.
- **Barbero por línea**: se elige de una lista. Opcional — si no se elige, la
  venta se registra igual.
- **Cliente opcional**: por escaneo de la tarjeta de fidelidad (§8), por
  búsqueda, o ninguno (venta al paso).
- Medio de pago: **Efectivo · YAPE · Tarjeta**, en botones grandes. En efectivo,
  campo "paga con" que calcula el vuelto.
- **Pago mixto** (parte efectivo, parte YAPE): una venta acepta varios pagos que
  deben sumar el total. Pasa a diario en una barbería y el Excel no lo permitía.
- Cobrar → asigna correlativo, escribe el evento en disco, imprime y limpia la
  pantalla. Todo en un solo gesto.
- **Protección contra doble cobro**: la pantalla genera una clave de
  idempotencia al abrirse; si el cajero hace doble clic o la impresión demora y
  reintenta, el servidor devuelve la misma venta en vez de crear dos (§9).

### 2.2 Historial y anulación

- Lista de ventas del día / por rango de fechas, con filtro por medio de pago,
  barbero y cliente.
- Abrir una venta: **escaneando el QR del ticket** (§7), o buscando el
  correlativo.
- **Reimprimir** (queda marcado como copia en el papel).
- **Anular** con motivo obligatorio. Nunca se borra nada: se escribe un evento
  `venta.anulada`, el stock vuelve, el correlativo queda consumido y la venta
  aparece tachada en el historial. Auditoría completa.

### 2.3 Catálogo

- Dos tipos de ítem, y la diferencia importa:
  - **SERVICIO** (corte, barba, tatuaje): no tiene stock, no se descuenta nada.
  - **PRODUCTO** (cera, vape, pipa, malla para pipa, trimmer): tiene stock y se
    descuenta al vender.
- Campos: código, **marca**, nombre, tipo, categoría, **precio de venta**,
  **precio de compra**, activo, orden en la grilla.
- **La marca es un campo propio, no parte del nombre.** El catálogo real tiene
  nombres que se repiten entre marcas —un `TALCO` de DON NISH y otro de SIRMAN—
  y con un solo campo de texto esos dos productos son indistinguibles al cobrar.
  Además permite filtrar el catálogo por marca y reportar ventas por marca, que
  con 35 marcas es una pregunta de negocio. En el ticket se imprime solo en los
  productos: los servicios los hace La Cúpula y su nombre ya está arriba.
- **Un ítem puede no tener precio, y entonces NO SE VENDE.** El catálogo que
  entregó el cliente traía 119 de 137 productos sin precio de venta, así que
  "sin precio" es un estado válido y no un error: el ítem existe, se le lleva el
  stock y aparece en Catálogo e Inventario. Lo que no hace es aparecer en la
  pantalla de cobro. `null` y `0` no son lo mismo: uno es "falta ponerle
  precio", el otro sería "es gratis".

  **La regla vive en el dominio** (`registrarVenta`), no en la pantalla, y esa
  es la diferencia entre una regla y una costumbre: la grilla de cobro, la
  pistola de escaneo y cualquier integración futura pasan todas por la misma
  línea. Una regla que solo vive en el front se saltea sin querer el día que
  alguien agrega una segunda forma de cargar una línea. Ni siquiera se puede
  vender mandando el precio en el pedido — si se pudiera, alcanzaría con un
  script para saltearla.

  El porqué: el precio de lista es una decisión del dueño, no del mostrador. Si
  cada cajero pudiera ponerle precio a un producto sin precio, el mismo producto
  se cobraría distinto según quién atienda y el margen del reporte no
  significaría nada. Ajustar el precio de una línea puntual —la cortesía— sí se
  puede, y queda registrado contra el precio de lista para poder reportarlo.
- Alta, edición y **desactivación** (nunca borrado: si se borrara, las ventas
  viejas quedarían apuntando al vacío).
- **Códigos únicos garantizados por el sistema.** En el Excel había tres códigos
  repetidos (`LANG`, `CEVC`, `MENU`) y eso volvía *invendibles* a tres
  productos, porque la búsqueda siempre devolvía el primero. Aquí el alta
  rechaza un código ya usado. La plantilla ya no trae columna de código: los
  genera el sistema, y la identidad de una fila es `MARCA + NOMBRE + TIPO`
  (§5.5).
- Historial de precios **y de costos**: cambiarlos es un evento. La venta vieja
  conserva el precio al que se vendió y el costo que el producto tenía ese día,
  así que se puede responder "¿desde cuándo el corte cuesta 25?" y "¿por qué
  bajó el margen de las ceras en octubre?".
- Carga masiva desde un Excel cuya forma la definió el cliente (§5.5).

### 2.4 Inventario

- Solo para ítems tipo PRODUCTO.
- Stock actual, stock mínimo, alerta visual cuando está por debajo.
- **Entrada de mercadería** (compré 12 ceras), **ajuste** (conté y hay 10, no
  12) y **merma** (se rompió, se perdió), cada una con su motivo. La entrada
  puede declarar su costo, y eso recalcula el promedio ponderado (§5.4).
- **Valorizado a costo y a precio de venta**, por separado: a costo es cuánta
  plata está inmovilizada, a precio de venta es cuánto entraría si se vendiera
  todo. Cada total dice cuántos productos quedaron afuera por falta del dato, para
  que un total bajo no se lea como "hay poca mercadería" cuando es "faltan
  costos".
- La venta descuenta automáticamente; la anulación devuelve.
- **El stock negativo se permite pero se avisa.** Bloquear una venta porque el
  sistema cree que no hay stock es peor que vender y corregir después: el
  cliente está con el billete en la mano.
- Kardex por producto: toda la historia de movimientos de una unidad.

### 2.5 Caja

- **Apertura de turno** con monto inicial en efectivo.
- Durante el turno: total vendido, desglose por medio de pago, cantidad de
  ventas, efectivo esperado en el cajón.
- **Cierre de turno**: el sistema muestra lo esperado, el operador cuenta y
  escribe lo real, y queda registrada la diferencia (con el aviso de §1 sobre
  los egresos).
- Un turno abierto a la vez. No se puede cobrar con la caja cerrada — o sí, es
  configurable, porque una barbería no siempre tiene la disciplina de abrir caja
  y perder una venta por eso es inaceptable.

### 2.6 Clientes

- Ficha mínima: nombre, teléfono (opcional), notas.
- **Identificación por QR de la tarjeta de fidelidad** que ya vendes con
  TarjetaCloud (§8).
- Historial por cliente: visitas, qué consume, cuánto gastó, última visita.
- Alta rápida desde la pantalla de cobro, sin salir del flujo.

### 2.7 Reportes

Todos salen de las proyecciones en memoria, son instantáneos y exportables a
CSV: ventas del día · por rango · por medio de pago · por barbero · ranking de
servicios y productos · stock bajo · clientes frecuentes.

**Períodos de calendario, no ventanas corridas.** Hoy, 7 días, este mes, mes
pasado, este año y rango libre. Cuando el dueño pregunta cómo fue septiembre
quiere septiembre, no los últimos 30 días. Cada cifra se compara contra el
período anterior del mismo largo, porque "vendí S/ 8,450" no es información hasta
saber si el mes pasado fueron 7,000 o 12,000.

**Utilidad y margen** (venta − costo), desglosados por categoría, marca e ítem;
**inventario valorizado**; **productos que no rotan** con la plata que tienen
inmovilizada; y aviso de **lo vendido por debajo del costo**.

> **La regla que atraviesa todos los reportes: lo que no se sabe se dice.** Un
> producto sin costo cargado no tiene margen del 100% — no tiene margen
> calculable. Cada cifra de utilidad viaja con su **cobertura** (sobre qué parte
> de lo vendido se pudo calcular) y donde falta el dato hay una raya, no un cero.
> Un reporte que rellena huecos con ceros es peor que no tener reporte: parece
> confiable y no lo es.

---

## 3. Restricciones y presupuesto de recursos

| Restricción | Consecuencia de diseño |
|---|---|
| Windows con **4 GB de RAM** | Sin Docker, sin Postgres, sin Electron. Un proceso Node + una ventana de navegador |
| **Sin internet garantizado** | Todo funciona offline. Internet es opcional y solo para la integración de fidelidad |
| **Un operador no técnico** | Instalador de un clic, arranque automático con Windows, cero terminal, cero mantenimiento |
| **Cortes de luz** | Cada venta se confirma solo después de estar físicamente en disco (`fsync`). Ver §6.2 |
| **Migrar a nube y a BD real** | El dominio no toca archivos. Habla con un puerto (§4.2). Cambiar de archivos a Postgres es cambiar una implementación |

**Presupuesto de RAM medido contra el objetivo de 4 GB:**

| Componente | RAM |
|---|---|
| Windows 10/11 en reposo | 1.6 – 2.2 GB |
| Servidor Node (Fastify + proyecciones) | 60 – 90 MB |
| Edge con la PWA instalada, una ventana | 250 – 400 MB |
| **Total del sistema** | **≈ 350 – 500 MB** |

Sobra holgadamente. Para dimensionar: la barbería hace ~20 ventas/día ≈ 7 300
ventas/año ≈ 18 000 líneas/año. A ~280 bytes por evento son **~5 MB de log al
año**. El Excel actual pesa 10 MB y son 26 filas de datos.

---

## 4. Arquitectura

### 4.1 Vista general

```
┌──────────────────────── PC de la barbería (Windows) ────────────────────────┐
│                                                                             │
│   ┌─────────────────────┐        HTTP/JSON        ┌──────────────────────┐  │
│   │  PWA (Edge/Chrome)  │ ──────────────────────► │  Servidor Node       │  │
│   │  React + Vite       │ ◄────────────────────── │  Fastify             │  │
│   │  instalada, sin     │    localhost:7070       │                      │  │
│   │  barra de navegador │                         │  ┌────────────────┐  │  │
│   └─────────┬───────────┘                         │  │  DOMINIO       │  │  │
│             │                                     │  │  puro, sin I/O │  │  │
│      ┌──────┴──────┐                              │  └───────┬────────┘  │  │
│      │ pistola QR  │ (teclado)                    │          │           │  │
│      └─────────────┘                              │  ┌───────┴────────┐  │  │
│                                                   │  │ PUERTOS        │  │  │
│                                                   │  │ Eventos·Impr·  │  │  │
│                                                   │  │ Fidelidad·Reloj│  │  │
│                                                   │  └───────┬────────┘  │  │
│                                                   └──────────┼───────────┘  │
│                                                              │              │
│                      ┌───────────────────────────────────────┴──────────┐   │
│                      ▼                    ▼                             ▼   │
│            ┌──────────────────┐  ┌─────────────────┐        ┌───────────────┐
│            │ C:\POSCupula\    │  │ Ticketera 80 mm │        │ api.tarjeta-  │
│            │ datos\*.jsonl    │  │ ESC/POS         │        │ cloud.com     │
│            └──────────────────┘  └─────────────────┘        │ (opcional)    │
│                                                             └───────────────┘
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Capas y la regla que sostiene todo

**El dominio no sabe que existen los archivos.** Esa sola regla es lo que
convierte "guardar en archivos porque el cliente está corto" en "migrar a
Postgres en la nube en un par de días" en vez de "reescribir el sistema".

```
apps/servidor/src/
  dominio/            ← Reglas de negocio. TypeScript puro. Cero import de 'fs'.
    venta/            venta.ts · calcularTotales.ts · anular.ts
    catalogo/         item.ts · reglasDeCodigo.ts
    inventario/       stock.ts · kardex.ts
    caja/             turno.ts · arqueo.ts
    clientes/         cliente.ts · identidad.ts
    eventos/          tipos.ts · esquemas.ts · upcasters.ts   ← el contrato
  puertos/            ← Interfaces. Lo que el dominio necesita del mundo.
    AlmacenDeEventos.ts
    Impresora.ts
    Fidelidad.ts
    Reloj.ts
  adaptadores/        ← Implementaciones sucias. Intercambiables.
    almacen/  ArchivoJsonl.ts        ← HOY
              Postgres.ts            ← MAÑANA (mismo puerto, mismos tests)
              Memoria.ts             ← en los tests
    impresora/ EscPosWindows.ts · EscPosRed.ts · Nula.ts
    fidelidad/ TarjetaCloudHttp.ts · SoloLocal.ts
  proyecciones/       ← Estado consultable, reconstruido desde los eventos
    ventas.ts · stock.ts · caja.ts · clientes.ts · catalogo.ts
  http/               ← Fastify: rutas, validación, serialización
  arranque.ts         ← compone todo (inyección de dependencias a mano)
```

El test de que la regla se respeta es mecánico y va en CI:

```bash
grep -rn "require('fs')\|from 'fs'\|from 'node:fs'" src/dominio/ && exit 1
```

### 4.3 Stack

| Capa | Elección | Por qué esta y no otra |
|---|---|---|
| Runtime | **Node 22 LTS** | Ya lo usas en LoyaltyCards. Un solo lenguaje en todo el stack |
| HTTP | **Fastify 5** | ~2× el throughput de Express y menos RAM. Validación por JSON Schema incluida, que aquí usamos para validar eventos |
| Lenguaje | **TypeScript** en servidor y front | Los tipos de los eventos son el contrato entre ambos |
| Validación | **Zod** | Un esquema por tipo de evento; valida al escribir *y* al releer del disco |
| Front | **React 18 + Vite + Tailwind** | Idéntico a LoyaltyCards: un solo dev, un solo set de costumbres |
| Estado servidor | **TanStack Query** | Caché, reintentos e invalidación resueltos |
| Estado local | **Zustand** | El carrito es estado efímero de UI. 1 KB de librería |
| IDs | **ULID** | Ordenables por tiempo, sin colisiones, y son la clave primaria el día de Postgres |
| Impresión | **ESC/POS a mano** sobre el spooler de Windows | Sin módulos nativos. `node-thermal-printer` arrastra `node-gyp`, y compilar nativo en una PC de barbería sin build tools es una tarde perdida |
| QR | **`qrcode`** (generación) | Para el fallback bitmap cuando el firmware de la impresora no sepa hacer QR |
| Empaquetado | **`@yao-pkg/pkg`** → un `.exe` | El cliente no instala Node ni ve una terminal |
| Servicio | **NSSM** | Arranca con Windows, se reinicia solo si se cae |

**Descartado y por qué:** SQLite (es una BD, y la consigna era no tener motor —
aunque es la primera opción si el log de archivos alguna vez incomoda) ·
Electron (200 MB de RAM que no sobran) · Tauri (más liviano, pero encierra el
sistema en una máquina y obliga a reescribir la capa de datos para la nube) ·
Next.js (SSR que no aporta nada offline).

---

## 5. El modelo de datos: log de eventos

### 5.1 Por qué eventos y no un JSON con el estado

La tentación es `ventas.json` con un arreglo. Se descarta por tres razones
concretas:

1. **Reescribir el archivo entero en cada venta** es O(n) y, si se corta la luz
   a mitad de escritura, se pierde *todo*, no la última venta.
2. **Un log append-only es auditable por construcción.** Nadie puede cambiar el
   precio de una venta de ayer sin dejar rastro. Para un negocio donde el dueño
   no está siempre presente, eso no es un lujo.
3. **Cada línea es una fila.** Migrar a Postgres es `for each línea: INSERT`.
   Con un blob de estado, migrar es escribir un traductor.

### 5.2 Formato en disco

```
C:\POSCupula\
├── app\                          ← el .exe y los assets (se reemplaza al actualizar)
├── datos\                        ← LO ÚNICO QUE IMPORTA RESPALDAR
│   ├── eventos\
│   │   ├── 2026-09.jsonl         ← un archivo por mes
│   │   └── 2026-10.jsonl
│   ├── instantaneas\
│   │   └── 000012840.json        ← estado completo hasta el evento 12840
│   ├── respaldos\
│   │   └── 2026-09-16.zip
│   ├── cuarentena\               ← líneas corruptas rescatadas al arrancar
│   ├── config.json               ← datos del negocio, impresora, preferencias
│   └── .bloqueo                  ← PID del servidor: impide dos instancias
└── registro\                     ← logs técnicos, rotados, no son datos
```

Una línea del log, tal cual queda en disco:

```json
{"seq":12841,"id":"01K5B7M3QW8ZX2VDNPQR4T6Y9A","ts":"2026-09-16T19:42:11.204-05:00","tipo":"venta.registrada","v":1,"actor":{"tipo":"operador","id":"mostrador"},"h":"9f2c…","datos":{"correlativo":"NV000031","lineas":[{"itemId":"01K5A…","codigo":"COR-D","nombre":"CORTE DEGRADADO","tipo":"SERVICIO","cantidad":1,"precioUnitario":2500,"precioLista":2500,"barberoId":"01K59…"}],"total":2500,"pagos":[{"medio":"YAPE","monto":2500}],"clienteId":null,"turnoId":"01K5B…","claveIdempotencia":"01K5B7M1…"}}
```

**Siete decisiones metidas en esa línea:**

| Campo | Decisión |
|---|---|
| `seq` | Entero monótono. Si el archivo salta del 12841 al 12843, hay corrupción y el sistema lo detecta al arrancar en vez de mentir en silencio |
| `id` | ULID. Ordenable por tiempo y listo para ser `PRIMARY KEY` en Postgres |
| `ts` | ISO 8601 **con offset `-05:00`**. Nunca hora local ambigua. El día que haya nube, no hay que adivinar la zona |
| `v` | Versión del *tipo* de evento. Los eventos viejos jamás se editan: se escriben "upcasters" que traducen `v:1` a `v:2` al leer (§5.7) |
| `actor` | Hoy siempre `mostrador`. Existe desde el día 1 para que agregar usuarios no obligue a migrar el histórico |
| `h` | `sha256(h_anterior + evento_canónico)`, primeros 16 hex. **Cadena de hash**: si alguien edita una línea con el Bloc de notas, todas las posteriores dejan de validar. 20 líneas de código, y el dueño puede confiar en sus propios números |
| `precioUnitario` | **Enteros en céntimos**, nunca decimales. `0.1 + 0.2 !== 0.3` en punto flotante, y en un sistema de dinero eso es un céntimo de diferencia que un día se vuelve un arqueo descuadrado |

Además: la línea de venta **desnormaliza** `codigo`, `nombre` y `tipo` del ítem.
Si mañana el producto se renombra o se borra, el ticket de hoy sigue diciendo lo
que decía. Es exactamente lo que el Excel hacía bien y hay que conservar.

### 5.3 Catálogo de eventos

```
venta.registrada          venta.anulada            venta.reimpresa
item.creado               item.actualizado         item.precio_cambiado
item.costo_cambiado       item.desactivado         item.reactivado
stock.entrada             stock.ajustado           stock.merma
caja.turno_abierto        caja.turno_cerrado
cliente.registrado        cliente.actualizado      cliente.vinculado_fidelidad
config.actualizada

# Reservados, sin implementar en v1 (§1):
caja.egreso_registrado    venta.propina_registrada
```

Reservarlos ahora no cuesta nada y evita que el día de mañana el número de
versión del formato tenga que cambiar.

### 5.4 El costo: promedio ponderado móvil, congelado al vender

El costo de un producto **no se guarda como un número que se sobreescribe**. Se
deriva del log, y eso resuelve dos problemas a la vez.

**Cómo se calcula.** Cada `stock.entrada` puede traer su `costoUnitario`, y la
proyección recalcula el promedio contra las unidades que había en mano:

```
había 6 a S/ 28 y entran 4 a S/ 34  →  (6×28 + 4×34) / 10  =  S/ 30.40
```

Vender no mueve el promedio. Contar tampoco: un `stock.ajustado` dice cuántas
unidades hay, no a cuánto se compraron. Solo lo mueve una compra a otro precio.
Una entrada **sin** costo declarado no lo toca — suponerle costo cero a la
mercadería que entró sin factura a mano abarataría el promedio e inventaría una
ganancia que no existe.

**Por qué se congela en la venta.** La línea de venta guarda `costoUnitario`: el
promedio que el producto tenía **al momento de venderse**. Es la misma decisión
que desnormalizar `codigo` y `nombre`, y por la misma razón. Si el reporte
calculara contra el costo de hoy, subir el precio de compra en octubre
reescribiría la utilidad de septiembre, y **ningún mes se podría cerrar**: el
mismo reporte impreso dos veces daría cifras distintas.

**`null` no es cero.** Un producto sin costo conocido se informa como "costo no
registrado", nunca como costo cero. Tratarlo como cero daría un margen del 100%
y el dueño decidiría sobre una ganancia inventada. Por eso cada cifra de utilidad
viaja con su **cobertura**: sobre qué parte de lo vendido se pudo calcular.

Los servicios nunca llevan costo —no hay mercadería que comprar— así que quedan
fuera del margen por definición. Es deliberado: mezclarlos como si costaran cero
daría un margen global inflado, inútil para decidir sobre la reventa.

### 5.5 La planilla de catálogo pone datos, no los borra

El catálogo se carga desde un Excel cuya forma **la definió el cliente**:

```
MARCA | NOMBRE | TIPO | CATEGORÍA | PRECIO VENTA | PRECIO COMPRA | STOCK | STOCK MÍNIMO
```

Sin columna de código —el sistema los genera solos— así que la **identidad de una
fila es `MARCA + NOMBRE + TIPO`**. La marca va en la clave y no es un detalle: el
catálogo real tiene un `TALCO` de DON NISH y otro de SIRMAN, y comparando solo por
nombre la segunda carga pisaría un producto con el otro.

Tres reglas que hacen que reimportar sea seguro, que es lo que más veces va a
pasar:

1. **Una celda de precio vacía significa "no lo sé", no "déjalo en nada".** El
   catálogo llegó con 119 de 137 productos sin precio; el dueño los completa
   desde la pantalla de Catálogo y después va a volver a subir la misma planilla
   —con esas celdas todavía vacías— para agregar productos nuevos. Si la celda
   vacía borrara el precio, esa carga destruiría en silencio todo ese trabajo.
   La planilla puede **poner** precios y costos; para quitarlos está la pantalla,
   donde se ve lo que se está haciendo.
2. **El stock se ajusta, no se suma.** La columna dice cuántas unidades hay, no
   cuántas entraron. Sumarlas duplicaría el inventario en cada reimportación.
3. **Nada se borra: lo que no viene se desactiva.** Un ítem desactivado sale de
   la pantalla de cobro pero sigue existiendo, así que un ticket del mes pasado
   se puede seguir mostrando. Si mañana vuelve a cargarlo, se reactiva con su
   mismo id.

Y `STOCK` acepta `ILIMITADO`: es lo que el cliente escribió en sus siete
servicios de barbería, y tiene razón — un corte de pelo no se agota. El sistema
ya sabe que un servicio no lleva stock, pero tratar la palabra como un error
haría que su planilla no cargara por haber sido explícito.

### 5.6 Proyecciones (el estado consultable)

Al arrancar, el servidor lee la última instantánea y reproduce los eventos
posteriores, armando en memoria:

- `catalogo` — Map de ítems activos, indexado por código y por nombre normalizado
- `stock` — Map itemId → unidades
- `ventasPorDia` — índice por fecha, correlativo y cliente
- `turnoActual` — turno abierto, si lo hay
- `clientes` — Map, con índice por nombre normalizado y por serial de fidelidad
- `correlativoSiguiente` — entero

Un año entero de operación reproduce en **menos de un segundo**. Se toma una
instantánea cada 5 000 eventos para que el arranque nunca crezca sin techo.

Las consultas del front pegan a las proyecciones, jamás al disco. Una pantalla
de ventas del día responde en microsegundos.

### 5.7 Evolución del esquema

Regla dura: **un evento escrito nunca se modifica ni se borra.** Si el negocio
cambia, se sube `v` y se escribe un upcaster:

```ts
// dominio/eventos/upcasters.ts
export const upcasters = {
  "venta.registrada": {
    1: (d: any) => ({ ...d, propina: 0 }),   // v1 no tenía propina → 0
  },
};
```

Los eventos viejos se leen con el código nuevo sin tocar el archivo. Este es el
mecanismo que hace que "escalable" no sea una palabra suelta.

---

## 6. Durabilidad: que no se pierda una venta

Cada una de estas medidas responde a una falla concreta y esperable.

### 6.1 Un solo escritor

El servidor es el único proceso que escribe. Al arrancar toma `datos\.bloqueo`
con su PID; si ya existe y el proceso vive, se niega a arrancar con un mensaje
claro. Dos instancias escribiendo el mismo JSONL es corrupción garantizada.

Dentro del proceso, los `append` pasan por una cola serializada. La asignación
de correlativo y la escritura ocurren en la misma sección crítica: **es
imposible que dos ventas obtengan el mismo `NV`.** (El Excel sí podía: `F7` era
`=MAX(NotaVenta[ID])+1`, recalculada fuera de toda transacción.)

### 6.2 Se corta la luz

Secuencia al cobrar:

1. `write()` de la línea al descriptor abierto en modo `'a'`
2. **`fsync()`** — fuerza el flush del caché del SO al disco físico
3. Recién entonces se responde `200 OK` al navegador
4. Y recién entonces se imprime

Costo: 1–5 ms en SSD. A cambio: si se corta la luz entre el paso 2 y el 4, la
venta existe. Si se corta antes del 2, la venta no existe y no se imprimió — no
hay estado intermedio mentiroso.

### 6.3 Escritura cortada a la mitad

Si el corte ocurre con el `write()` a medias queda una línea JSON incompleta al final
del archivo. Al arrancar, el servidor valida la última línea; si no parsea, la
mueve a `cuarentena\` con su motivo, trunca el archivo a la última línea buena y
sigue. **Nunca arranca sobre datos que no pudo validar.**

### 6.4 Verificación de integridad

Un comando (`pos-cupula.exe verificar`) recorre el log completo y revisa
huecos en `seq` y la cadena de hash. Se corre en cada cierre de caja y el
resultado sale en pantalla como un tilde verde.

### 6.5 Respaldos

- **Automático** cada hora mientras el POS esté encendido —y solo si el log
  creció desde el anterior— más uno al cerrar cada turno: `.tar.gz` del mes en
  curso + las instantáneas → `datos\respaldos\` y, si hay destino externo
  configurado (carpeta de OneDrive o un USB fijo), también ahí.
  - Cada hora y no a una hora fija porque una hora fija no llega nunca si el
    local apaga la PC antes. El cierre de turno es la última oportunidad real:
    es justo lo que se hace antes de apagar.
  - La condición de "solo si hubo movimientos" evita que una noche encendida
    sin ventas genere copias idénticas que empujen fuera de la retención a las
    que sí sirven.
  - Retención en dos niveles: 24 horarias y 30 del resto, podadas por separado.
- **Manual**: botón "Exportar respaldo" que arma un ZIP y lo descarga.
- **Restaurar es copiar archivos.** No hay procedimiento, no hay `pg_restore`,
  no hay que llamar a nadie. Eso es una propiedad, no una carencia.

---

## 7. El enrutador de escaneos

La pistola Motorola es *keyboard-wedge*: se comporta como un teclado que
escribe muy rápido y termina con Enter. Simple de conectar, traicionero de
programar bien. Tres problemas reales:

**Problema 1 — el foco.** El cajero puede tener el cursor en el campo de
cantidad cuando escanea. Si no se intercepta, el ticket termina con una cantidad
de `CUP1|V|NV000030`.

**Solución:** un listener global de `keydown` que mide el intervalo entre
teclas. Una persona escribe a 80–300 ms por tecla; la pistola a **menos de
30 ms**. Se acumula el buffer; al llegar `Enter`, si el promedio fue < 30 ms y
hay más de 6 caracteres, es un escaneo: se hace `preventDefault()`, se limpia lo
que se hubiera colado en el input y se enruta. Si no, era una persona y se deja
pasar intacto.

**Problema 2 — qué llegó.** Por el mismo "teclado" pueden entrar cosas distintas.
Gramática de desambiguación, en orden:

| Entrada | Regla | Acción |
|---|---|---|
| `CUP1\|V\|NV000030` | Empieza con nuestro prefijo | Abre esa venta (consultar / reimprimir / anular) |
| `clxk3j2n90000abcd1234efgh` | 24–27 caracteres, `[a-z0-9]`, empieza con `c` → es un **cuid** de TarjetaCloud | Busca cliente por serial de fidelidad |
| `COR-D`, `CERA-01` | Coincide con un código del catálogo | Agrega la línea al ticket |
| `José Ramírez` | Cualquier otra cosa | Busca cliente por nombre (§8) |

El formato propio es `CUP1|<tipo>|<id>` — versionado en el prefijo desde el día
uno, para poder cambiarlo sin que los tickets viejos dejen de leerse.

**Problema 3 — el layout del teclado.** La pistola emula un teclado; si está
configurada en US y la PC en español, los acentos y la `ñ` llegan mal — y el QR
de la tarjeta de fidelidad de La Cúpula lleva **nombres**. Por eso el cotejo de
nombres se hace siempre sobre texto **normalizado**: minúsculas, sin acentos
(`NFD` + quitar diacríticos), espacios colapsados. "José Ramírez", "JOSE RAMIREZ"
y "Jose  Ramirez" son el mismo cliente.

*A verificar en sitio cuando esté la pistola en la mano:* escanear un nombre con
tilde y ver qué llega literalmente. Es una prueba de dos minutos que evita una
tarde de desconcierto.

---

## 8. Integración con la tarjeta de fidelidad

Revisé `~/Documents/LoyaltyCards`. El QR de la tarjeta lleva **una de dos cosas**,
según `branding.qrContent` del programa (`apps/api/src/modules/programs/branding.ts`):

- `"serial"` (por defecto) → el `serialNumber` de la `CustomerCard`, un **cuid**
  único.
- `"nombre"` → **el nombre del cliente en texto plano**. Es el modo en el que
  está La Cúpula.

El POS soporta los dos, con un adaptador detrás del puerto `Fidelidad`:

### Modo local (v1, sin internet)

El escaneo entra por el enrutador de §7 y se resuelve contra la proyección de
clientes:

- **1 coincidencia** → cliente identificado, sigue el cobro sin fricción.
- **0 coincidencias** → ofrece crearlo, con el nombre ya cargado.
- **2 o más** → muestra la lista con su última visita para que el cajero elija.

Cuando se identifica a un cliente que vino con tarjeta, se guarda el vínculo
(`cliente.vinculado_fidelidad`) para que la próxima vez sea exacto.

> **El problema de los homónimos, dicho claro.** Un QR que solo lleva el nombre
> **no puede** distinguir a dos Carlos Mendoza. No es un defecto de este POS ni
> del sistema de tarjetas: la información no está en el QR. Hoy se resuelve con
> el selector, que funciona bien con pocos clientes y se vuelve molesto con
> muchos. La solución de fondo es cambiar el programa de La Cúpula a
> `qrContent: "serial"` — el cliente sigue viendo su nombre impreso en la
> tarjeta, pero el QR lleva el identificador único. Es un cambio de
> configuración en tu dashboard, no código. Recomendado, no bloqueante.

### Modo conectado (opcional, se enciende en `config.json`)

Con internet disponible, el adaptador `TarjetaCloudHttp` usa el API que ya
tienes desplegado en `api.tarjetacloud.com`:

- `GET /cards/lookup?serial=…` → identificación exacta
- `GET /cards/search?q=…` → búsqueda por nombre (ya devuelve una lista, justo
  para este caso de mostrador)
- Acumular el sello al cobrar, con la misma llamada que usa `/scanner`

Reglas no negociables de esta integración: **timeout de 2 segundos y falla
silenciosa hacia el modo local.** Que se caiga tu API, o el WiFi de la barbería,
jamás puede impedir cobrar. La acumulación de sellos se encola en el propio log
de eventos y se reintenta; el dinero nunca espera a la fidelidad.

---

## 9. Correlativos e idempotencia

`NV000030`, `NV000031`, … continuando donde quedó el Excel.

- El correlativo se asigna **en el servidor**, dentro de la sección crítica de
  escritura. Nunca en el navegador.
- La pantalla de cobro genera una `claveIdempotencia` (ULID) al abrirse. Si el
  mismo POST llega dos veces — doble clic, timeout y reintento, el cajero
  nervioso — el servidor **reconoce la clave y devuelve la venta ya creada**, con
  su mismo correlativo, sin crear una segunda.
- Una venta anulada **conserva su correlativo**. La numeración nunca se reusa:
  un salto sin explicación en el historial es exactamente lo que un contador no
  quiere ver.

---

## 10. Impresión ESC/POS

### 10.1 Camino de los bytes

```
venta (objeto del dominio)
   → renderTicket(venta, perfil): Buffer     ← función PURA, testeable sin impresora
   → adaptador Impresora
       ├─ EscPosWindows: escribe el Buffer al spooler como trabajo RAW
       └─ EscPosRed:     socket TCP al puerto 9100 (si la impresora es de red)
```

`renderTicket` no toca hardware: recibe una venta y un perfil, devuelve bytes.
Se testea con **archivos golden** — se guarda el buffer esperado y cualquier
cambio accidental en el ticket rompe el test. Se puede trabajar el ticket
completo sin tener la impresora enchufada.

### 10.2 El transporte en Windows, sin módulos nativos

Se instala el driver del fabricante, se **comparte** la impresora con un nombre
(`TICKETERA`) y el servidor escribe los bytes crudos a `\\localhost\TICKETERA`.
El spooler los pasa tal cual a la impresora. Cero dependencias nativas, cero
`node-gyp`, cero diálogos.

Si el modelo resulta ser de red, el adaptador `EscPosRed` abre un socket al
puerto 9100 y es aún más directo.

### 10.3 Perfil de impresora

Hasta saber el modelo (basta voltear el equipo y leer la etiqueta), se programa
contra el **perfil genérico ESC/POS de 80 mm**, que cubre a la enorme mayoría
del parque en Perú:

| Parámetro | Valor |
|---|---|
| Ancho de papel | 80 mm |
| Área imprimible | 72 mm = **576 puntos** a 203 dpi |
| Juego de caracteres | CP850 o CP858 (para `Ñ`, tildes y `S/`) |
| Corte | `GS V 66 0` (corte parcial) |
| QR | `GS ( k` por firmware; **fallback a bitmap** si el firmware no lo soporta |
| Cajón de dinero | `ESC p 0 25 250` (si algún día hay cajón) |

El perfil vive en `config.json`: cambiar de impresora es cambiar un valor, no
recompilar. El fallback del QR importa: varias genéricas chinas anuncian `GS ( k`
y devuelven basura. Se genera el QR como PNG con `qrcode`, se convierte a
bitmap 1-bit y se manda con `GS v 0`. Más lento, pero funciona siempre.

### 10.4 Contenido del ticket

Pendiente de definir por ti (lo dijiste explícitamente). Lo que la arquitectura
garantiza desde ya:

- La plantilla es **datos, no código**: un arreglo de bloques
  (`logo`, `texto`, `separador`, `tabla`, `qr`, `corte`) en `config.json`.
  Reordenar el ticket o agregar una línea no requiere recompilar nada.
- El **QR del ticket** lleva `CUP1|V|NV000030` y, escaneado con la pistola, abre
  esa venta en el POS (§7). Si algún día quieres que un cliente lo escanee con
  su celular y vea la boleta, el payload pasa a ser una URL — el enrutador ya
  contempla ambos formatos por el prefijo.

### 10.5 El logo en térmica

El logo (`LOGO ORIGINAL CUPULA NEGRO.png`) es un emblema vintage detallado: ojo
en el domo, filigranas, dos arcos de texto y "SINCE 2020" en microtipografía.

**Corrección respecto de lo que este documento predecía.** La primera versión
de esta sección daba por perdida la filigrana y proponía dibujar una marca
simplificada. Al implementarlo resultó innecesario: a **384 puntos** (no 576) y
con **dithering de Atkinson**, el emblema completo sobrevive — el ojo, las
volutas y hasta "SINCE 2020" se leen. La vista previa está en
`marca/logo-termico-vista-previa.png`.

Lo implementado:

1. Reducción a 384 px con LANCZOS. A dos tercios del ancho del papel el trazo
   queda más grueso en proporción y aguanta mejor el umbral que a 576.
2. Realce de contraste y **dithering de Atkinson** — reparte solo 6/8 del error
   y deja los blancos limpios, a diferencia de Floyd–Steinberg, que ensucia las
   zonas claras con puntos sueltos.
3. **Precompilado a `Buffer` en tiempo de build** (`herramientas/generar-logo-termico.py`
   genera un módulo TypeScript con los bits en base64): imprimir el logo es
   copiar un buffer, no procesar una imagen en cada venta.
4. El logo original, completo, se usa en la PWA — ahí luce a todo color.

**Lo que falta verificar en papel:** la vista previa es fiel a los bits, pero el
papel térmico difumina más que una pantalla. Si en el equipo real el emblema
sale empastado, hay dos salidas sin tocar código: desactivar el logo desde
Ajustes, o regenerarlo a un ancho menor. La marca simplificada queda como
tercera opción si ninguna alcanza.

---

## 11. La PWA

**Por qué PWA y no una página web normal:** se instala desde Edge y queda como
una aplicación con su ícono, **sin barra de direcciones ni pestañas** — el
operador no puede navegar a otro lado ni cerrar la pestaña por error. El service
worker cachea el shell, así que abre instantáneo. Y el día que quieras operar
desde una tablet, ya está hecho.

**Lo que la PWA NO hace, y es deliberado:** no guarda datos como fuente de
verdad. Nada de IndexedDB con ventas. El servidor manda. Si el servidor no
responde, la pantalla lo dice con todas las letras ("Servidor detenido — no se
puede cobrar") en vez de aceptar ventas que se van a perder. Un POS que miente
sobre si guardó es peor que uno que no arranca.

**Pantallas:**

```
/                 Cobrar          ← la pantalla por defecto, el 90% del uso
/historial        Ventas          ← buscar, reimprimir, anular
/catalogo         Servicios y productos
/inventario       Stock, entradas, ajustes
/caja             Turno y arqueo
/clientes         Fichas e historial
/reportes         Números
/ajustes          Negocio, impresora, respaldos
```

**Diseño de la pantalla de cobro** (la única que importa de verdad):

- Izquierda: grilla de ítems frecuentes en botones grandes, agrupados por
  categoría, y un buscador que además acepta el código tecleado.
- Derecha: el ticket en curso, con cantidad editable por línea y el total en
  tipografía grande.
- Abajo: los tres medios de pago en botones de 64 px y el botón COBRAR.
- **Todo alcanzable con teclado**: `F2` buscar · `F4` cobrar · `Esc` limpiar ·
  `+`/`−` cantidad. Un cajero con práctica no debería tener que tocar el mouse.
- Respuesta a cada acción en **menos de 100 ms**. Es local: no hay excusa.

**Identidad visual** (del logo): negro `#0B0B0B` como tinta, hueso `#F5F1E8`
como fondo, latón `#B8894A` para la acción principal. Verde y rojo reservados
**solo** para estados (cobrado / anulado, stock ok / bajo) — si el rojo también
es decoración, deja de ser una alarma. Tipografía con carácter para títulos y
una sans legible para los números; los montos siempre en cifras tabulares, para
que las columnas alineen.

Íconos PWA: 192, 512 y maskable, derivados del logo sobre fondo negro.

---

## 12. Instalación y operación

**Para el cliente, es un instalador y nada más:**

1. `POSCupula-Setup.exe` copia todo a `C:\POSCupula\`
2. Registra el servicio de Windows con NSSM (arranca solo, se reinicia solo)
3. Deja un acceso directo en el escritorio que abre
   `msedge.exe --app=http://localhost:7070`
4. El asistente de primer arranque pide: datos del negocio, impresora, carpeta
   de respaldo, y ofrece cargar el catálogo migrado del Excel

**Actualizar:** reemplazar `C:\POSCupula\app\` y reiniciar el servicio.
`datos\` no se toca jamás.

**Diagnóstico:** `http://localhost:7070/salud` responde estado del log, última
`seq`, integridad de la cadena de hash, impresora detectada y RAM en uso. Es la
primera pregunta cuando algo falle, y se puede leer por teléfono.

---

## 13. El camino a la nube

Cuando el cliente pueda pagarlo, esto es exactamente lo que cambia:

| Componente | Hoy | En la nube | ¿Se reescribe? |
|---|---|---|---|
| PWA | `localhost:7070` | `pos.tarjetacloud.com` | **No.** Cambia una variable de entorno |
| API HTTP | Fastify local | Fastify en Render | **No.** El mismo código |
| Dominio | TypeScript puro | TypeScript puro | **No.** Nunca supo dónde vivía |
| Almacén | `ArchivoJsonl` | `Postgres` | **Sí**, pero es un adaptador nuevo contra un puerto existente, con la batería de tests ya escrita |
| Datos | `*.jsonl` | Tabla `eventos` | Cada línea es un `INSERT`. Un script de ~40 líneas |
| Impresión | ESC/POS local | Agente local liviano que recibe el buffer | Componente nuevo y pequeño |

**El único trabajo real de la migración son el adaptador de Postgres y el agente
de impresión.** Eso es lo que compramos al poner el puerto `AlmacenDeEventos` en
el día 1 en vez de llamar a `fs.appendFile` desde el dominio.

El esquema destino, cuando toque:

```sql
CREATE TABLE eventos (
  id           TEXT PRIMARY KEY,           -- el ULID, tal cual
  seq          BIGINT NOT NULL,
  negocio_id   TEXT NOT NULL,              -- multi-tenant desde el arranque
  ts           TIMESTAMPTZ NOT NULL,
  tipo         TEXT NOT NULL,
  v            INT NOT NULL,
  actor        JSONB NOT NULL,
  datos        JSONB NOT NULL,
  h            TEXT NOT NULL,
  UNIQUE (negocio_id, seq)
);
```

Los eventos se insertan sin transformación. Las proyecciones se vuelven tablas
materializadas. Nada del histórico se pierde ni se reinterpreta.

---

## 14. Plan de entrega

| Hito | Contenido | Resultado verificable |
|---|---|---|
| **H1 — Cimientos** | Puerto + `ArchivoJsonl`, esquemas de eventos, cadena de hash, recuperación de corrupción, esqueleto Fastify | Test que escribe 10 000 eventos, mata el proceso a la mitad y reconstruye sin perder ninguno |
| **H2 — Cobrar** | Catálogo, carrito, correlativo, idempotencia, medios de pago, pago mixto | Una venta real se cobra y sobrevive a reiniciar la PC |
| **H3 — Imprimir** | `renderTicket` + adaptador Windows + logo 1-bit + QR | Sale el papel |
| **H4 — Consultar** | Historial, reimpresión, anulación con motivo, enrutador de escaneos | Escanear un ticket abre su venta |
| **H5 — Existencias** | Inventario, kardex, alertas de mínimo | Vender una cera baja el stock; anular lo devuelve |
| **H6 — Cuadrar** | Apertura y cierre de turno, arqueo, reportes, exportación CSV | El cierre de un día real cuadra contra el cajón |
| **H7 — Clientes** | Fichas, historial, enrutador de fidelidad (modo local) | Escanear una tarjeta identifica al cliente |
| **H8 — Entrega** | Empaquetado `.exe`, servicio NSSM, instalador, respaldos automáticos, migración del catálogo, manual | El dueño lo usa una semana sin llamarte |

H1 es el que sostiene todo lo demás y es donde conviene no apurarse: un log de
eventos que pierde datos bajo corte de luz es un sistema que no sirve, y no se
nota hasta el día que pasa.

---

## 15. Riesgos

| Riesgo | Impacto | Qué hacemos |
|---|---|---|
| La impresora no habla ESC/POS estándar | Alto | Perfil configurable + fallback de QR a bitmap. Se cierra apenas sepamos el modelo |
| El reloj de la PC está mal | Alto — arruina todo el histórico | El encabezado muestra fecha y hora en grande. Aviso al arrancar si el reloj saltó hacia atrás |
| Se pierde el disco de la PC | **Crítico** | Respaldo automático a carpeta externa. **Hay que verificar que el destino exista de verdad**, no confiar en que se configuró |
| La pistola manda mal los acentos | Medio | Cotejo normalizado sin diacríticos (§7). Probar en sitio |
| Homónimos en el QR de fidelidad | Medio | Selector en pantalla; recomendación de pasar a `qrContent: "serial"` (§8) |
| El arqueo no cuadra por egresos no registrados | Medio | Documentado en §1. Los eventos están reservados y se encienden en una tarde |
| Cambio de alcance a mitad de obra | Alto | Este documento. Lo que no está en §2 no está en la v1 |

---

## 16. Qué necesito de ti para arrancar

1. **Modelo de la ticketera** (voltear el equipo y leer la etiqueta).
2. **Qué va en el ticket** — cuando lo tengas pensado. No bloquea: la plantilla
   es configuración.
3. **Catálogo real de productos** que venden (ceras, vapes, pipas, mallas,
   trimmers) con precios. Del Excel salen **solo 3 servicios de barbería**
   —CORTE CLASICO S/ 20, CORTE DEGRADADO S/ 25, BARBA S/ 10—; los otros 74
   ítems son la carta de cevichería ajena al negocio, y los productos que
   venden no están registrados en ningún lado. Mientras tanto corre una
   plantilla de ejemplo con precios inventados (`datos-ejemplo/plantilla-productos.json`)
   que hay que reemplazar antes de instalar.
4. **Nombres de los barberos** para la lista de atribución.
5. **Confirmar que el correlativo continúa en `NV000030`** y no arranca de cero.
6. Ideal, no urgente: el **logo en vectorial (SVG o AI)**. Con el PNG se puede
   trabajar, pero para la marca de impresión térmica y los íconos de la PWA, el
   vectorial da un resultado notablemente mejor.
