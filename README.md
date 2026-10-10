# POS La Cúpula

Punto de venta de **LA CÚPULA TATTOO BARBER SHOP**, una barbería de Lima.
Reemplaza la planilla de Excel con macros que usaban para cobrar.

> Los datos del negocio —nombre, dirección, RUC— se cargan al instalar, no
> están en el código. Y los archivos que el cliente manda (su catálogo, su
> planilla de ventas) no viven en este repositorio: son sus datos. Para las
> pruebas hay un catálogo de ejemplo con la misma estructura y nombres
> inventados.

Corre **local** en una PC con Windows y 4 GB de RAM, **sin base de datos**: los
datos viven en un log de eventos append-only en archivos, diseñado para migrar
a Postgres y a la nube sin reescribir el sistema. El porqué de cada decisión
está en **[`ARQUITECTURA.md`](./ARQUITECTURA.md)** — vale leerlo antes de tocar
nada.

## Estado

| Hito | Qué | Estado |
|---|---|---|
| H1 | Almacén de eventos JSONL: `fsync`, cadena de hash, recuperación de cortes de luz, un solo escritor | ✅ |
| H2 | Dominio de venta, catálogo, proyecciones, correlativo, idempotencia | ✅ |
| H3 | Impresión ESC/POS: CP850, plantilla como datos, logo 1 bit, QR con fallback, 3 transportes | ✅ |
| H4 | Historial, anulación con motivo, enrutador de escaneos | ✅ |
| H5 | Inventario y kardex | ✅ |
| H6 | Caja: turno, arqueo y cierre | ✅ |
| H7 | Clientes y tarjeta de fidelidad | ✅ |
| H8 | Empaquetado `.exe`, servicio de Windows, instalador, respaldos automáticos | ✅ |
| H9 | Ticketera Advance ADV-8010N: perfil de 48 columnas e impresión RAW por la cola de Windows | ✅ |
| H10 | Rediseño de la interfaz, primeros pasos guiados, lector de tickets | ✅ |
| H11 | Auditoría exportable y acceso remoto por Tailscale | ✅ |
| H12 | Egresos de caja, margen real, reposición y ventas por hora | ✅ |
| H13 | Listo para Railway: `PORT`, datos en Volumen persistente, candado de acceso opcional | ✅ |
| H14 | Aviso de reloj atrasado, alertas persistentes, propinas, cierre de turno impreso | ✅ |

**245 pruebas automatizadas** en verde: almacén de eventos (incluida la de corte
de luz a mitad de escritura), dominio, API de punta a punta, impresión ESC/POS,
importación de catálogo, reportes de margen, respaldos, auditoría, el candado
de acceso y las propinas.

### Lo que queda pendiente

**Los datos del negocio y el catálogo real.** El sistema arranca vacío a
propósito: nombre, dirección y RUC se cargan en Ajustes al instalar, y el
catálogo se sube desde el Excel (Ajustes → Catálogo).

La ticketera ya está confirmada: es una **Advance ADV-8010N**, y su perfil
(`advance80`, 48 columnas) viene elegido por defecto. Al instalar:
**Ajustes → Ticketera → Imprimir ticket de prueba**, y verificar en el papel que
la fila `1234567890…` entre en una sola línea.

## Historial de versiones

**v0.8.0** — reloj atrasado, alertas que se ven solas, propinas y el cierre de turno en papel.

- **Aviso de reloj atrasado.** Prometido desde el día 1 en ARQUITECTURA.md §15
  y nunca construido: solo se detectaba en retrospectiva, leyendo la auditoría
  después del daño. Ahora, al arrancar, se compara la hora de la PC contra el
  último evento del log; si quedó atrás, se avisa antes de que todo lo nuevo
  quede mal fechado.
- **Alertas persistentes.** El reloj atrasado, el respaldo externo que dejó de
  poder escribir, la ticketera configurada que no responde y las líneas
  apartadas por un corte de luz ahora se ven en una franja roja arriba de
  **cualquier pantalla**, no solo en Ajustes → Diagnóstico. Si no hay nada que
  avisar, no aparece nada — no es un cartel que haya que acostumbrarse a
  ignorar.
- **Propinas.** `venta.propina_registrada` estaba reservado desde el día 1 y se
  enciende ahora: un campo opcional al cobrar, para el barbero de la venta, que
  se puede agregar o corregir después desde el detalle de la venta en
  Historial. No es parte del cobro —no se suma al total, no pasa por los
  pagos, no la espera el arqueo— y no es una liquidación (D6 sigue intacta:
  sueldo fijo, sin comisiones). Reportes suma las propinas por barbero, por
  cuándo se anotaron.
