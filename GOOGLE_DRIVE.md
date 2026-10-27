# Activar el respaldo en Google Drive

Fitora puede guardar y restaurar una copia en el espacio privado de datos de la aplicación (`appDataFolder`). Google lo oculta de la lista normal de archivos de Drive y solo Fitora puede acceder a él. El permiso usado es `drive.appdata`; no se pide acceso a los demás archivos del usuario.

Para habilitarlo:

1. En Google Cloud Console, seleccioná o creá un proyecto y habilitá Google Drive API.
2. Configurá la pantalla de consentimiento OAuth y agregá tu cuenta como usuario de prueba si la app sigue en modo de prueba.
3. Creá un ID de cliente OAuth de tipo **Aplicación web**.
4. En **Orígenes autorizados de JavaScript**, agregá `https://fitora.fitsystem.com.ar`.
5. Abrí Fitora → **Perfil** → **Respaldo en Google Drive**, pegá el identificador que termina en `apps.googleusercontent.com` y guardalo.
6. Usá **Guardar copia en Drive**. Para mover los datos a otro dispositivo, ingresá el mismo identificador allí y usá **Restaurar desde Drive** con la misma cuenta de Google.

El identificador de cliente web es público; no pegues ni publiques el secreto de cliente. Fitora solicita el permiso de Google solo cuando se pulsa guardar o restaurar. El respaldo local de JSON sigue disponible en la pantalla Progreso.
