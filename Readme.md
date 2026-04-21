


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