- **Cierre de turno impreso.** El arqueo ya no vive solo en la pantalla: un
  botón imprime un papel con ventas, medios de pago, egresos con su motivo,
  diferencia de caja y producción por barbero — compacto, pensado para que lo
  lea el dueño aunque lo imprima quien está en el mostrador.

**v0.7.0** — listo para publicarse en Railway, sin tocar la instalación local.

- **`PORT` de Railway.** El servidor escuchaba solo `PUERTO`/7070; en la nube,
  la plataforma asigna el puerto y hay que escucharlo a ciegas. Ahora prueba
  `PORT`, después `PUERTO`, después 7070 — ninguna instalación existente
  cambia.
- **Falla fuerte si falta `POS_DATOS` en Railway.** El disco de un contenedor
  es efímero: sin esto, el primer despliegue arranca igual y escribe sobre un
  disco que desaparece con el contenedor. Se detecta el entorno (`RAILWAY_ENVIRONMENT`,
  que Railway pone solo) y si no hay `POS_DATOS` configurado, no arranca — con
  el mensaje exacto de qué falta, no un error genérico.
- **Candado de acceso opcional.** El sistema no tiene login por diseño (es
  parte de la arquitectura, pensado para una sola PC en la LAN del local, con
  Tailscale para el acceso remoto). Publicado en una URL de internet esa
  premisa no aplica: cualquiera que la encuentre podría cobrar, anular o leer
  clientes. `CLAVE_DE_ACCESO` activa un candado único (HTTP Basic, una sola
  clave compartida) **solo si se configura explícitamente** — la instalación
  de la barbería, que no define esa variable, sigue exactamente igual.
- **`railway.json`** con el build, el comando de arranque y el healthcheck
  (`/api/salud`, exceptuado del candado porque Railway no manda credenciales
  al revisarlo).

**v0.6.0** — que la caja cuadre, y que los reportes respondan qué comprar y a
qué hora.

- **Egresos de caja.** Era el agujero que la propia arquitectura marcaba como
  el más grande. El efectivo esperado pasa de `inicial + cobrado` a
  `inicial + cobrado − lo que salió`, y la pantalla muestra la cuenta
  desglosada en vez de un número solo: quien cuenta el cajón tiene que poder
  seguir de dónde sale la cifra contra la que lo comparan. El motivo es
  obligatorio — un egreso sin motivo es indistinguible de un faltante — y todas
  las salidas van a la auditoría, porque es la única forma de sacar plata de la
  caja sin que aparezca como venta.
- **El precio de compra se carga en tanda, junto al de venta.** El panel de
  precios tenía una sola columna, así que el costo había que cargarlo de a uno
  desde el formulario de edición: nadie lo hacía, y todo el reporte de margen
  quedaba en blanco. Ahora van las dos columnas juntas, porque los dos datos se
  cargan juntos — quien tiene el producto en la mano sabe a cuánto lo compró y a
  cuánto lo vende — y el margen aparece en vivo a medida que se escriben.
- **A qué hora se vende.** El dato estaba en el log desde el primer día y no se
  mostraba. Es la pregunta de gestión más barata de una barbería: cuándo
  conviene tener dos barberos y cuándo uno.
- **Qué hay que comprar.** No es la lista de agotados —esa es un número que no
  sirve para ir al proveedor— sino qué reponer, cuántas, cuánto costaría, y
  ordenado por lo que más se vende. Se copia de un botón para mandarla por
  WhatsApp.
- Y un arreglo: el ticket ya no imprime una etiqueta que se quedó sin su dato
  (un `RUC` suelto, sin número), y el asistente de primeros pasos pide los datos
  del negocio antes que nada.

**v0.5.0** — un ítem sin precio no se vende, una sola respuesta por pregunta, y
el repositorio sin datos de nadie.

- **Un producto sin precio no se puede vender** hasta que alguien le ponga
  precio desde Catálogo. Cambia la decisión de la v0.4.0, donde aparecía en la
  grilla y el cajero escribía el importe. El precio de lista es una decisión del
  dueño, no del mostrador: con precio abierto, el mismo producto se cobraba
  distinto según quién atendiera y el margen del reporte dejaba de significar
  algo. La regla vive en el dominio, así que la grilla, la pistola de escaneo y
  cualquier integración futura pasan por la misma validación.
