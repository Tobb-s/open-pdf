# Reemplazo sin retroceso del texto vecino

## Causa reproducida

El reemplazo con cambio de fuente, tamaño o color insertaba `q … Q` alrededor
del fragmento. PDF.js restaura también las matrices de texto al ejecutar `Q`:
el texto siguiente volvía al inicio del fragmento y se superponía al reemplazo.
La prueba privada reprodujo un retroceso de 33 puntos; una prueba sintética
reprodujo el mismo defecto en los tres modos de ajuste antes de corregirlo.

Esto coincide con la [errata ISO 32000-2, apartado 9.4.1, issue 368](https://pdf-issues.pdfa.org/32000-2-2020/clause09.html).
El escáner interno sólo guardaba fuente/espaciado/transformación gráfica, no las
matrices de texto. Por eso las pruebas anteriores basadas en ese escáner pasaban
aunque el visor mostraba otro resultado. Comprobar que el texto nuevo existía
en PDF.js tampoco detectaba este fallo de posición.

## Corrección

- El reemplazo restaura explícitamente fuente, tamaño, escala y color, sin
  introducir `q/Q` ni cambiar las matrices de texto o el origen de la línea.
- El color original se reconstruye desde sus operadores, incluidos gris, RGB,
  CMYK y espacios nombrados; no se sustituye por una aproximación RGB. Se respeta
  la pila gráfica y se rechazan operandos que no se pueden reconstruir.
- El escáner ahora guarda y restaura ambas matrices cuando el documento fuente
  contiene `q/Q` dentro de un objeto de texto.
- No cambia el consentimiento para usar una fuente compatible, ni introduce
  rasterización, servicios externos o modificaciones del documento original.

## Evidencia

- 19 pruebas nuevas contrastan el PDF exportado con PDF.js: los tres ajustes,
  texto en un mismo operador o en operadores sucesivos con kerning, salto de
  línea, cambio combinado de fuente/tamaño/color, rotación, sesgo, color por
  defecto/gris/RGB/CMYK/espacio nombrado, pila gráfica, valores pequeños,
  eliminación, rechazo atómico y matrices de texto de origen.
- Se reforzaron las pruebas existentes de fuentes compatibles con mediciones
  del lector real, incluida una fuente incrustada de dos bytes.
- Dos casos nuevos de navegador verifican la posición del vecino respecto del
  lienzo antes y después, y las coordenadas y estructura del PDF descargado.
  Se descuenta el scroll de la interfaz: no se confunden coordenadas de pantalla
  con coordenadas del documento.
- Suite unitaria: 582 pruebas en 56 archivos. Tipos, lint de fuentes (excluyendo
  cachés privadas) y build de producción aprobados localmente.
- Suite completa de navegador: 50 casos aprobados. Vista previa sintética y PDF
  exportado revisados visualmente con Chromium y Poppler, sin superposición.
  Poppler informó fuentes de respaldo Symbol/ArialUnicode ausentes en el entorno.
- La prueba privada compara las posiciones antes/después con PDF.js y verifica
  que el archivo original conserve exactamente sus bytes. El documento y sus
  datos no forman parte de los tests públicos ni de este repositorio.
- Un test privado adicional aplicó el reemplazo en Studio local, comprobó la
  posición del vecino y el hash del original, y bloqueó peticiones ajenas al
  servidor local. No hubo peticiones de ese tipo; sólo se guardó una captura
  privada de la vista previa, no un PDF modificado.

## Límites conservados

`squeeze` conserva el ancho original; `keep-layout` mantiene la posición del
vecino, pero un texto naturalmente más largo puede ocupar su espacio;
`keep-flow` desplaza intencionalmente lo que sigue por la diferencia de anchos.
No se promete redistribución automática de párrafos ni cobertura de todas las
fuentes. Esta corrección tampoco repara por sí sola PDFs defectuosos ya exportados:
hay que volver al original o reproducir la sesión que conserva el original.
