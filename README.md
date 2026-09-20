# POS La Cúpula

Punto de venta de **LA CÚPULA TATTOO BARBER SHOP** (Av. Siempre Viva 742,
SMP — Lima). Reemplaza el archivo `NOTA DE VENTA CUPULA.xlsm`.

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

**107 pruebas automatizadas** en verde: almacén de eventos (incluida la de corte
de luz a mitad de escritura), dominio, API de punta a punta, impresión ESC/POS,
respaldos y auditoría.

### Lo que queda pendiente

**La lista real de productos con sus precios y los nombres de los barberos.**
El sistema arranca vacío a propósito: `datos-ejemplo/plantilla-productos.json`
tiene precios inventados y hay que reemplazarla.

La ticketera ya está confirmada: es una **Advance ADV-8010N**, y su perfil
(`advance80`, 48 columnas) viene elegido por defecto. Al instalar:
**Ajustes → Ticketera → Imprimir ticket de prueba**, y verificar en el papel que
la fila `1234567890…` entre en una sola línea.

## Historial de versiones

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
git commit -am "v0.3.0: …"
git tag -a v0.3.0 -m "…"
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

### Cargar un catálogo

```bash
# Extrae del Excel los servicios de barbería y detecta los códigos repetidos
python3 herramientas/extraer-catalogo-excel.py

# Los carga por el API (idempotente: se puede correr dos veces)
node herramientas/cargar-catalogo.mjs datos-ejemplo/catalogo-del-excel.json
node herramientas/cargar-catalogo.mjs datos-ejemplo/plantilla-productos.json
```

> ⚠️ `plantilla-productos.json` tiene **precios inventados**. Los productos que
> vende la barbería (ceras, vapes, pipas, mallas, trimmers) no estaban en el
> Excel. Hay que reemplazarla por la lista real antes de instalar.

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

## Verificar

```bash
npm test                                            # las 94 pruebas
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