- **Tres definiciones de «stock bajo» que no coincidían.** Sobre el catálogo
  real, el encabezado avisaba «0 con stock bajo» mientras la tabla de inventario
  marcaba 28 productos. Ahora hay una sola, en el dominio. De paso: mínimo 0
  significa «no fijé ningún mínimo» —que es el valor por defecto de un catálogo
  cargado sin esa columna— y con un mínimo fijado avisa al LLEGAR a ese número,
  no al pasarlo.
- **Seis rutas serializaban un ítem cada una a su manera**, y `/escaneo`
  devolvía el crudo: al escanear un producto sin precio, la pantalla mostraba
  «undefined todavía no tiene precio». Ahora todas pasan por el mismo lugar.
- **El mismo producto se llamaba distinto según la pantalla.** Las líneas de
  venta llevan marca desde la v0.4.0 y solo el detalle del historial la usaba.
- **Paquete liviano para mandarle al cliente** (`empaquetar-correo.mjs`): 22 MB
  en vez de 97, sin el instalador de Tailscale, que necesita configurarse en
  sitio. Avisa además que Gmail bloquea los `.exe` incluso dentro de un ZIP.
- **Fuera del repositorio todo dato de un negocio real**, para poder publicarlo:
  los datos del negocio se cargan al instalar y ya no están en el código, y el
  catálogo de prueba es de ejemplo.

**v0.4.0** — la plantilla del catálogo tomó la forma que le dio el cliente, y el
sistema aprendió los dos campos que le faltaban.

El cliente devolvió la plantilla de la v0.3.0 reescrita: sin la columna `Código`
—que el sistema genera solo— y con dos columnas nuevas, `MARCA` y
`PRECIO COMPRA`. No era un error de llenado: eran dos datos que su negocio
necesita y que el sistema no tenía. De ahí sale todo lo demás:

- **Marca** como campo propio, no pegada al nombre. Hace falta porque el
  catálogo real tiene nombres repetidos entre marcas —dos marcas distintas
  venden cada una su `TALCO`— y con un solo campo de texto esos dos productos son
  indistinguibles al cobrar. Permite filtrar el catálogo por marca y reportar
  ventas por marca. En el ticket se imprime solo en los productos: los servicios
  los hace La Cúpula y su nombre ya está en el encabezado.
- **Precio de compra** y, con él, **utilidad y margen reales**. El costo se
  lleva como **promedio ponderado móvil**: el `PRECIO COMPRA` de la planilla
  siembra el promedio y cada entrada de mercadería posterior lo recalcula. Al
  vender, ese promedio se **congela en la línea de venta**, así el reporte de un
  mes cerrado no se mueve nunca aunque después suba el costo.
- **Ítems sin precio: se cargan, pero no se venden.** El catálogo llegó con 119
  de 137 productos sin precio de venta, así que "sin precio" pasó a ser un
  estado válido y no un error. El ítem se crea, se le lleva el stock y aparece
  en Catálogo e Inventario, pero **no aparece en la pantalla de cobro** hasta
  que alguien le ponga precio. El precio de lista se pone desde Catálogo, de a
  uno o en tanda desde el panel de precios pendientes.

  La regla se aplica en el dominio y no escondiendo el botón: la pantalla de
  cobro, la pistola de escaneo y cualquier integración futura pasan por la misma
  validación. El precio de lista es una decisión del dueño, no del mostrador —
  si cada cajero pudiera ponerle precio a un producto sin precio, el mismo
  producto se cobraría distinto según quién atienda y el margen del reporte no
  significaría nada. Ajustar el precio de una línea puntual sí se puede, y queda
  registrado contra el de lista.
- **La planilla pone precios, nunca los borra.** Una celda de precio vacía
  significa "no lo sé", no "déjalo en nada". Sin esta regla, volver a subir la
  planilla de siempre —con esas celdas todavía vacías— habría destruido en
  silencio todos los precios completados a mano.
- **`STOCK` acepta `ILIMITADO`**, que es lo que el cliente escribió en sus siete
  servicios de barbería. Tiene razón: un corte de pelo no se agota.
- **Reportes rehechos**: períodos de calendario (hoy, 7 días, este mes, mes
  pasado, este año, rango libre) con comparación contra el período anterior del
  mismo largo; utilidad y margen por categoría, marca e ítem; inventario
  valorizado a costo y a precio de venta; productos que no rotan con la plata
  que tienen inmovilizada; y aviso de lo vendido por debajo del costo.

