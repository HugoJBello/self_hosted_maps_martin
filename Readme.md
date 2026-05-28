# Self Hosted Maps Martin

Proyecto para servir mapas vectoriales locales con [Martin](https://maplibre.org/martin/) y visualizarlos con una UI embebible basada en Express + MapLibre GL JS. El flujo habitual es:

1. Descargar un `.osm.pbf`.
2. Generar un `.pmtiles` con Planetiler.
3. Servirlo con Martin.
4. Abrir el visor web y pasar puntos, rutas, polígonos o overlays por URL o JSON.

## Estructura

```text
.
├── data/                         # Ficheros .osm.pbf y .pmtiles
├── martin/config.yaml            # Configuración de Martin
├── scripts/                      # Scripts de descarga y generación
├── viewer/
│   ├── Dockerfile                # Imagen Node/Express del visor
│   ├── package.json              # Dependencias del visor
│   ├── server.js                 # Servidor Express
│   ├── index.html                # Entrada HTML del visor
│   ├── assets/
│   │   ├── app.css               # Interfaz y estados responsive
│   │   └── app.js                # Logica MapLibre y compatibilidad de parametros
│   ├── pin.svg                   # Icono de ejemplo
│   └── style.json                # Estilo simple de ejemplo
├── docker-compose.yml            # Martin + visor Node/Express
└── Readme.md
```

## Puertos

- Visor: `http://localhost:48081/`
- Visor con prefijo historico: `http://localhost:48081/maps/`
- Martin: `http://localhost:43000/`
- Catalogo Martin: `http://localhost:43000/mapas/tiles/catalog`
- TileJSON de una fuente: `http://localhost:43000/mapas/tiles/{source}`

En despliegue publico el visor espera poder llegar a Martin con el prefijo `/mapas/tiles`. En local usa `http://localhost:43000/mapas/tiles`, que coincide con `route_prefix` en `martin/config.yaml`.

## UI del Visor

El servicio `map-viewer` ya no es nginx estatico. Ahora es una aplicacion Express que:

- Sirve la UI en `/` y `/maps/` para conservar URLs existentes.
- Sirve MapLibre desde `node_modules`, sin depender del CDN de MapLibre.
- Mantiene los query params antiguos: `source`, `points`, `labels`, `icons`, `route`, `polygon`, `markers` y `overlay`.
- Añade controles de fuente, centrado, visibilidad de capas, estado de carga y copia de iframe.
- Permite modo compacto para embeds con `embed=1` o `chrome=0`.
- No envia `X-Frame-Options`, y define `frame-ancestors *` para permitir uso dentro de iframes. Restringir ese valor en produccion si se quiere limitar que dominios pueden embeber el visor.

### Rutas del Visor

| Ruta | Uso |
| --- | --- |
| `/` | UI principal. |
| `/maps/` | Alias compatible con despliegues que publican el visor bajo `/maps/`. |
| `/healthz` | Healthcheck JSON del visor. |
| `/api/tilejson/{source}` y `/maps/api/tilejson/{source}` | Proxy interno de TileJSON. Reescribe `tiles` a rutas relativas `/mapas/tiles/...` para evitar mixed content. |
| `/assets/*` y `/maps/assets/*` | CSS y JS propios. |
| `/vendor/maplibre-gl/*` y `/maps/vendor/maplibre-gl/*` | Assets locales de MapLibre. |

### Embed en iframe

Ejemplo minimo:

```html
<iframe
  src="http://localhost:48081/maps/?source=castilla_y_leon&embed=1"
  width="100%"
  height="520"
  style="border:0"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade">
</iframe>
```

`embed=1` y `chrome=0` ocultan la barra superior y el panel lateral. El mapa conserva controles nativos, marcadores, rutas, poligonos y popups.

### Martin en Otro Origen

El visor acepta un parametro opcional `martinBase` para pruebas o despliegues especiales:

```text
http://localhost:48081/maps/?source=spain&martinBase=http://localhost:43000/mapas/tiles
```

En produccion se recomienda mantener Martin detras del mismo dominio mediante `/mapas/tiles`, porque reduce problemas de CORS y hace los iframes mas faciles de integrar.

Por defecto, el navegador no lee el TileJSON directamente desde Martin. Lo pide al visor en `/api/tilejson/{source}` o `/maps/api/tilejson/{source}` cuando la UI esta publicada bajo `/maps/`, y Express lo obtiene desde `MARTIN_BASE_INTERNAL` (`http://martin:3000/mapas/tiles` en Docker Compose). Esto evita que Martin publique plantillas de tiles con `http://...` cuando el visor esta en HTTPS.

## Arranque

```bash
docker compose up -d
```

Abrir:

```text
http://localhost:48081/?source=castilla_y_leon
```

Tambien funciona con el prefijo historico:

```text
http://localhost:48081/maps/?source=castilla_y_leon
```

Si se cambia un `.pmtiles` o la configuración de Martin:

```bash
docker compose restart martin
```

## Fuentes de mapa

Martin sirve todos los `.pmtiles` y `.mbtiles` que encuentre en `data/`. El nombre de la fuente es el nombre del fichero sin extensión.

Ejemplos:

- `data/castilla_y_leon.pmtiles` -> `source=castilla_y_leon`
- `data/spain.pmtiles` -> `source=spain`

URL del visor:

```text
http://localhost:48081/?source=spain
```

## Generar Mapas

### Castilla y León

```bash
./scripts/download_and_build_castilla_y_leon.sh
```

### España

```bash
./scripts/download_and_build_spain.sh
```

### Comando Planetiler manual

```bash
docker run --rm \
  -e JAVA_TOOL_OPTIONS="-Xmx8g" \
  -v "$PWD/data:/data" \
  ghcr.io/onthegomap/planetiler:latest \
  --download \
  --force \
  --osm-path=/data/spain-latest.osm.pbf \
  --output=/data/spain.pmtiles \
  --minzoom=0 \
  --maxzoom=16
```

Después:

```bash
docker compose restart martin
```

## Parámetros del Visor

El visor se controla con query params.

| Parametro | Uso |
| --- | --- |
| `source` | Fuente Martin. Por defecto `castilla_y_leon`. |
| `points` | Lista de puntos `lat,lon;lat,lon`. |
| `labels` | Etiquetas para los puntos, separadas por `;`. Se muestran al clicar. |
| `icons` | Iconos para los puntos, separados por `;`. |
| `route` | Ruta simple `lat,lon;lat,lon;...`. |
| `polygon` | Polígono simple `lat,lon;lat,lon;...`. |
| `markers` | JSON inline de marcadores. |
| `overlay` | URL a un JSON de overlay. Recomendado para datos grandes. |

En los query params `points`, `route` y `polygon` el orden es `lat,lon`.

En JSON y GeoJSON el orden es el estándar GeoJSON: `[lon, lat]`.

## Puntos

Puntos simples:

```text
http://localhost:48081/?points=41.65,-4.72;41.66,-4.70;41.64,-4.69
```

Puntos con etiquetas al clicar:

```text
http://localhost:48081/?points=41.65,-4.72;41.66,-4.70&labels=Valladolid;Otro%20punto
```

Si no se pasan `labels` ni `icons`, los puntos se pintan como capa GeoJSON. Si se pasan etiquetas o iconos, se convierten en marcadores con popup.

## Iconos

Iconos por texto o emoji:

```text
http://localhost:48081/?points=41.65,-4.72;41.66,-4.70&labels=Valladolid;Destino&icons=📍;⭐
```

Icono inline incluido por el visor:

```text
http://localhost:48081/?points=41.65,-4.72&labels=Valladolid&icons=pin
```

Icono por fichero o URL:

```text
http://localhost:48081/?points=41.65,-4.72&labels=Valladolid&icons=pin.svg
```

También se aceptan:

- Rutas absolutas: `/maps/pin.svg`
- URLs absolutas: `https://example.com/icon.png`
- Imágenes `data:image/...`
- Ficheros `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`

## Marcadores JSON

Para evitar URLs largas con muchos campos, usar `markers` o, mejor, `overlay`.

Ejemplo de `markers` inline codificado en URL:

```text
http://localhost:48081/?markers=%5B%7B%22lat%22%3A41.65%2C%22lon%22%3A-4.72%2C%22title%22%3A%22Paciente%201%22%2C%22label%22%3A%22Valladolid%22%2C%22icon%22%3A%22pin%22%7D%5D
```

El JSON original seria:

```json
[
  {
    "lat": 41.65,
    "lon": -4.72,
    "title": "Paciente 1",
    "label": "Valladolid",
    "icon": "pin"
  }
]
```

Campos aceptados por marcador:

| Campo | Uso |
| --- | --- |
| `lat`, `lon` | Coordenadas en objeto. También valen `latitude`, `longitude` o `lng`. |
| `coord` | Coordenada `[lon, lat]`. |
| `coordinates` | Coordenada `[lon, lat]`. |
| `title` | Título del popup. |
| `label`, `text`, `name` | Etiqueta principal del popup. |
| `message`, `mensaje` | Mensaje visible en el popup. |
| `detail`, `details`, `detalle` | Detalle secundario del mensaje. |
| `description` | Texto/html descriptivo. |
| `popup` | HTML del popup. |
| `html` | HTML del popup. |
| `url`, `href` | Enlace del popup. |
| `linkLabel`, `link_label` | Texto del enlace. Por defecto `Ver mensaje`. |
| `icon` | Emoji, texto, `pin`, fichero de imagen o URL. |

Nota de seguridad: `popup`, `html` y `description` se insertan como HTML. Usarlos solo con contenido generado por una fuente de confianza o sanitizado en backend. Para texto normal es mejor `message` y `detail`.

## Mensajes y Detalles al Clicar

Ejemplo recomendado en un overlay:

```json
{
  "markers": [
    {
      "lat": 41.65,
      "lon": -4.72,
      "title": "Registro 123",
      "label": "Valladolid",
      "message": "Respuesta incoherente detectada",
      "detail": "Paciente: A17 · Cuestionario: inicial · Fecha: 2026-05-27",
      "url": "/admin/recordings/123/",
      "linkLabel": "Abrir registro",
      "icon": "pin"
    }
  ]
}
```

Al clicar el marcador se muestra un popup con título, etiqueta, mensaje, detalle y enlace. En capas masivas (`markerOptions.render = "layer"`) el popup también funciona, pero los iconos personalizados no se dibujan como DOM.

## Rutas

Ruta simple por URL:

```text
http://localhost:48081/?route=41.65,-4.72;41.66,-4.70;41.67,-4.68;41.69,-4.66
```

En overlay:

```json
{
  "route": [[-4.72, 41.65], [-4.70, 41.66], [-4.68, 41.67]]
}
```

Varias rutas:

```json
{
  "routes": [
    [[-4.72, 41.65], [-4.70, 41.66]],
    [[-4.69, 41.64], [-4.66, 41.69]]
  ]
}
```

## Rutas GeoJSON

`routeGeoJSON` acepta:

- `FeatureCollection`
- `Feature`
- `LineString`
- `MultiLineString`
- URL a un GeoJSON

Ejemplo inline:

```json
{
  "routeGeoJSON": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {"name": "Ruta A"},
        "geometry": {
          "type": "LineString",
          "coordinates": [[-4.72, 41.65], [-4.70, 41.66]]
        }
      },
      {
        "type": "Feature",
        "properties": {"name": "Ruta B"},
        "geometry": {
          "type": "LineString",
          "coordinates": [[-4.69, 41.64], [-4.66, 41.69]]
        }
      }
    ]
  }
}
```

Ejemplo con URL:

```json
{
  "routeGeoJSON": "/api/map-routes/123.geojson",
  "routeBounds": [-4.90, 41.50, -4.50, 41.80]
}
```

`routeBounds` es recomendable para rutas grandes cargadas por URL, porque permite centrar el mapa sin tener que calcular todos los bounds en el navegador.

## Polígonos

Por URL:

```text
http://localhost:48081/?polygon=41.65,-4.72;41.66,-4.70;41.64,-4.69
```

En overlay:

```json
{
  "polygon": [[-4.72, 41.65], [-4.70, 41.66], [-4.69, 41.64]]
}
```

El visor cierra el anillo automáticamente si el primer y último punto no coinciden.

## Overlay JSON

Usar `overlay` cuando haya muchos datos o campos de popup.

URL:

```text
http://localhost:48081/?source=castilla_y_leon&overlay=/overlay.json
```

Formato completo:

```json
{
  "points": [[-4.72, 41.65]],
  "polygon": [[-4.72, 41.65], [-4.70, 41.66], [-4.69, 41.64]],
  "route": [[-4.72, 41.65], [-4.70, 41.66]],
  "routes": [
    [[-4.72, 41.65], [-4.70, 41.66]],
    [[-4.69, 41.64], [-4.66, 41.69]]
  ],
  "routeGeoJSON": "/api/map-routes/123.geojson",
  "routeBounds": [-4.90, 41.50, -4.50, 41.80],
  "markers": [
    {
      "lat": 41.65,
      "lon": -4.72,
      "title": "Registro 123",
      "label": "Valladolid",
      "message": "Mensaje principal",
      "detail": "Detalle secundario",
      "url": "/admin/recordings/123/",
      "linkLabel": "Abrir registro",
      "icon": "pin"
    }
  ],
  "markersBounds": [-4.90, 41.50, -4.50, 41.80],
  "markerOptions": {
    "cluster": true,
    "clusterMaxZoom": 14,
    "clusterRadius": 50,
    "render": "layer"
  }
}
```

No se puede combinar `overlay.markers` por URL con `markers` inline o puntos etiquetados, porque el visor no descarga y fusiona dos datasets remotos. En ese caso debe devolverlo todo desde el backend en un único overlay.

## Muchos Puntos con GeoJSON

Para muchos puntos conviene usar una capa MapLibre con clustering, no un marcador HTML por punto.

URL del visor:

```text
http://localhost:48081/?source=castilla_y_leon&overlay=/api/map-overlay/123/
```

Respuesta recomendada de `/api/map-overlay/123/`:

```json
{
  "markers": "/api/map-points/123.geojson",
  "markersBounds": [-4.90, 41.50, -4.50, 41.80],
  "markerOptions": {
    "cluster": true,
    "clusterMaxZoom": 14,
    "clusterRadius": 50,
    "render": "layer"
  }
}
```

Respuesta de `/api/map-points/123.geojson`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [-4.72, 41.65]
      },
      "properties": {
        "title": "Registro 123",
        "label": "Valladolid",
        "message": "Respuesta incoherente detectada",
        "detail": "Paciente: A17",
        "url": "/admin/recordings/123/",
        "linkLabel": "Abrir registro"
      }
    }
  ]
}
```

`markerOptions.render`:

- `"layer"`: recomendado para muchos puntos. Soporta clustering y popup al clicar.
- `"dom"`: recomendado para pocos marcadores cuando se necesitan iconos HTML personalizados.

## Ejemplo Django

Overlay con puntos y rutas grandes:

```python
from django.http import JsonResponse


