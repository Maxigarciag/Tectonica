# Pulso de la Tierra

Earthquake data pipeline: ingest from USGS → transform → analyze → visualize.

## Estructura

```
pulso-de-la-tierra/
├── docs/                 # Vault de Obsidian (notas, análisis, reportes)
├── src/
│   └── ingest/
│       └── usgs.py       # Ingesta desde USGS Earthquake API
├── data/
│   └── raw/              # JSON crudo descargado (git-ignored)
├── tests/
│   └── fixtures/         # Datos de prueba
├── .gitignore
└── README.md
```

## Uso rápido

```bash
# Instalar dependencias
pip install requests

# Descargar últimos 7 días (magnitud ≥ 2.5)
python -m src.ingest.usgs --days 7 --min-mag 2.5

# Personalizar directorio de salida
python -m src.ingest.usgs --days 30 --out data/raw
```

## USGS API

- Endpoint: `https://earthquake.usgs.gov/fdsnws/event/1/query`
- Formato: GeoJSON
- Límites: 20,000 eventos por request, rate limit razonable

## Vault Obsidian (`docs/`)

Abrir la carpeta `docs/` como vault en Obsidian para:
- Notas diarias de sismicidad
- Análisis de patrones
- Plantillas de reporte
- Enlaces a fuentes y papers