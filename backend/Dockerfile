# ─── Etapa de construcción ───────────────────────────────────────────────────
# Usamos Node 20 Alpine para imagen mínima y segura
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar solo los manifiestos primero para aprovechar cache de capas
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# ─── Etapa final ─────────────────────────────────────────────────────────────
FROM node:20-alpine

# Metadatos de la imagen
LABEL maintainer="StreamURU Team" \
      description="Backend API para StreamURU"

WORKDIR /app

# Copiar dependencias ya instaladas desde la etapa anterior
COPY --from=builder /app/node_modules ./node_modules

# Copiar el código fuente
COPY . .

# Seguridad: cambiar propietario a usuario 'node' (no root)
RUN chown -R node:node /app

# Cambiar al usuario 'node' para no ejecutar como root
USER node

# Puerto que expone el servidor Express
EXPOSE 4000

# Comando de inicio en producción
CMD ["node", "src/index.js"]
