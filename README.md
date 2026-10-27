# Fitora

PWA de entrenamiento en español. Explorá ejercicios, armá rutinas, registrá cada serie y seguí tu progreso desde el teléfono o la computadora.

## Funciones

- Catálogo de ejercicios en español, con búsqueda, filtros, instrucciones e ilustraciones de RepDB.
- Rutinas sugeridas y rutinas propias que se pueden crear, editar y borrar.
- Sesiones libres o guiadas, con edición de ejercicios, series, repeticiones y pesos.
- Temporizador de sesión, pausa, reanudación y descansos configurables.
- Historial por sesión, progresión por ejercicio, racha, sesiones semanales y volumen.
- Guardado local automático, reanudación de sesiones pendientes y copias JSON para exportar/importar.
- PWA instalable; después de cargar el catálogo una vez, la app y el catálogo funcionan sin conexión. Las ilustraciones vistas recientemente se conservan en caché.

## Ejecutar e instalar

Abrí `index.html` para una vista local. La imagen Docker y el workflow de este repositorio permiten publicar Fitora de forma independiente en una VPS: el contenedor escucha en `127.0.0.1:8088` y se actualiza al subir cambios a `main`. Configurá en este repositorio los secretos `VPS_HOST`, `VPS_USER` y `VPS_SSH_KEY`; `VPS_PORT` es opcional y usa `22` por defecto. El usuario remoto necesita Docker Compose y permiso para ejecutar Docker.

Para usar `https://fitora.fitsystem.com.ar/`, el proxy HTTPS de la VPS debe dirigir ese host al servicio Fitora en el puerto `8088`. El DNS del subdominio debe apuntar a la VPS. Cuando esté online, abrí el dominio en el teléfono y elegí “Agregar a pantalla de inicio”.

## Datos y atribución

El catálogo se obtiene desde [RepDB](https://github.com/RepDB/exercise-dataset) y se mantiene en caché local para uso sin conexión. La licencia del nivel gratuito permite el uso dentro de aplicaciones con atribución. La app muestra **Exercise data by RepDB (repdb.co)**. Ver [licencia del dataset](https://github.com/RepDB/exercise-dataset/blob/main/LICENSE-DATA.md).

Los registros de entrenamiento y rutinas permanecen en el dispositivo. Usá “Exportar copia” para guardarlos y “Importar copia” para restaurarlos o combinarlos con los datos actuales. Las instrucciones de ejercicios son informativas y no reemplazan asesoramiento profesional.

