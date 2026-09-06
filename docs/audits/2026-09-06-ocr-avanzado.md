# OCR local avanzado: texto impreso difícil

## Alcance

Motor compartido para OCR de PDF y Studio, con Tesseract.js 7 y los seis modelos locales ya incluidos. No se incorporaron proveedores externos ni se subieron documentos de prueba. Los archivos privados y sus transcripciones permanecen fuera de Git.

## Cambios

- Orientación automática por comparación de cuatro lecturas reducidas (0°, 90°, 180°, 270°), con elección manual disponible. Esto cambia la imagen de trabajo, no la rotación del PDF.
- La elección combina confianza y proporción de palabras largas con cajas horizontales. El CI de Linux detectó que una lectura lateral podía obtener alta confianza; la geometría evita elegir ese marco y desalinear la capa de texto.
- Modo rápido hasta 216 dpi y profundo hasta 300 dpi. El código anterior usaba escala 2: 144 dpi, no 300. Entrada sin recompresión JPEG y límites de 9 millones de píxeles / 5.000 píxeles por lado.
- En modo profundo, otra lectura con umbral adaptativo si el candidato inicial tiene puntuación inferior a 90. Se elige un resultado completo, sin concatenar resultados ni duplicar palabras. La alternativa necesita mejorar la puntuación y conservar al menos el 80% del número de palabras.
- Idioma del documento independiente del idioma de la interfaz.
- Revisión paginada de palabras, filtro de baja confianza, vista del recorte, corrección manual y relectura ampliada de una palabra. La relectura propone una alternativa que el usuario debe aceptar.
- Coordenadas transformadas desde la imagen orientada al espacio original del PDF mediante el viewport de PDF.js; se conserva la dirección de cada palabra.
- La herramienta independiente carga el PDF original y agrega texto invisible. No reconstruye las páginas con JPEG. Conserva metadatos sin actualizar automáticamente productor/fechas.
- Texto nativo: se omiten páginas con al menos 100 caracteres nativos o páginas con texto sin imágenes. Los escaneos con pies breves se leen y se excluyen palabras OCR que se superponen al texto nativo existente. La opción puede desactivarse con advertencia de duplicación.
- Studio reemplaza sólo su propia capa OCR en esa página, con historial reversible. Las revisiones se vinculan a una revisión concreta del documento para evitar aplicar coordenadas viejas después de editarlo.
- El botón OCR espera a que el documento materializado coincida con el estado actual: no inicia una lectura sobre un PDF anterior que se está descartando durante una reconstrucción. Cambiar el documento cancela la lectura pendiente.
- Cancelación de reconocimiento activo, inicialización acotada a 60 s y reconocimiento individual a 90 s. Liberación de lienzos y trabajadores. Una inicialización que termina después de cancelar se cierra al resolver.
- Validación de coordenadas y confianza finitas. Conservación de las líneas del motor al reconstruir texto corregido.

## Prueba privada representativa

Se procesó un libro escaneado de 17 páginas PDF (dobles páginas impresas), 9.69 MB, con giros físicos no declarados y pies nativos del escáner. Imágenes originales de aproximadamente 237–406 dpi.

La primera comparación completa tardó 461 s en el equipo local, con otras pruebas ejecutándose simultáneamente. No es un benchmark de rendimiento aislado. La referencia anterior se ejecutó con Tesseract.js y rasterización Poppler a 144 dpi/JPEG 82, aproximando la entrada anterior de la aplicación; no es una comparación controlada que aísle exclusivamente el motor.

Resultados de esa comparación:

- 17/17 páginas procesadas.
- 20/20 términos de control, verificados visualmente en una página de prosa, recuperados por la nueva lectura frente a 0/20 en la referencia sin corrección de orientación. **Esto mide recuperación de esos términos, no precisión general, CER ni WER.**
- Las 17 imágenes originales conservaron exactamente sus bytes comprimidos; mismas cajas y rotaciones de página.
- Una página renderizada a 1.600 píxeles produjo el mismo SHA-256 antes y después: identidad visual píxel por píxel para esa muestra.
- Original intacto por SHA-256; cero solicitudes fuera del servidor local y cero errores de navegador durante la prueba.
- Salida inicial de 10.33 MB: el aumento corresponde principalmente a la capa de texto, sin recomprimir los escaneos.

## Pruebas reproducibles

`tests/ocr.advanced.test.ts` cubre rotaciones, límites de memoria, entradas no finitas, selección de candidatos, transformación de coordenadas, líneas y sustitución reversible de capas.

`e2e/ocr-advanced.spec.ts` usa escaneos sintéticos y el motor real: cuatro orientaciones, corrección y relectura, descarga y extracción, conservación de formularios/texto nativo, pies de escáner, cancelación/reintento, Studio invisible, deshacer/rehacer y recuperación de sesión. El corpus privado no forma parte del CI.

## Límites y siguientes pasos

- Confianza del motor no equivale a exactitud. Puede reconocer ruido como texto o equivocarse con alta confianza.
- Fórmulas, tablas, letra manuscrita, perspectiva, páginas curvas y desenfoque severo no quedan resueltos. Esta entrega no incorpora deskew arbitrario ni rectificación de perspectiva.
- La detección de páginas mixtas es una heurística conservadora, no un analizador completo de regiones. Un documento con texto nativo abundante e imágenes que contengan texto puede necesitar desactivar la conservación automática.
- La capa PDF sigue usando una fuente WinAnsi: se advierte sobre símbolos no representables; el texto plano conserva los caracteres reconocidos. No se promete reconstrucción matemática ni tipográfica.
- La revisión visual usa una miniatura de hasta 1.100 píxeles; la relectura vuelve a renderizar el original a la resolución de OCR antes de ampliar el recorte.
- No se adoptó todavía un segundo motor. PaddleOCR.js requiere evaluación comparativa de precisión, memoria y geometría; Scribe.js necesita además revisión de su licencia AGPL. No se presenta ninguna mejora de esos motores como comprobada en este proyecto.

Fundamento técnico: [calidad de entrada de Tesseract](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) y [API oficial de Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), contrastadas con la versión instalada.
