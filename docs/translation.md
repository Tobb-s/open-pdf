# Traducción PDF (beta)

## Uso

1. Abrir `/es/translate`, elegir un PDF en inglés y analizarlo localmente.
2. Revisar el texto detectado por página. Corregir errores de OCR antes de enviar.
3. Elegir proveedor/modelo, ingresar una clave propia y aceptar el envío y los costos.
4. Traducir pendientes. Si falla un lote, los anteriores quedan en memoria; no hay reintentos automáticos cobrables.
5. Revisar y corregir el español, generar la vista previa y descargar un PDF nuevo.

El original nunca se modifica. Una edición invalida la vista previa para no descargar una versión vieja.
Los resultados y la clave viven sólo en memoria: cerrar/recargar la pestaña los pierde.
Cambiar proveedor borra la clave y el consentimiento. Los bloques ya traducidos no se retraducen
al cambiar modelo o glosario: vaciar su traducción para volver a incluirlos en pendientes.

## Alcance y límites

- Destino: español argentino; registro fiel al original, sin regionalismos forzados.
- Texto nativo con coordenadas o Tesseract local en inglés, modo profundo. Forzar OCR permite
  inspeccionar páginas mixtas y rótulos en imágenes. La confianza OCR no mide exactitud.
- Hasta 50 MB y 100 páginas. Lotes de hasta 12.000 caracteres y 80 bloques.
- Tamaño de página y posición visual de imágenes conservados mediante fondo PNG (hasta 144 dpi,
  limitado a 8 MP/página). No se conservan imágenes como objetos independientes/vectoriales.
- Traducción seleccionable en fuentes PDF estándar, aproximando serif/sans/mono, negrita y cursiva.
  No se conserva la fuente incrustada exacta, color ni estilos internos mixtos.
- El borrado visual usa cajas de línea y un color de fondo estimado: revisar páginas con fondos
  complejos, gráficos atravesados por texto, tablas, fórmulas, columnas y escaneos inclinados.
- No se traducen automáticamente rótulos no detectados. Texto girado se señala y queda original;
  orientarlo primero en Studio. Las páginas sin texto se mantienen visualmente.
- No se recorta ni abrevia una traducción para que entre. Por debajo de 7 pt se informa desborde.
  Corregir el texto sin perder contenido o desmarcar el bloque (conserva el original).
- Firmas digitales, formularios, anotaciones interactivas, vínculos, marcadores, capas y estructura
  de accesibilidad no se conservan. No usar esto como herramienta de censura o saneamiento.
- La validación estructural detecta IDs faltantes/duplicados y respuestas truncadas; no demuestra
  fidelidad semántica. Revisión humana necesaria, especialmente en documentos sensibles.

## Proveedores y privacidad

- OpenAI: Responses API, salida JSON Schema estricta, `store: false`.
- Gemini: endpoint oficial compatible con OpenAI Chat Completions, JSON Schema.
- Compatible: Chat Completions + JSON mode. OpenRouter habilitado; modelos editables.
  No significa compatibilidad universal con cualquier protocolo propietario.
- Para otro proveedor, el operador configura `TRANSLATION_COMPATIBLE_BASE_URLS` con bases HTTPS
  exactas separadas por comas (sin barra final). No se aceptan URL arbitrarias enviadas por visitantes.
  Sólo autorizar proveedores públicos confiables; revisar DNS, política de datos y costos antes de habilitarlos.
- El proxy rechaza redirecciones, URL con credenciales/query/fragmento, peticiones sin consentimiento,
  sin clave o de otro origen. Limita entrada/salida y tiempo de proveedor.
- La clave viaja en Authorization hasta OpenPDF y luego al proveedor. No se guarda en localStorage,
  IndexedDB, cookies, archivos de servidor ni registros de aplicación. Texto/glosario tampoco.
  No se suben PDF ni imágenes. Proveedor e infraestructura pueden retener datos según sus políticas.
- La ruta pública **nunca** usa `OPENAI_API_KEY` del servidor como fallback: no es una API gratuita
  financiada por el dueño del sitio. La clave de desarrollo sólo es usada por una prueba explícita.
- Límite de concurrencia por instancia (8), no un rate limiter distribuido. Antes de gran escala/pagos:
  autenticación, cuotas distribuidas, observabilidad sin datos sensibles y revisión de logs de infraestructura.

## Validación y desarrollo

`npm test`, `npm run build`, `npm run lint` y `npx playwright test --config playwright.translation.config.ts`.
La configuración específica inicia un servidor aislado en 3101 para no probar un build viejo.

Prueba real opt-in: definir `LIVE_TRANSLATION_SMOKE=1` y ejecutar
`npx vitest run tests/translation.test.ts -t "live development-key smoke"`.
Lee `.env.local`, envía sólo una frase sintética y no muestra claves ni respuestas.
Nunca configurar esa variable en CI. Las pruebas de navegador usan proveedores simulados.

Fuentes de contrato consultadas:

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://ai.google.dev/gemini-api/docs/openai

## Evolución recomendada

Preservación vectorial y reutilización de fuentes completas, reflujo con páginas de continuación,
OCR regional y clasificación de fórmulas/tablas, glosario coherente entre lotes, evaluación humana
de traducción técnica y checkpoints descargables sin incluir credenciales.
