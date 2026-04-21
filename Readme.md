


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
