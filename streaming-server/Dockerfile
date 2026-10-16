# ─────────────────────────────────────────────────────────────────
# StreamURU — Streaming Server (UDP/WebRTC)
# Dockerfile
# ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./

# Instalar dependencias (en Debian bookworm node-datachannel descarga binarios precompilados sin compilar C++)
RUN npm install --omit=dev

# ─────────────────────────────────────────────────────────────────
# ETAPA 2: Runtime — imagen final liviana
# ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# Instalar curl para healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo y asignar al usuario no-root 'node'
WORKDIR /app
RUN chown node:node /app

# Copiar node_modules compilados desde el builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Copiar código fuente
COPY --chown=node:node package.json ./
COPY --chown=node:node src/          ./src/

# Ejecutar como usuario no-root (buena práctica de seguridad en contenedores)
USER node

# Puerto HTTP de señalización WebRTC
EXPOSE 5000

# Healthcheck: verifica que el servidor HTTP responde
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Comando de inicio
CMD ["node", "src/server.js"]
