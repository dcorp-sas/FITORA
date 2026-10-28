# Fitora

PWA de entrenamiento en español. Explorá ejercicios, armá rutinas, registrá cada serie y seguí tu progreso desde el teléfono o la computadora.

## Funciones

- Catálogo de ejercicios en español, con búsqueda, filtros, instrucciones e ilustraciones de RepDB.
- Rutinas sugeridas y rutinas propias que se pueden crear, editar y borrar.
- Sesiones libres o guiadas, con edición de ejercicios, series, repeticiones y pesos.
- Temporizador de sesión, pausa, reanudación y descansos configurables.
- Historial por sesión, progresión por ejercicio, racha, sesiones semanales y volumen.
- Guardado local automático, reanudación de sesiones pendientes y copias JSON para exportar/importar.
- Cuenta opcional y sincronización cifrada en la VPS exclusiva de Premium; la versión gratuita sigue siendo local.
- Suscripción mensual con formulario de tarjeta embebido de Mercado Pago. Fitora no procesa ni almacena números de tarjeta.
- PWA instalable; después de cargar el catálogo una vez, la app y el catálogo funcionan sin conexión. Las ilustraciones vistas recientemente se conservan en caché.

## Ejecutar e instalar

Abrí `index.html` para una vista local. La imagen Docker y el workflow de este repositorio permiten publicar Fitora de forma independiente en una VPS: el contenedor escucha en `127.0.0.1:8088` y se actualiza al subir cambios a `main`. Configurá en este repositorio los secretos `VPS_HOST`, `VPS_USER` y `VPS_SSH_KEY_B64` (la clave privada SSH codificada en Base64); `VPS_PORT` es opcional y usa `22` por defecto. El usuario remoto necesita Docker Compose y permiso para ejecutar Docker.

Para usar `https://fitora.fitsystem.com.ar/`, el proxy HTTPS de la VPS debe dirigir ese host al servicio Fitora en el puerto `8088`. El DNS del subdominio debe apuntar a la VPS. Cuando esté online, abrí el dominio en el teléfono y elegí “Agregar a pantalla de inicio”.

## Datos y atribución

El catálogo se obtiene desde [RepDB](https://github.com/RepDB/exercise-dataset) y se mantiene en caché local para uso sin conexión. La licencia del nivel gratuito permite el uso dentro de aplicaciones con atribución. Atribución: [Exercise data by RepDB (repdb.co)](https://repdb.co/). Ver [licencia del dataset](https://github.com/RepDB/exercise-dataset/blob/main/LICENSE-DATA.md).

## Fitora Premium y privacidad

El plan local guarda los datos solamente en el dispositivo. Para confirmar una cuenta con email/contraseña o Google, la persona debe aceptar la suscripción mensual y completar el pago embebido. Google se usa solo para identificar la cuenta de Fitora; no se solicita acceso a Drive. Una cuenta queda pendiente hasta que Mercado Pago confirma la suscripción; si el pago no se completa, se elimina automáticamente en 24 horas o se puede cancelar manualmente. Con Premium activo se sincronizan entrenamientos, rutinas, perfil, mediciones y ejercicios propios. La copia se cifra en reposo en la VPS. Al cancelar una suscripción activa se elimina la copia remota y los datos locales no se borran. Se puede exportar un JSON local desde Progreso.

El cobro es mensual en pesos argentinos, con precio predeterminado de AR$ 10.000 (editable con `FITORA_PREMIUM_PRICE_ARS`). El checkout queda apagado si faltan las credenciales de Mercado Pago. El Card Payment Brick muestra el formulario dentro de Fitora; el navegador solo entrega al backend el token de tarjeta. No se reciben ni guardan datos de tarjeta en la app. Configurá en **Settings → Secrets and variables → Actions** del repositorio:

- Variable `MP_PUBLIC_KEY` (clave pública de producción).
- Secret `MP_ACCESS_TOKEN` (Access Token de producción; no es el Client ID ni el Client Secret).
- Secret `MP_WEBHOOK_SECRET` (clave de firma creada en la configuración de webhooks de Mercado Pago).
- Variable opcional `FITORA_PREMIUM_PRICE_ARS` (precio mensual en ARS; predeterminado: `10000`).
- Variable `GOOGLE_CLIENT_ID` (ID del cliente OAuth web; permite iniciar sesión con Google, sin acceso a Drive).

La URL para notificaciones es `https://fitora.fitsystem.com.ar/api/webhooks/mercadopago`. Configurá el evento de suscripción/preapproval. El workflow de despliegue transfiere estos valores de Actions a un archivo privado de la VPS y reinicia únicamente el servicio Fitora; no modifica Fit System ni la configuración del proxy. El checkout no se habilita hasta que estén todos los valores y el servidor reciba la confirmación firmada de Mercado Pago. Para Google, creá un cliente OAuth de tipo aplicación web y autorizá el origen `https://fitora.fitsystem.com.ar`; el ID se configura en la variable `GOOGLE_CLIENT_ID`.

Las instrucciones de ejercicios son informativas y no reemplazan asesoramiento profesional.


## Entrenamiento extendido y apps nativas

Fitora incluye ciclos adaptativos de 4 semanas con descarga y regreso gradual después de pausas, reprogramación desde el calendario, edición del historial, registro de cardio por tiempo/distancia, avisos de récords, cálculo de calentamiento y discos. Las preferencias del ciclo y las fechas programadas se incluyen en el respaldo Premium; las fotos siguen locales.

La app nativa usa Capacitor y `@capgo/capacitor-health` para importar entrenamientos autorizados desde Apple Health y Health Connect. Las actividades que un reloj haya sincronizado con esos servicios aparecen en el historial de Fitora. La conexión pide solo permiso de lectura de entrenamientos. La PWA sigue funcionando sin Salud.

### Preparar Android o iOS

Requiere Node.js 22 o posterior. Después de clonar el repositorio:

```sh
npm ci
npm run cap:sync
```

El comando genera el bundle de Salud, actualiza Android/iOS y configura la app para cargar la versión publicada de Fitora. Abrí `android/` con Android Studio para compilar Android; abrí `ios/App/App.xcworkspace` con Xcode en macOS para compilar iOS. Apple requiere equipo de firma/desarrollador y HealthKit activado para distribuir la app.

La integración importa entrenamientos ya registrados por el reloj o por otras apps en Salud; Fitora todavía no incluye una app de muñeca independiente para registrar cada serie desde Apple Watch o Wear OS.
