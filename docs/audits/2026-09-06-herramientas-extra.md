# PDF Studio: diez comprobaciones adicionales de herramientas

Fecha: 2026-09-06. Aplicación comprobada: https://open-pdf-omega.vercel.app/es/studio, después de la entrega `ce10165`.

Muestra variada de diez escenarios, con entradas y posiciones fijas para reproducir cualquier fallo. No es un muestreo estadístico ni una campaña de fuzzing. Cada escenario utiliza un contexto Chromium aislado y documentos sintéticos; opera la interfaz, descarga el PDF real y lo inspecciona con pdf-lib y PDF.js.

| Caso | Comprobación del archivo descargado | Resultado |
| --- | --- | --- |
| Texto con tildes y ñ; deshacer y rehacer | Conserva el texto añadido y el original | PASS |
| Reemplazar una línea | Contiene el reemplazo y no la cadena original | PASS |
| Recortar | CropBox coincide con la selección dentro de 3 puntos; MediaBox permanece intacto | PASS |
| Girar la segunda de tres páginas | Rotaciones 0, 90, 0; textos y orden conservados | PASS |
| Reordenar, eliminar, deshacer y rehacer | Dos páginas finales con el contenido y orden esperados | PASS |
| Título y autor con caracteres españoles | Los valores se recuperan exactamente desde los metadatos | PASS |
| Marca de agua | El texto de la marca aparece en las tres páginas | PASS |
| Numerar y luego reordenar | La numeración sigue el orden final, no el original | PASS |
| Comentario con respuesta | Ambos mensajes están en el contenido de anotaciones PDF | PASS |
| Firma escrita | Existe una apariencia de imagen y se conserva el texto original | PASS |

Ejecución final en producción: **10 passed (17.3s)**. No se detectaron errores de consola ni excepciones de página. La primera ejecución también pasó los diez casos. Al eliminar una advertencia de fuentes del lector de pruebas, una ruta Windows con barra invertida causó un fallo del verificador; se corrigió usando barras compatibles con PDF.js y se repitió la tanda. No fue necesario modificar código de la aplicación.

Reproducción en PowerShell:

```powershell
$env:PLAYWRIGHT_BASE_URL = 'https://open-pdf-omega.vercel.app'
npx playwright test e2e/studio-tool-output-audit.spec.ts --workers=3
```

Sin esa variable, Playwright usa el servidor local de producción. La nueva suite queda incluida en el comando general `npm run test:e2e`.

Límites: estos resultados verifican contenido y estructura, no equivalencia visual píxel a píxel, firmas digitales criptográficas, dispositivos móviles ni todos los PDF posibles. No se alteraron archivos del usuario ni se subieron documentos a un servidor.
