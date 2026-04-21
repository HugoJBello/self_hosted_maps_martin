


crear mapas
```
docker run --rm \
  -e JAVA_TOOL_OPTIONS="-Xmx4g" \
  -v "$PWD/data:/data" \
  -v "$PWD/output:/output" \
  ghcr.io/onthegomap/planetiler:latest \
  --download \
  --osm_path=/data/tu_fichero.osm.pbf \
  --output=/output/map.pmtiles \
  --zoom=0-14

mv output/map.pmtiles data/map.pmtiles
docker compose restart martin


docker run --rm \
  -e JAVA_TOOL_OPTIONS="-Xmx8g" \
  -v "$PWD/data:/data" \
  ghcr.io/onthegomap/planetiler:latest \
  --download \
  --force \
  --osm-path=/data/spain-260414.osm.pbf \
  --output=/data/spain.pmtiles \
  --minzoom=0 \
  --maxzoom=16

```


examples

http://localhost:48081/?points=41.65,-4.72;41.66,-4.70;41.64,-4.69

http://localhost:48081/?route=41.65,-4.72;41.66,-4.70;41.67,-4.68;41.69,-4.66


https://api-android18.hjbello.org/maps/?source=castilla_y_leon&route=41.65,-4.72;41.66,-4.70;41.64,-4.69


Puntos con etiquetas al clicar:

```
http://localhost:48081/?points=41.65,-4.72;41.66,-4.70&labels=Valladolid;Otro%20punto
```

Puntos con etiquetas e iconos:

```
http://localhost:48081/?points=41.65,-4.72;41.66,-4.70&labels=Valladolid;Destino&icons=📍;⭐
```

También se puede pasar una lista JSON de marcadores en `markers`:

```
http://localhost:48081/?markers=%5B%7B%22lat%22%3A41.65%2C%22lon%22%3A-4.72%2C%22label%22%3A%22Valladolid%22%2C%22icon%22%3A%22pin%22%7D%5D
```

Para evitar URLs largas, publicar un JSON y pasarlo con `overlay`:

```
http://localhost:48081/?overlay=/overlay.json
```

Formato de `overlay.json`:

```json
{
  "points": [[-4.72, 41.65]],
  "route": [[-4.72, 41.65], [-4.70, 41.66]],
  "polygon": [[-4.72, 41.65], [-4.70, 41.66], [-4.69, 41.64]],
  "markers": [
    {
      "lat": 41.65,
      "lon": -4.72,
      "label": "Valladolid",
      "icon": "pin"
    }
  ]
}
```

En JSON las coordenadas como array van en orden GeoJSON: `[lon, lat]`.
El icono `pin` se dibuja inline y no requiere cargar una imagen. Los iconos de imagen relativos se cargan desde el visor (`/maps/archivo.svg` en despliegue). También se pueden usar URLs absolutas.

Muchos puntos desde otro frontend o Django
------------------------------------------

Para muchos puntos no conviene crear un marcador HTML por cada punto. El visor usa una capa GeoJSON de MapLibre con clustering, por lo que puede consumir directamente un GeoJSON generado por Django u otro frontend/backend.

URL del visor:

```
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
        "label": "Valladolid"
      }
    }
  ]
}
```

También se puede poner el `FeatureCollection` directamente dentro de `markers`, pero para datasets grandes es mejor usar una URL. Si esa URL está en otro dominio, el backend debe permitir CORS. `markersBounds` permite que el visor centre el mapa sin tener que calcular bounds en el navegador para un GeoJSON remoto.

`markerOptions.render` puede ser `"layer"` para muchos puntos o `"dom"` para pocos marcadores con iconos HTML personalizados. Si no se indica, los puntos masivos usan capa y los iconos inline mantienen el comportamiento anterior.

Ejemplo mínimo en Django:

```python
from django.http import JsonResponse


def map_overlay(request, dataset_id):
    return JsonResponse({
        "markers": f"/api/map-points/{dataset_id}.geojson",
        "markersBounds": [-4.90, 41.50, -4.50, 41.80],
        "markerOptions": {"cluster": True},
    })


def map_points(request, dataset_id):
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-4.72, 41.65]},
            "properties": {"label": "Valladolid"},
        }
    ]
    return JsonResponse({"type": "FeatureCollection", "features": features})
```
