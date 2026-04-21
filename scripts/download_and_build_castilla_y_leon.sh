#!/usr/bin/env bash
set -euo pipefail

URL="https://download.geofabrik.de/europe/spain/castilla-y-leon-latest.osm.pbf"
DATA_DIR="$(pwd)/data"
FILE_NAME="castilla-y-leon-latest.osm.pbf"
OUTPUT_PM="castilla_y_leon.pmtiles"

JAVA_MEM="-Xmx4g"
MINZOOM=0
MAXZOOM=16

mkdir -p "$DATA_DIR"

cd "$DATA_DIR"

if [ ! -f "$FILE_NAME" ]; then
  echo "Descargando $FILE_NAME..."
  wget -c "$URL" -O "$FILE_NAME"
else
  echo "Ya existe $FILE_NAME, no se vuelve a descargar."
fi

echo "Entrada:"
ls -lh "$FILE_NAME"

echo "Generando $OUTPUT_PM..."
docker run --rm \
  -e JAVA_TOOL_OPTIONS="$JAVA_MEM" \
  -v "$DATA_DIR:/data" \
  ghcr.io/onthegomap/planetiler:latest \
  --download \
  --force \
  --osm-path="/data/$FILE_NAME" \
  --output="/data/$OUTPUT_PM" \
  --minzoom="$MINZOOM" \
  --maxzoom="$MAXZOOM"

echo "Salida:"
ls -lh "$OUTPUT_PM"

echo "Reiniciando Martin..."
docker compose restart martin

echo "Listo."
echo "Catalogo: http://localhost:3000/catalog"
echo "Fuente:   http://localhost:3000/castilla_y_leon"
echo "Visor:    http://localhost:8081/?source=castilla_y_leon"
