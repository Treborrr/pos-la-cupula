# Plan: multisucursal

Estado: propuesta, sin empezar. Decidido con el cliente el 25 de octubre de 2026.

`ARQUITECTURA.md` lista "multisucursal" como fuera de alcance de la v1. Esto lo
saca de esa lista, igual que la v0.11.0 sacó "multiusuario y roles".

## Decisiones del cliente

1. **Cada sucursal tiene sus propios precios.** Catálogo compartido (un mismo
   producto es el mismo producto en toda la cadena), precio por sucursal.
2. **Cada cajero pertenece a una sucursal** y solo ve esa. No rota.
3. **Hay traslados de stock entre sucursales.**

## Lo que es de cada sucursal y lo que es de la cadena

| De cada sucursal | De la cadena |
|---|---|
| Stock | Catálogo (qué productos existen) |
| Precios | Clientes y su fidelidad |
| Caja, turnos y egresos | Usuarios y roles |
| Serie de correlativo | RUC y razón social |
| Ventas | |
| Barberos | |
| Dirección del ticket | |

El RUC es de la empresa, no del local: en Perú una empresa tiene un RUC y varios
establecimientos anexos. Lo que cambia por sucursal es la dirección impresa en
el ticket.

## Por qué un solo servicio y no uno por sucursal

Separar en dos servicios de Railway duplica justo la columna derecha de la
tabla. Un cambio de catálogo habría que hacerlo dos veces, y el día que alguien
se olvide, las sucursales venden distinto. Peor: los clientes quedarían partidos
por local, y la fidelidad dejaría de acumular para quien se atiende en dos
sitios. Eso no se arregla después sin un merge manual.

Además, el panel consolidado que el cliente quiere es un filtro cuando hay un
solo log de eventos, y es un subsistema de red entero cuando hay dos.

El argumento a favor de separar sería que una sucursal no se caiga con la otra.
Pero al estar publicado en Railway, hoy ya comparten esa suerte.

## Cómo se migra lo que ya existe

Sin migración destructiva. `paquetes/contratos/src/upcasters.ts` está cableado
desde el día 1 justo para esto: se sube `VERSION_ACTUAL` de los eventos que
ganan `sedeId` y el upcaster de v1 a v2 les inyecta `sedeId: "principal"` AL
LEER. El archivo en disco no se toca.

Al arrancar, si no existe ninguna sucursal, se siembra "principal" con los datos
que hoy están en la configuración `negocio.*`. Para el cliente actual no cambia
nada: sigue viendo su local y su numeración `NV`.

## Fases

Cada fase se despliega sola y deja el sistema funcionando.

### F1. La entidad Sucursal

Eventos nuevos: `sede.creada`, `sede.actualizada`, `sede.desactivada`.
Campos: `id`, `nombre`, `direccion`, `ciudad`, `pie`, `prefijoTicket`, `activa`.
Pantalla de administración en Ajustes. Siembra de "principal".

No toca nada existente. El sistema sigue comportándose igual.

### F2. Ventas y caja por sucursal

`sedeId` en `venta.registrada`, `caja.turno_abierto`, `caja.egreso_registrado`
y `caja.turno_cerrado`, con sus upcasters.

Correlativo por sucursal: hoy `ultimoCorrelativo` es un contador único en
`Proyeccion.ts:69`. Pasa a ser un contador por sucursal, con el prefijo de cada
una. La principal sigue en la serie `NV` que el cliente ya conoce desde el
Excel; las nuevas arrancan con la suya.

Un turno de caja pertenece a una sucursal. Dos sucursales pueden tener la caja
abierta a la vez, hoy imposible.

### F3. Stock por sucursal

`Proyeccion.ts:60` pasa de `Map<itemId, number>` a stock por par
(sucursal, producto). `sedeId` en `stock.entrada`, `stock.ajustado` y
`stock.merma`. Kardex y alertas de stock mínimo quedan por sucursal.

### F4. Precios por sucursal

Evento nuevo `item.precio_sede_cambiado` con `{itemId, sedeId, precio}`.
El precio del catálogo queda como precio por defecto de la cadena; cada
sucursal puede sobrescribirlo. Si no lo hace, hereda.

Se hereda en vez de obligar a cargar el precio en cada sucursal porque el
catálogo real tiene cientos de productos y cargarlos N veces garantiza olvidos.

### F5. Usuarios atados a su sucursal

`sedeId` en el usuario. El hook de `autorizacion.ts` resuelve la sucursal desde
la sesión, no desde lo que mande el navegador: un cajero no puede cobrar en otra
sucursal ni pidiéndolo a mano. El ADMIN elige sucursal, o "todas".

### F6. Traslados entre sucursales

Evento `stock.traslado` con `{itemId, desdeSedeId, haciaSedeId, cantidad,
motivo}`. Un solo evento mueve los dos lados, así es imposible que exista medio
traslado (que salga de un local y no entre en el otro).

### F7. Reportes consolidados y selector

Selector de sucursal en el encabezado para el ADMIN. Reportes por sucursal y
consolidados de la cadena. Comparar sucursales entre sí.

## Lo que queda pendiente aparte

**La impresora.** Cada sucursal tiene su ticketera y su pistola, que son
hardware local, y desde la nube no se llega. Hoy producción corre sin ticketera
(`"disponible": false`). `ARQUITECTURA.md` ya lo tiene identificado como "agente
local liviano" pendiente. No es un problema nuevo de la segunda sucursal, pero
con varios locales se multiplica.

## Estimación

Cinco o seis sesiones de trabajo. Toca el núcleo del dominio: las tres
decisiones del cliente son las tres opciones más completas.