Regla que atraviesa los reportes: **lo que no se sabe se dice**. Un producto sin
costo cargado no tiene margen del 100%, no tiene margen calculable. Cada cifra de
utilidad viene con su cobertura —sobre qué parte de lo vendido se pudo calcular—
y donde falta el dato hay una raya, no un cero.

**v0.3.0** — carga del catálogo desde un Excel: se descarga una plantilla,
se llena fuera del sistema y se sube desde Ajustes, con vista previa de qué va
a cambiar y opción de agregar o de reemplazar todo.

**v0.2.0** — ticketera Advance con impresión por la cola de Windows (ya no hay
que compartir la impresora), cajón de dinero, cliente obligatorio en cada venta,
un solo barbero por venta elegido junto al cliente, códigos de catálogo
automáticos, export de auditoría y acceso remoto por Tailscale.

> Nota histórica: entre la v0.1.0 y la v0.2.0 el código del servidor se perdió y
> la versión entregada existía solo como bundle empaquetado. Se reconstruyó a
> TypeScript en este repositorio. **El código fuente viaja con la entrega** (va
> en el USB, en `_codigo-fuente/`) justamente para que no vuelva a pasar.

**v0.1.0** — primera versión completa: venta, catálogo, inventario, caja,
clientes, impresión ESC/POS, respaldos y empaquetado para Windows.

Cada versión es una **etiqueta de git**, no una carpeta con la fecha en el
nombre:

```bash
git tag -n1                  # qué versiones hay
git checkout v0.1.0          # ver una vieja
git checkout main            # volver
git diff v0.1.0 v0.2.0 --stat
```

Lo que sobrevive de antes de que hubiera git está en [`historia/`](./historia/),
y esa carpeta ya no crece.

### Sacar una versión nueva

```bash
npm test                                      # las pruebas primero
# subir "version" en package.json (raíz, apps/*, paquetes/*)
git commit -am "v0.5.0: …"
git tag -a v0.5.0 -m "…"
node herramientas/empaquetar-windows.mjs      # el .exe sale del código etiquetado
```

El `.exe` se **regenera desde el código**. Nunca se lo parchea poniéndole un
`servidor.js` al lado: así fue como se perdió el fuente de la v0.1.0.

## Arrancar en desarrollo

Requisitos: Node 22+.

```bash
npm install

# Terminal 1 — servidor + API (http://localhost:7070)
npm run dev

# Terminal 2 — PWA con recarga en caliente (http://localhost:5180)
npm run dev:pwa
```

En desarrollo los datos van a `datos-dev/` (no se versiona). En Windows, a
`C:\POSCupula\datos`. Se puede forzar con `POS_DATOS=/ruta/que/sea`.

### Llenarlo con datos para probar

```bash
npm run dev                                    # en otra terminal
node herramientas/sembrar-demostracion.mjs     # catálogo, ventas, caja y clientes
```

Siembra por el API —las mismas validaciones que una venta hecha a mano— un
catálogo con marcas y costos, un producto sin precio para ver ese caso, once
ventas, un turno de caja y clientes inventados. Alcanza para que los reportes
muestren márgenes de verdad.

Para probar la carga desde Excel, en **Ajustes → Catálogo** se descarga la
plantilla y se sube llena. El catálogo de ejemplo de las pruebas sirve también
para esto:

```
apps/servidor/pruebas/fijos/catalogo-de-ejemplo.xlsx
```

Son 137 filas con los casos que traía el archivo real del primer cliente —119
productos sin precio, `ILIMITADO` en el stock de los servicios, marcas escritas
con espacios de más, dos marcas con un producto del mismo nombre— y nombres
inventados.

> `herramientas/extraer-catalogo-excel.py` es la herramienta de migración que se
> usó una sola vez, para sacar los servicios del Excel con macros que la
> barbería usaba antes. Ese archivo no está en el repositorio (ver la nota del
> encabezado), así que el script no corre tal cual: queda como registro de cómo
> se hizo la migración.

## Compilar y entregar

```bash
npm run build                                  # PWA + servidor en un solo .mjs
node herramientas/empaquetar-windows.mjs       # + .exe, instalador y LEEME en entrega/
```

