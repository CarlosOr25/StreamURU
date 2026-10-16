# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile — Frontend de StreamURU
#
# Imagen: nginx:alpine  (ligera, ~5 MB)
# Puerto interno: 80  →  expuesto como 3000 en docker-compose
# ─────────────────────────────────────────────────────────────────────────────

FROM nginx:alpine

# Metadatos
LABEL maintainer="StreamURU Team"
LABEL description="Frontend estático de StreamURU servido por nginx"

# Eliminar la configuración predeterminada de nginx
RUN rm -f /etc/nginx/conf.d/default.conf

# Copiar configuración personalizada de nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Copiar archivos estáticos del frontend
COPY src/ /usr/share/nginx/html/

# nginx escucha en el puerto 80 dentro del contenedor.
# En docker-compose se mapea al puerto 3000 del host.
EXPOSE 80

# Ejecutar nginx en foreground (necesario para que Docker lo mantenga activo)
CMD ["nginx", "-g", "daemon off;"]
