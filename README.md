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

Abrí `index.html` para una vista local. Para publicarla en GitHub Pages, en el repositorio abrí **Settings → Pages** y elegí **GitHub Actions** como fuente una vez. El workflow de `.github/workflows/deploy.yml` publica automáticamente cada cambio en `main`; la dirección prevista es `https://dcorp-sas.github.io/FITORA/`. Cuando esté online, abrí esa dirección en el teléfono y elegí “Agregar a pantalla de inicio”.

## Datos y atribución

El catálogo se obtiene desde [RepDB](https://github.com/RepDB/exercise-dataset) y se mantiene en caché local para uso sin conexión. La licencia del nivel gratuito permite el uso dentro de aplicaciones con atribución. La app muestra **Exercise data by RepDB (repdb.co)**. Ver [licencia del dataset](https://github.com/RepDB/exercise-dataset/blob/main/LICENSE-DATA.md).

Los registros de entrenamiento y rutinas permanecen en el dispositivo. Usá “Exportar copia” para guardarlos y “Importar copia” para restaurarlos o combinarlos con los datos actuales. Las instrucciones de ejercicios son informativas y no reemplazan asesoramiento profesional.

