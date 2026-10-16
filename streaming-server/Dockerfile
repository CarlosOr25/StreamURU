# ─────────────────────────────────────────────────────────────────
# StreamURU — Streaming Server (UDP/WebRTC)
# Dockerfile
# ─────────────────────────────────────────────────────────────────
# ETAPA 1: Builder — instala dependencias (incluyendo compilación
#           nativa de node-datachannel)
# ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Dependencias de compilación para node-datachannel (bindings nativos C++)
# cmake, g++, make y python3 son requeridos por node-gyp
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cmake \
    linux-headers \
    openssl-dev

WORKDIR /app

# Copiar manifiestos primero para aprovechar el cache de capas Docker
COPY package.json ./

# Instalar dependencias en modo producción
# --ignore-scripts=false permite que node-datachannel compile su addon nativo
RUN npm install --omit=dev

# ─────────────────────────────────────────────────────────────────
# ETAPA 2: Runtime — imagen final liviana
# ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Librerías de runtime necesarias para el addon nativo de node-datachannel
RUN apk add --no-cache \
    libstdc++ \
    openssl

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
    CMD wget -qO- http://localhost:5000/health || exit 1

# Comando de inicio
CMD ["node", "src/server.js"]
