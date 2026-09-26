# Traducción PDF (beta)

## Uso

1. Abrir `/es/translate`, elegir un PDF en inglés y analizarlo localmente.
2. Revisar el texto detectado por página. Corregir errores de OCR antes de enviar.
3. Elegir proveedor/modelo, ingresar una clave propia y aceptar el envío y los costos.
   El contexto entre páginas y lotes está activado por defecto y se puede desactivar.
   Cambiar esa opción requiere renovar el consentimiento.
4. Traducir pendientes. Se conservan los bloques válidos de respuestas terminadas, incluso si
   faltan otros o llegan vacíos. Se informa la falla y se detiene el proceso; no hay reintentos automáticos cobrables.
   Volver a pulsar «Traducir pendientes» envía sólo lo que falta, sin pisar las traducciones ya recibidas
   ni las correcciones del usuario. Ante salida incompleta o inválida, el próximo intento manual usa
   lotes con hasta la mitad de bloques del lote fallido (mínimo uno), manteniendo el límite de caracteres.
5. Revisar y corregir el español, elegir formato de salida, generar la vista previa y descargar un PDF nuevo.

El original nunca se modifica. Una edición invalida la vista previa para no descargar una versión vieja.
Los resultados y la clave viven sólo en memoria: cerrar/recargar la pestaña los pierde.
Cambiar proveedor borra la clave y el consentimiento. Los bloques ya traducidos no se retraducen
al cambiar modelo o glosario: vaciar su traducción para volver a incluirlos en pendientes.

## Contexto y coherencia

Cada lote puede incluir hasta seis fragmentos de referencia y 6.000 caracteres adicionales
(máximo 1.200 por fragmento, contando original y traducción). Se toman vecinos anteriores y
posteriores y hasta dos traducciones previas cercanas, siempre de bloques incluidos. Los fragmentos
largos son extractos: finales para el contexto anterior e inicios para el posterior. Se mantiene
el orden de bloques detectado; esto no corrige por sí solo el orden de lectura entre columnas.

El contexto viaja separado de los bloques solicitados y nunca se aplica como traducción.
Se reutilizan traducciones recibidas durante el mismo proceso y correcciones del usuario,
sin retraducirlas ni sustituirlas. Los IDs de contexto en la respuesta se rechazan como ajenos.
El glosario explícito tiene prioridad en las instrucciones del proveedor; no se hacen sustituciones
automáticas de palabras ni se infiere un glosario como si fuese una verdad validada.

El contexto aumenta el texto enviado y puede aumentar los costos de tokens, sin llamadas adicionales
ni reintentos automáticos. Los bloques desmarcados no se envían como contexto. El proveedor puede
ignorar una preferencia o perpetuar un error previo: la validación estructural no verifica coherencia
semántica ni garantiza que no repita texto de contexto con un ID solicitado. Revisar el resultado.

## Alcance y límites

### Formatos de salida

«Conservar distribución original» mantiene el tamaño de página y las cajas detectadas: si el
texto no entra a 7 pt o más, informa desborde y no exporta. Sigue siendo el modo predeterminado.

«Lectura cómoda con continuaciones» mantiene el texto que entra en sus cajas a 11 pt o más.
Si cualquier bloque incluido desborda, mueve **todos los bloques incluidos de esa página** a
páginas adicionales, respetando su orden detectado. El cuerpo usa entre 11 y 18 pt, márgenes
de 36 pt y la familia/estilo estándar aproximados. No abrevia ni recorta contenido; los tokens
largos se dividen por caracteres Unicode sin insertar guiones. Los IDs indican el bloque de origen.

La página de origen queda como lámina visual, con imágenes y texto excluido/no detectado, y una
banda superior de 36 pt que indica dónde leer su traducción. Las figuras no se redistribuyen entre
párrafos. Las páginas de lectura usan como mínimo 300 × 400 pt. El selector de resultado recorre
todas las páginas generadas; cambiar la página de origen salta a su lámina correspondiente.
Cambiar de modo invalida la vista previa, sin perder traducciones. Máximo: 500 páginas generadas.
Las traducciones faltantes o los caracteres incompatibles siguen bloqueando la exportación.
Este reflujo no reconstruye columnas, tablas o fórmulas ni corrige el OCR o el orden de lectura.

- Destino: español argentino; registro fiel al original, sin regionalismos forzados.
- Texto nativo con coordenadas o Tesseract local en inglés, modo profundo. Forzar OCR permite
  inspeccionar páginas mixtas y rótulos en imágenes. La confianza OCR no mide exactitud.
- El OCR conserva las líneas reconocidas y ordena sus palabras antes de formar bloques.
  El tamaño se estima con varias palabras de cada línea; es una aproximación, no detección
  de la fuente original. Los huecos grandes siguen separados; no se garantiza el orden entre columnas.
- Hasta 50 MB y 100 páginas. Lotes de hasta 12.000 caracteres y 80 bloques.
- Posición visual de imágenes conservada en la lámina de origen mediante fondo PNG (hasta 144 dpi,
  limitado a 8 MP/página). No se conservan imágenes como objetos independientes/vectoriales.
- Traducción seleccionable en fuentes PDF estándar, aproximando serif/sans/mono, negrita y cursiva.
  No se conserva la fuente incrustada exacta, color ni estilos internos mixtos.
- El borrado visual usa cajas de línea y un color de fondo estimado: revisar páginas con fondos
  complejos, gráficos atravesados por texto, tablas, fórmulas, columnas y escaneos inclinados.
- No se traducen automáticamente rótulos no detectados. Texto girado se señala y queda original;
  orientarlo primero en Studio. Las páginas sin texto se mantienen visualmente.
  Los rótulos OCR estrechos y altos se detectan mediante una heurística geométrica: revisar
  los avisos, porque no es un reconocimiento completo de orientación por región.
- No se recorta ni abrevia una traducción para que entre. En el modo original, por debajo de 7 pt se informa desborde.
  Corregir el texto sin perder contenido o desmarcar el bloque (conserva el original).
- Firmas digitales, formularios, anotaciones interactivas, vínculos, marcadores, capas y estructura
  de accesibilidad no se conservan. No usar esto como herramienta de censura o saneamiento.
- La validación estructural detecta IDs faltantes/duplicados y respuestas truncadas; no demuestra
  fidelidad semántica. Revisión humana necesaria, especialmente en documentos sensibles.
  Respuestas truncadas por tokens, JSON inválido e IDs duplicados o ajenos se rechazan sin aplicar
  ese lote. Sólo se recuperan entradas no vacías de una respuesta JSON terminada y sin IDs ambiguos.
  Un bloque individual demasiado largo no se divide automáticamente; la recuperación no garantiza
  que el proveedor complete todos los pendientes. El límite reducido se reinicia al cargar o analizar un PDF.

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

Preservación vectorial y reutilización de fuentes completas, reflujo integrado con figuras,
OCR regional y clasificación de fórmulas/tablas, evaluación de coherencia del glosario entre lotes, evaluación humana
de traducción técnica y checkpoints descargables sin incluir credenciales.