def map_overlay(request, dataset_id):
    return JsonResponse({
        "markers": f"/api/map-points/{dataset_id}.geojson",
        "markersBounds": [-4.90, 41.50, -4.50, 41.80],
        "markerOptions": {"cluster": True, "render": "layer"},
        "routeGeoJSON": f"/api/map-routes/{dataset_id}.geojson",
        "routeBounds": [-4.90, 41.50, -4.50, 41.80],
    })


def map_points(request, dataset_id):
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-4.72, 41.65]},
            "properties": {
                "title": "Registro 123",
                "label": "Valladolid",
                "message": "Respuesta incoherente detectada",
                "detail": "Paciente: A17",
                "url": "/admin/recordings/123/",
                "linkLabel": "Abrir registro",
            },
        }
    ]
    return JsonResponse({"type": "FeatureCollection", "features": features})


def map_routes(request, dataset_id):
    features = [
        {
            "type": "Feature",
            "properties": {"name": "Ruta A"},
            "geometry": {
                "type": "LineString",
                "coordinates": [[-4.72, 41.65], [-4.70, 41.66]],
            },
        }
    ]
    return JsonResponse({"type": "FeatureCollection", "features": features})
```

Si esas URLs están en otro dominio, el backend debe permitir CORS.

## Ejemplos Rápidos

Mapa base:

```text
http://localhost:48081/?source=castilla_y_leon
```

Puntos:

```text
http://localhost:48081/?points=41.65,-4.72;41.66,-4.70;41.64,-4.69
```

Ruta:

```text
http://localhost:48081/?route=41.65,-4.72;41.66,-4.70;41.67,-4.68;41.69,-4.66
```

Overlay:

```text
http://localhost:48081/?source=castilla_y_leon&overlay=/api/map-overlay/123/
```

Despliegue publico:

```text
https://api-android18.hjbello.org/maps/?source=castilla_y_leon&route=41.65,-4.72;41.66,-4.70;41.64,-4.69
```

## Diagnóstico

Ver contenedores:

```bash
docker compose ps
```

Ver logs:

```bash
docker compose logs martin
docker compose logs map-viewer
```

Comprobar salud del visor:

```text
http://localhost:48081/healthz
```

Comprobar catalogo:

```text
http://localhost:43000/mapas/tiles/catalog
```

Errores habituales:

- `No se pudo leer TileJSON`: la fuente no existe, el nombre de `source` no coincide con el `.pmtiles` o Martin no está levantado.
- Mapa sin datos: revisar que el `.pmtiles` tenga bounds correctos y que el `source` sea el esperado.
- Overlay remoto no carga: revisar CORS y que devuelva JSON válido.
- Icono no aparece: revisar ruta relativa al visor. En despliegue, los ficheros del visor funcionan tanto desde `/` como desde `/maps/`.
- Assets de MapLibre no aparecen: reconstruir `map-viewer` para instalar dependencias Node dentro de la imagen.
- `AJAXError: Failed to fetch (0)` con tiles `http://.../mapas/tiles/...` en un visor publicado por HTTPS: reconstruir y redesplegar `map-viewer`. El visor usa `/api/tilejson/{source}` para reescribir las plantillas de tiles a rutas relativas y sirve HTML/JS/CSS con `Cache-Control: no-store` para evitar que una version antigua quede cacheada.
