# OCR: recuperación de interrupciones

## Problema reproducido

La herramienta independiente de OCR guardaba el resultado únicamente al terminar
todo el documento. Cancelar o agotar el límite de reconocimiento durante la segunda
página descartaba la primera, sin revisión ni descarga parcial; el reintento
empezaba desde la página 1.

## Corrección

- Cada página terminada genera un checkpoint en memoria, antes de iniciar la siguiente.
- Cancelaciones y errores conservan esos resultados y ofrecen reanudar desde la
  primera página pendiente, con un nuevo motor local.
- Revisar o corregir una palabra del resultado parcial no pierde esa corrección al reanudar.
- La exportación se separó del reconocimiento: cada descarga se construye desde
  el archivo original, con una única capa nueva para las páginas completadas.
  Descargar, corregir y volver a descargar no acumula capas de esta ejecución.
- El PDF parcial conserva todas las páginas originales. El nombre termina en
  `_searchable_partial.pdf`; la interfaz indica cuántas páginas fueron procesadas.
  El TXT y el texto copiado incluyen una advertencia de resultado parcial.
- Cambiar las opciones requiere descartar explícitamente el avance, evitando mezclar
  escalas de reconocimiento o resultados de archivos diferentes.
- Los fallos de exportación no borran el reconocimiento. Un chequeo estructural que
  falla se informa como no completado, no como ausencia de pérdidas.

## Validación

- 9 pruebas unitarias nuevas: orden y límites de checkpoints, snapshots independientes,
  métricas tras correcciones, páginas vacías/nativas y exportaciones repetidas.
- 7 pruebas nuevas con Chromium y Tesseract real: cancelación, timeout, interrupción
  repetida, descarte/cambio de archivo, cancelación inicial, error de exportación y
  conservación de páginas nativas. Las solicitudes bloqueadas y el disparo del
  callback de timeout son inyecciones controladas del test; no se suspendió el equipo.
- Suite completa: 608 pruebas unitarias y 64 pruebas de navegador aprobadas localmente.
- TypeScript, build, lint sin advertencias y auditoría de dependencias de producción aprobados.
- Documento privado de 17 páginas, procesado exclusivamente en el navegador local:
  timeout después de la primera página; reanudación hasta completar tres; cancelación
  durante la cuarta; descarga parcial con las 17 páginas originales.
- SHA-256 del original sin cambios; los 17 streams de imágenes y las cajas/rotaciones
  de página se conservaron. La página 3 renderizada antes/después produjo el mismo
  SHA-256. Cero solicitudes externas y cero errores del navegador en esa prueba.
- El documento, sus textos, capturas y PDFs de prueba no se incorporan al repositorio.

## Límites explícitos

El checkpoint vive en la pestaña: no es persistencia en disco ni recuperación tras
recarga, cierre del navegador o cambio de herramienta. La interfaz lo advierte y
solicita confirmación del navegador al recargar/cerrar cuando este lo permite.
El usuario puede descargar una copia antes de salir. Las páginas pendientes del PDF
parcial mantienen su contenido original, pero no reciben OCR adicional.

No se cambiaron los límites de tiempo del motor, los idiomas ni la precisión de
reconocimiento. No se añadió OCR remoto ni otro proveedor.