`entrega/` es lo que se copia a la PC de la barbería. Necesita además
**`nssm.exe`** (de <https://nssm.cc/download>, carpeta `win64`) al lado de
`INSTALAR.cmd`; el empaquetador no lo descarga para no redistribuir binarios de
terceros desde el repositorio. Después: clic derecho en `INSTALAR.cmd` →
*Ejecutar como administrador*.

La guía paso a paso para instalar en sitio está en
`entrega/INSTRUCCIONES-ROBERT.txt`, y el instructivo del cliente en
`entrega/LEEME.txt`.

El instalador registra el POS como servicio de Windows, así que arranca solo al
encender la PC y se reinicia solo si se cae. Reinstalar por encima **no toca la
carpeta de datos**.

### Mandárselo al cliente para que lo instale solo

```bash
node herramientas/empaquetar-correo.mjs        # ZIP liviano en entrega-correo/
```

Es `entrega/` sin lo que el cliente no necesita para instalar: se va el
instalador de Tailscale (37 MB) y su script, porque el acceso remoto hay que
configurarlo en sitio —se inicia sesión una vez en esa PC—. Quedan 22 MB, con
un LEEME corto de instalación en vez del de 180 líneas.

> **Gmail no deja adjuntarlo.** Rechaza los mensajes con un ejecutable adjunto,
> y adentro hay un `.exe` y dos `.cmd`. No alcanza con comprimirlo: Gmail abre
> el ZIP y mira adentro. Se sube a Drive y se manda el enlace — es además lo más
> fácil para el cliente, porque Windows abre ZIPs normales sin instalar nada.
>
> Con `--clave MICLAVE` sale cifrado y Gmail lo deja pasar, pero el Explorador
> de Windows no abre ZIPs con contraseña y el cliente tendría que instalar
> 7-Zip. `entrega-correo/COMO-ENVIARLO.txt` explica las dos vías y lo que hay
> que avisarle antes (la pantalla de "Windows protegió tu PC", y que hay que
> descomprimir antes de instalar).

## Desplegar en Railway

Esto es **adicional** a la instalación en la PC de la barbería, no un
reemplazo: la impresora ESC/POS y el lector de tickets son hardware local, y
un contenedor en la nube no les llega. Lo que sí sirve corriendo en Railway es
el mismo API + PWA para catálogo, reportes, caja, clientes — todo salvo
imprimir desde un cajón físico.

**Antes de generar una URL pública, decidir sobre `CLAVE_DE_ACCESO` (ver
abajo).** Sin ella, cualquiera que encuentre la URL puede cobrar, anular,
cambiar precios o leer la ficha de un cliente: hoy esa protección la da la LAN
del local y Tailscale, y ninguna de las dos existe en una URL de internet.

1. **railway.app → New Project → Deploy from GitHub repo**, elegir
   `pos-la-cupula`. Railway lee `railway.json` del repo: ya sabe compilar
   (`npm run build`), arrancar (`npm start`) y a qué ruta pegarle para el
   healthcheck (`/api/salud`).
2. **Antes de que termine el primer despliegue, crear el Volumen:**
   el servicio → pestaña **Volumes** → *New Volume* → punto de montaje
   `/data`. Sin esto el POS no arranca a propósito (ver v0.7.0 más abajo) —
   es preferible que falle claro a que pierda datos en el primer `git push`.
3. **Settings → Variables**, agregar:
   - `POS_DATOS` = `/data` (la ruta del Volumen del paso 2)
   - `CLAVE_DE_ACCESO` = una clave larga, random, que no se use en ningún otro
     lado — **recomendado antes de exponerlo a internet**. Sin esta variable
     el POS queda abierto, igual que en la LAN.
   - `PORT` no se toca: Railway la pone sola y el servidor ya la respeta.
4. **Settings → Networking → Generate Domain** cuando se quiera la URL
   pública. Railway por sí solo (sin este paso) no es alcanzable desde
   internet — así que hasta este punto se puede probar todo sin riesgo.
5. Cada `git push` a `main` dispara un build y despliegue nuevos solo —
   es el despliegue continuo pedido. El Volumen (los datos) sobrevive a cada
   uno; el resto del contenedor se reconstruye desde cero.

Si entra `CLAVE_DE_ACCESO`, el navegador pide usuario `cupula` y la clave la
primera vez y la recuerda. Es un candado único para todo el local —no hay
usuarios ni roles— a propósito: así se mantiene la decisión de "sin login"
que tiene el sistema para la PC de la barbería (§1, decisión D3 de
`ARQUITECTURA.md`), sin reescribirla para la nube.

## Verificar

```bash
npm test                                            # las 245 pruebas
npm run verificar-capas                             # que el dominio no toque archivos, red ni reloj
node apps/servidor/dist/pos-cupula.mjs verificar    # integridad del log en disco
```

`verificar-capas` es lo que protege la promesa de migración: si alguien importa
`fs` dentro de `src/dominio/`, el build falla. Una regla que no se chequea se
rompe sola en tres meses.

## Estructura

```
apps/servidor/     API Fastify + dominio + adaptadores
  src/dominio/       reglas de negocio — TypeScript puro, cero I/O
  src/puertos/       interfaces: AlmacenDeEventos, Impresora, Reloj
  src/adaptadores/   implementaciones intercambiables
    almacen/           archivos JSONL hoy, Postgres mañana
    impresora/         ESC/POS, CP850, plantilla, logo 1 bit, QR
                       (una sola pasada produce el papel Y la vista previa)
  src/proyecciones/  estado consultable, reconstruido desde el log
  src/servicios/     Pos (sección crítica) y Respaldos
apps/pwa/          React + Vite + Tailwind, instalable
paquetes/contratos/  tipos y esquemas compartidos por servidor y PWA
herramientas/      migración, íconos, logo térmico, empaquetado, capas
marca/             el logo original y su versión térmica
entrega/           el paquete listo para Windows (generado)
```

## Atajos del mostrador

| Tecla | Qué hace |
|---|---|
| `F2` | Foco en el buscador |
| `F4` | Cobrar |
| `Esc` | Cerrar diálogo · limpiar búsqueda · vaciar ticket |
| `+` / `−` | Cantidad de la línea |

La pistola QR se detecta sola por la cadencia de las teclas (menos de 35 ms
entre una y otra) y funciona con el foco donde sea.

## El ticket

El contenido es **configuración, no código**: un arreglo de bloques (`logo`,
`texto`, `separador`, `lineas`, `totales`, `pagos`, `qr`, `corte`) que se edita
sin recompilar. La plantilla por defecto replica lo que ya imprimía el Excel y
corrige sus dos defectos: la descripción truncada a 18 caracteres y la falta de
detalle de los pagos.

El QR lleva `CUP1|V|NV000030`. Escaneado con la pistola, abre esa venta en el
POS. La versión va en el prefijo desde el día uno, así que cambiar el formato
mañana no deja ilegibles los tickets viejos.

## Tres cosas que hay que tener presentes

**El arqueo no descuenta egresos.** La v1 no registra las salidas de efectivo
del cajón (compras, adelantos, taxi), así que la diferencia del cierre es una
referencia, no una verdad. El evento `caja.egreso_registrado` está reservado en
el contrato: encenderlo es trabajo de una tarde. La advertencia aparece en la
pantalla de caja, junto al número, a propósito.

**El QR de fidelidad lleva el nombre, no un identificador.** El programa de La
Cúpula en TarjetaCloud está en modo `qrContent: "nombre"`, y con eso dos
clientes homónimos son indistinguibles. El POS lo detecta y pregunta en vez de
elegir al azar. La solución de fondo es pasar el programa a `qrContent:
"serial"` — es un cambio de configuración en el dashboard de TarjetaCloud, no
código.

**Sin carpeta externa no hay respaldo que valga.** Las copias automáticas
—cada hora con el POS encendido y solo si hubo movimientos, más una al cerrar
cada turno— van al mismo disco que los datos, lo que protege de un borrado
accidental pero no de que el disco falle. Configurar el destino externo en
Ajustes es obligatorio; el sistema lo verifica escribiendo un archivo de prueba
y lo avisa en rojo si no funciona.

Se conservan las últimas 24 copias horarias y los últimos 30 cierres: un día con
detalle fino y un mes para volver más atrás. Las dos series se podan por
separado, porque una poda única dejaría que los respaldos horarios expulsaran a
los diarios en dos días y medio.

> Hasta la v0.2.0 el respaldo automático corría **solo** a las 23:00, y el "en
> cada cierre de turno" que prometía esta misma documentación no existía. En una
> barbería que cierra a las 21:00 y apaga la PC, esa hora no llegaba nunca: no
> se hacía un solo respaldo automático, y Ajustes igual mostraba el cartel verde
> porque el destino externo sí era escribible.

## Qué falta del cliente

1. **Marca y modelo de la ticketera** (voltear el equipo y leer la etiqueta).
2. **Qué va en el ticket**, si quiere cambiar la plantilla por defecto.
3. **Catálogo real de productos** con precios.
4. **Nombres de los barberos.**
5. **Carpeta de respaldo externa**: OneDrive o un USB que quede siempre puesto.
