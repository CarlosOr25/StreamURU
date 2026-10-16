# 📹 Plataforma de Video Segura (Tipo YouTube con Streaming UDP)

Proyecto para la materia de **Seguridad Informática**.

---

## 🎯 Requisitos y Entregables del Proyecto
Basado en las directrices de la materia:

1. **Manejo de Videos (HTTP/TCP)**:
   * **CRUD de Videos**: Registro, subida de archivos de video, consulta de metadatos, edición y eliminación.
   * **Autenticación**: Registro e inicio de sesión seguro con contraseñas hasheadas (`bcrypt` / `argon2`) y tokens de sesión protegidos.
   * **Autorización y Visibilidad de Videos**:
     * 🟢 **Público**: Accesible en el catálogo para cualquier usuario.
     * 🟡 **Oculto (Unlisted)**: No visible en listas públicas; accesible únicamente mediante ID / enlace directo.
     * 🔴 **Privado**: Acceso exclusivo restringido al usuario propietario del video.
2. **Streaming por UDP**:
   * Transmisión de paquetes de video desde el servidor hacia el cliente web mediante protocolo **UDP** (implementado sobre WebRTC/SRTP).
   * Reproducción progresiva en tiempo real en la página web.
3. **Almacenamiento en Bucket Storage (Self-Hosted)**:
   * Implementado con **MinIO** (compatible con API S3).
   * Almacenamiento seguro y privado de archivos multimedia sin acceso público directo.
4. **Arquitectura Docker (docker-compose)**:
   * Orquestación de Frontend, Backend API, Servidor de Streaming UDP, Base de Datos y MinIO Storage.
   * Segmentación de red interna para aislar bases de datos y storage de accesos externos no autorizados.
5. **Diagramas de Secuencia**:
   * Diagrama de secuencia para medios de transporte HTTP/TCP (Control, Autenticación, Subida).
   * Diagrama de secuencia para medio de transporte UDP (Autorización con ticket efímero, Handshake y Transmisión de video).

---

## 🛡️ Medidas de Seguridad Implementadas
* **Gestión Segura de Secretos**: Variables sensibles y llaves maestras aisladas en `.env` (excluido de Git vía `.gitignore`).
* **Tokens de Streaming Efímeros (Tickets de un solo uso)**: El reproductor web no accede directamente al archivo de video; solicita un token firmado temporal al Backend (validando visibilidad y propiedad).
* **Cifrado en Tránsito**: 
  * HTTP/TCP con cabeceras de seguridad contra inyecciones y XSS.
  * UDP cifrado de extremo a extremo mediante **SRTP (AES-128/256)** vía WebRTC.
* **Prevención de IDOR**: Identificadores criptográficos UUID v4 para almacenamiento de archivos en el bucket.
* **Aislamiento de Red**: MinIO y Base de Datos corren en una red Docker privada sin mapeo de puertos hacia la red pública del host.

