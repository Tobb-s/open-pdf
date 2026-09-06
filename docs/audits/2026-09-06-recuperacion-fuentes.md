# Recuperación de reemplazos bloqueados por la fuente

## Causa y alcance

El modo nativo sólo podía codificar caracteres presentes en el mapa de la fuente
original. En fuentes subconjuntadas esto puede impedir escribir letras habituales.
El rechazo era correcto, pero el aviso no ofrecía una salida directa ni mostraba
qué caracteres faltaban.

Ahora el aviso informa los caracteres faltantes y permite **reintentar con una
fuente compatible** para el fragmento seleccionado. La elección es explícita y
advierte que las formas pueden variar. Se infiere la familia estándar y su estilo
a partir de la fuente detectada (Courier, Times o Helvetica, con negrita/cursiva).
No se afirma que la fuente compatible sea idéntica a la original.

## Qué se conserva

- El reemplazo continúa siendo texto PDF, no una imagen ni una cobertura visual.
- La fuente alternativa se limita al fragmento, manteniendo el formato y los
  bytes de texto circundantes en sus recursos originales.
- Se clonan los recursos compartidos antes de registrar la fuente, evitando
  modificar recursos de otras páginas o de un padre heredado.
- Tamaño, color y opciones de ancho siguen disponibles; los modos que conservan
  el avance mantienen la posición del texto posterior.
- La elección forma parte del script serializable: permite deshacer, rehacer,
  reabrir una sesión guardada y editar nuevamente el fragmento recuperado.

El error por ancho excesivo ofrece reintentar con ancho natural. La reconstrucción
de página aparece como alternativa con pérdidas: abre sus opciones conservando
el texto ingresado, **sin aplicarse automáticamente**. Al seleccionar otro fragmento
se vuelve al modo de fuente original; cambiar el texto descarta el aviso obsoleto.

## Protecciones y límites

La alternativa no evita los controles de identidad, posición, tamaño, ambigüedad,
codificación ni longitud. Una fuente estándar no cubre todos los idiomas: si aún
faltan caracteres, el aviso lo explica sin repetir indefinidamente la misma oferta.
No se agregaron fuentes externas, dependencias, servicios ni cargas de documentos.
La variante de fuente compatible no es una garantía de saneamiento de datos ni
un motor OCR nuevo.

## Verificación

- 12 pruebas nuevas del motor: fuente parcial, caracteres exactos, tres ajustes
  de ancho, aislamiento de recursos, anotaciones, recorte/rotación, formato,
  deshacer/replay, errores seguros y una fuente realmente incrustada de dos bytes.
- 6 pruebas nuevas de navegador: recuperación explícita hasta descarga, undo/redo,
  reinicio de la elección al seleccionar otro texto, sesión guardada y segunda
  edición, recuperación por ancho y configuración de reconstrucción sin aplicar.
- El test de reapertura espera el script confirmado en IndexedDB (guardado con
  debounce de 900 ms) y utiliza el botón real «Seguir donde estaba».
- Suite unitaria completa: 563 pruebas aprobadas en 55 archivos. Suite de navegador:
  48 casos, incluyendo los seis nuevos; el control remoto ejecuta todos juntos.
- Tipos, lint del código (excluyendo cachés privadas) y build de producción
  verificados localmente. Se inspeccionó visualmente una exportación sintética
  con Poppler: reemplazo, texto vecino, dibujo y anotación visibles. Poppler avisó
  de fuentes de respaldo Symbol/ArialUnicode no instaladas en ese entorno.
- Un documento privado aportado por el usuario reprodujo el fallo de cobertura
  y admitió la alternativa en memoria. Se reabrieron esos bytes y se verificó una
  única sustitución. No se guardó ni publicó un PDF modificado; el original quedó
  idéntico. Los tests públicos no incluyen datos ni nombres del documento privado.

La primera ejecución local del navegador se invalidó por solapar el arranque con
el build. Se detuvo ese proceso y se repitió con un build completo. Una caché de
build bloqueada por Windows se movió a un respaldo privado recuperable, sin borrar
archivos fuente. Los ajustes posteriores del test de sesión corrigieron su
sincronización con el guardado; no eliminaron sus aserciones de persistencia.
