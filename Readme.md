


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
