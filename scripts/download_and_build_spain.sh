#!/usr/bin/env bash
set -euo pipefail

# =========================
# Configuración
# =========================
URL="https://download.geofabrik.de/europe/spain-latest.osm.pbf"
DATA_DIR="$(pwd)/data"
FILE_NAME="spain-latest.osm.pbf"
OUTPUT_PM="spain.pmtiles"

# Ajusta memoria según tu máquina
JAVA_MEM="-Xmx8g"

# Zoom (cambia si quieres)
MINZOOM=0
MAXZOOM=16

# =========================
# Preparación
# =========================
mkdir -p "$DATA_DIR"

echo "📥 Descargando mapa de España..."
cd "$DATA_DIR"

# Descarga con reanudación
wget -c "$URL" -O "$FILE_NAME"

echo "📦 Tamaño descargado:"
ls -lh "$FILE_NAME"

# =========================
# Generar PMTiles
# =========================
echo "🧱 Generando PMTiles con Planetiler..."

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

echo "📦 PMTiles generado:"
ls -lh "$DATA_DIR/$OUTPUT_PM"

# =========================
# Reiniciar Martin
# =========================
echo "🔁 Reiniciando Martin..."
docker compose restart martin

echo "✅ Todo listo!"
echo "🌍 Prueba en:"
echo "   http://localhost:3000/catalog"
echo "   http://localhost:8081/?source=spain"
