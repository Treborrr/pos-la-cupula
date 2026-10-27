# Plan: multisucursal

Estado: IMPLEMENTADO el 27 de octubre de 2026. Las siete fases están hechas,
con 36 pruebas propias (410 en total, todas en verde).

Decidido con el cliente el 25 de octubre de 2026.

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

Sin migración destructiva, y al final ni siquiera hizo falta un upcaster.

`sedeId` entró como campo OPCIONAL en los eventos que lo ganaron, que es lo que
la regla 4 del contrato ya permitía ("agregar un campo opcional no requiere
subir `v`"). Un evento sin `sedeId` se lee como `principal`, que es exactamente
lo que significaba: cuando se escribió había un solo local y era ese. Es el
mismo camino que ya había usado `categoria` en `caja.egreso_registrado`.

El correlativo se ENSANCHÓ en vez de cambiarse (`/^NV\d{6}$/` pasó a
`/^[A-Z]{2,4}\d{6}$/`), y ensanchar nunca invalida lo ya escrito.

El archivo en disco no se toca, ningún evento subió de versión, y el gancho de
`upcasters.ts` sigue ahí sin usar para el día que haga falta de verdad.

Al arrancar, si no existe ninguna sucursal, se siembra "principal" con los datos
que hoy están en la configuración `negocio.*`. Para el cliente actual no cambia
nada: sigue viendo su local y su numeración `NV`.

## Fases

Cada fase se despliega sola y deja el sistema funcionando.

> Lo que sigue es el plan tal como se acordó. Se cumplió completo, con dos
> cambios que el plan no había previsto y que aparecieron al construirlo:
>
> 1. **No hizo falta ningún upcaster.** `sedeId` entró como campo OPCIONAL, que
>    la regla 4 del contrato ya permitía, y un evento sin él se lee como
>    `principal`. El archivo en disco no se toca y tampoco hubo que subir
>    ninguna versión de evento.
> 2. **El límite de sesiones de cajero estaba atado a un solo local.**
>    `ServicioDeSesiones` permitía UN cajero logueado en todo el sistema. Con
>    varias sucursales, la cajera del segundo local al entrar echaba al cajero
>    del primero. Ahora el límite es por local. Lo encontró una prueba nueva.

### F1. La entidad Sucursal

Eventos nuevos: `sede.creada`, `sede.actualizada`, `sede.desactivada`.
Campos: `id`, `nombre`, `direccion`, `ciudad`, `pie`, `prefijoTicket`, `activa`.
Pantalla de administración en Ajustes. Siembra de "principal".

No toca nada existente. El sistema sigue comportándose igual.

### F2. Ventas y caja por sucursal

`sedeId` en `venta.registrada`, `caja.turno_abierto`, `caja.egreso_registrado`
y `caja.turno_cerrado`, como campo opcional (ver arriba: no hicieron falta
upcasters).

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

## Lo que se construyó

**Dominio.** `dominio/sedes/sedes.ts` (alta, edición, baja, siembra de la
principal) y `dominio/inventario/traslados.ts`. El stock pasó a llevarse por
par (sucursal, producto) y el correlativo, por sucursal.

**HTTP.** `/api/sedes` con su alta, edición, baja, stock por local y traslados;
`/api/catalogo/:id/precio-sede`; `/api/usuarios/:id/sede`. La sucursal de cada
petición la resuelve `autorizacion.ts`.

**Pantallas.** Ajustes → Sucursales, selector de local en el encabezado (solo
ADMIN y solo con más de uno), traslado desde la ficha de inventario, precios por
sucursal debajo del precio general, y elección de local al crear un cajero.

**Pruebas.** 36 nuevas: 23 de dominio (`sedes.prueba.ts`), 11 de API
(`sedesApi.prueba.ts`) y 2 del límite de sesiones por local. 410 en total.

La regresión con la que más se habría perdido, y que tiene prueba propia:
`arquear` recorría TODAS las ventas y egresos. Sin filtrar por sucursal, una
venta cobrada en otro local con la caja cerrada entraba como "cobrada fuera de
turno" en el arqueo de este, y el cajón esperaba plata que estaba a 200 km.
