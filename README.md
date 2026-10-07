# Vulcanizadora Express

Sitio web de Vulcanizadora Express inspirado en la referencia visual compartida. La entrada requiere una cuenta; el contenido del sitio aparece después de iniciar sesión. Las cuentas, sesiones y solicitudes de servicio se guardan en MongoDB.

## Requisitos

- Node.js 18 o posterior
- MongoDB local o una instancia de MongoDB Atlas

## Configuración

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` a `.env`.
3. Configura `MONGODB_URI` con la URI de tu base local o de Atlas.
4. Reemplaza `SESSION_SECRET` por un secreto privado de al menos 32 caracteres. No lo compartas ni subas `.env` al repositorio.
5. Inicia el sitio con `npm start` y abre `http://localhost:3000`.

En PowerShell puedes copiar el archivo de configuración así:

```powershell
Copy-Item .env.example .env
```

## Funciones

- Registro con contraseña protegida mediante hash; el sitio nunca almacena la contraseña en el navegador.
- Inicio y cierre de sesión con cookie `HttpOnly` y sesión respaldada en MongoDB. “Recordarme” conserva la sesión por 30 días y recuerda únicamente el correo en ese navegador.
- Solicitudes de servicio asociadas a la cuenta y visibles en “Mis pedidos”.
- Navegación adaptable y animaciones de GSAP/ScrollTrigger, con respeto a la preferencia de movimiento reducido.

Las imágenes y tipografías se cargan de servicios externos. Los precios aparecen como “Por confirmar” para no publicar tarifas no especificadas; el costo debe confirmarse antes de comenzar el servicio.
