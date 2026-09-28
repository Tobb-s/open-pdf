# Traducción PDF (beta)

## Uso

1. Abrir `/es/translate`, elegir un PDF en inglés y analizarlo localmente.
2. Revisar la extracción o delegar a la IA la lectura de los bloques dudosos (opcional).
3. Elegir proveedor/modelo, ingresar una clave propia y aceptar el envío y los costos.
   El contexto entre páginas y lotes está desactivado por defecto. Activarlo puede ayudar con
   terminología, pero también causar repeticiones o completar fragmentos con texto vecino.
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

### Revisión automática de lecturas dudosas (beta)

Después del análisis, «Revisar bloques dudosos con IA» procesa los bloques incluidos sin
traducción con OCR menor a 80/100 o marcas `[illegible]`, `[ilegible]`, `[unreadable]` o el
carácter de sustitución Unicode. No detecta todos los errores ni encuentra texto ausente.
Utiliza el modelo OpenAI seleccionado y la clave propia (temporal o guardada). Gemini y
compatibles mantienen su traducción habitual; esta revisión requiere OpenAI con visión/JSON.

Requiere autorización visual separada: hasta **20 solicitudes secuenciales por clic**, una
por recorte, sin enviar el PDF completo, glosario, contexto ni traducciones. Los otros bloques
detectados se enmascaran; puede quedar información no detectada, por lo que NO es saneamiento.
No hay reintentos automáticos. Otro clic procesa los siguientes bloques no revisados; un botón
separado reintenta sólo fallos del mismo modelo/lectura, nunca propuestas ambiguas automáticamente.
Una falla de clave, cuota, modelo o conexión detiene el lote para no seguir consumiendo.

La IA transcribe contra la imagen, no traduce todavía. Se aplica sin confirmación por bloque
sólo si declara ausencia de ambigüedad y supera filtros de longitud, marcas ilegibles, cifras
y operadores matemáticos. Estos filtros **no prueban exactitud**: no verifican nombres ni toda
la semántica, y pueden conservar errores o rechazar una corrección legítima de un número.
Las propuestas dudosas permanecen visibles sin reemplazar el original; no bloquean traducir
el texto conservado. La edición manual y revisión regional siguen disponibles como alternativa.

La lectura anterior, propuesta, estado y modelo quedan sólo en memoria del navegador, no en
los payloads de traducción/contexto. «Restaurar lectura anterior» revierte la corrección y borra
su traducción/vista previa. La geometría, bloques excluidos y traducciones existentes se conservan.
Cambiar archivo, clave, proveedor o modelo revoca la autorización; no inicia llamadas por sí solo.
Reanalizar revoca la autorización visual. Cerrar o recargar pierde este historial, como el análisis.

### Segunda lectura regional (beta)

Cada bloque incluido ofrece «Revisar región difícil». «Preparar recorte y releer OCR» renderiza
sólo su región en el navegador (hasta 2000 px por lado y 3 MP) y ejecuta dos lecturas Tesseract
en inglés: PSM 6 (bloque uniforme) y PSM 11 (texto disperso). Las alternativas quedan separadas;
no se elige automáticamente la de mayor confianza ni se mezclan sus textos.

Después de inspeccionar el recorte, se puede autorizar y solicitar una revisión visual con IA.
Este primer adaptador usa **OpenAI Responses** y el modelo configurado, que debe admitir visión
y JSON Schema. Gemini y compatibles siguen funcionando para traducción, pero la revisión visual
no está habilitada para ellos en esta etapa. Cada clic envía sólo un PNG (máximo 1,5 MB) y el
texto original de ese bloque, sin PDF completo, glosario, contexto ni traducciones. No hay reintentos
automáticos. El consentimiento visual es separado y se renueva al cambiar recorte, modelo o clave.

Las otras cajas de texto detectadas se enmascaran en el recorte, incluso si están desmarcadas.
Esto NO garantiza eliminar información no detectada: revisar el recorte antes de consentir;
no usar como saneamiento. El margen puede cortar símbolos o incluir texto ajeno no detectado.

La IA transcribe en el idioma original y señala incertidumbre; puede alucinar o equivocarse,
especialmente en fórmulas/números. Elegir una alternativa llena una propuesta editable. Sólo
«Aplicar propuesta al original» cambia el texto, borra la traducción de ese bloque e invalida
la vista previa. El resto de bloques/traducciones y la geometría quedan intactos. Esta herramienta
no descubre regiones ausentes ni recompone columnas, tablas o fórmulas estructuradas.

### Formatos de salida

«Conservar distribución original» mantiene el tamaño de página y las cajas detectadas: si el
texto no entra a 7 pt o más, informa desborde y no exporta. Sigue siendo el modo predeterminado.

«Lectura cómoda con continuaciones» usa una sola fuente, Helvetica, a **12 pt fijos**.
Si necesita símbolos adicionales, toda esa fuente pasa a Liberation Sans Regular local.
No toma familia, negrita, cursiva ni tamaño del documento original y no achica texto para encajar.
Si cualquier bloque incluido desborda, mueve **todos los bloques incluidos de esa página** a
páginas adicionales, respetando su orden detectado. El cuerpo usa márgenes de 36 pt.
No abrevia ni recorta contenido; los tokens largos se dividen por caracteres Unicode sin insertar
guiones. Los IDs se conservan internamente para trazabilidad, pero no se imprimen. Tampoco se
agregan etiquetas de origen, continuación ni pies técnicos al PDF. No se elimina texto real que
casualmente contenga un ID parecido: la corrección evita generar esas etiquetas, no filtra el contenido.

La página de origen queda como lámina visual, con imágenes y texto excluido/no detectado, sin
banda superior ni cambio de dimensiones. Las figuras todavía no se redistribuyen entre
párrafos. Las páginas de lectura usan como mínimo 300 × 400 pt. El selector de resultado recorre
todas las páginas generadas; cambiar la página de origen salta a su lámina correspondiente.
Cambiar de modo invalida la vista previa, sin perder traducciones. Máximo: 500 páginas generadas.
Las traducciones faltantes o los caracteres incompatibles siguen bloqueando la exportación.
Este reflujo no reconstruye columnas, tablas o fórmulas ni corrige el OCR o el orden de lectura.

El análisis ordena dos columnas cuando encuentra al menos tres bloques a cada lado de un
corredor central claro; los bloques de ancho completo separan bandas. Es una heurística
conservadora, no un detector universal de maquetación. Los IDs y el contenido no cambian.
Si una fuente estándar no puede escribir un símbolo, intenta incrustar una fuente Liberation Sans
local con el mismo estilo. Aproxima menos la familia original, pero admite griego y símbolos comunes.
Se comprueba la cobertura: los glifos ausentes siguen bloqueando, sin sustitución por cuadrados.

- Destino: español argentino; registro fiel al original, sin regionalismos forzados.
- Texto nativo con coordenadas o Tesseract local en inglés, modo profundo. Forzar OCR permite
  inspeccionar páginas mixtas y rótulos en imágenes. La confianza OCR no mide exactitud.
- El OCR conserva las líneas reconocidas y ordena sus palabras antes de formar bloques.
  El tamaño se estima con varias palabras de cada línea; es una aproximación, no detección
  de la fuente original. Los huecos grandes siguen separados; no se garantiza el orden entre columnas.
- Hasta 50 MB por archivo y 100 páginas seleccionadas por procesamiento. Puede ser el PDF completo
  o un rango físico inclusivo (por ejemplo, 20–50 = 31 páginas), incluso de un PDF más largo.
  La interfaz usa lotes iniciales de hasta 12 bloques y 12.000 caracteres;
  el contrato del servidor admite hasta 80 bloques. Ante fallas se reduce el lote manualmente.
- El OCR agrupa líneas de prosa con sangría inicial y espaciado amplio en párrafos conservando
  sus cajas originales. Es heurístico: revisar columnas, listas, tablas y límites de párrafo.
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
  También deja pendientes respuestas con menos del 60% de la longitud de un original de al menos
  200 caracteres, o más de tres veces su longitud más 120 caracteres (normalizando espacios).
  Es una alarma heurística para omisiones/expansiones grandes; puede dar falsos positivos y no
  detecta cambios de sentido, cifras incorrectas ni omisiones pequeñas. Se puede corregir manualmente.
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
  No se suben PDF. La traducción sólo envía texto; la revisión visual opcional envía un PNG y el texto
  de su bloque con consentimiento separado. Proveedor e infraestructura pueden retener datos según sus políticas.
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
- https://developers.openai.com/api/docs/guides/images-vision

## Evolución recomendada

### Documento limpio: PDF completo o rango seleccionado

«Traducir al español» crea un PDF nuevo, sin fondo de las hojas originales, con todas las páginas
seleccionadas. El selector ofrece el documento completo o un rango físico inclusivo; cada
procesamiento admite hasta 100 páginas. Requiere OpenAI y autorización específica para enviar
**páginas completas**, incluidos textos desmarcados: no hereda las exclusiones del modo por bloques.
La autorización describe una solicitud por página, hasta dos lecturas por recorte dudoso y las
traducciones necesarias. No reintenta fallos automáticamente. Los avances viven en memoria;
otro clic continúa lo pendiente. Cambiar archivo, textos, proveedor, clave o modelo invalida la muestra.

La IA compara OCR e imagen y propone títulos, párrafos, listas, notas, fórmulas, figuras y ruido.
La traducción incluye contexto de las unidades vecinas de esta muestra, con los mismos límites
de seis referencias/6.000 caracteres de la traducción por bloques, según su consentimiento propio.
Cada ID OCR debe quedar contabilizado; los párrafos completos recuperados sin ID se vinculan
sólo por coincidencia única casi literal. Si OCR había unido párrafos, se conservan sus saltos
explícitos al recuperar cobertura. Las respuestas incompletas, figuras fuera de página y grandes
abreviaciones no se aplican. Cambios de cifras/símbolos e ilegibilidad se señalan como inciertos.
En páginas OCR, las líneas originales conservan su propio ID y caja: esto permite distinguir
un título, una leyenda o un encabezado de tabla dentro de un bloque OCR amplio. Si el usuario
editó el texto del bloque, no se reutilizan coordenadas de líneas antiguas. El proveedor declara
si sus cajas vienen en la escala normalizada 0–1000 o en píxeles de la imagen; la conversión usa
las dimensiones reales del PNG. No se infiere la escala por valores parecidos, que pueden ser ambiguos.
Los recortes de verificación cubren tanto límites OCR como propuestos, con margen; se enmascaran
otros bloques conocidos para no transcribir párrafos vecinos. Las figuras exportadas **no** se enmascaran.
Una lectura distinta necesita acuerdo entre dos lecturas del recorte; puede coincidir la segunda
con la propuesta inicial. Un acuerdo del mismo modelo no prueba exactitud. Si permanece ambiguo,
se conserva el trabajo parcial y no se exporta una muestra potencialmente incompleta.
Las notas marginales dudosas pueden pasar por una revisión visual de clasificación con contexto
de la misma franja de página. Sólo se excluyen si la IA las identifica sin duda como marca de
escaneo, número de página o encabezado/pie repetido. Ante ambigüedad se conserva el contenido
y se detiene la exportación; identificadores bibliográficos WPS/ISBN/ISSN/DOI están protegidos.
Esto no equivale a sanear contenido sensible ni prueba que toda marca de producción sea detectada.

El PDF usa DejaVu Sans Regular de 12 pt, con fuente libre incluida localmente y cobertura de
español, griego, símbolos comunes y superíndices. Los títulos se distinguen por separación,
no por tamaño ni otra fuente. Los párrafos evidentemente cortados entre páginas se unen antes
de traducir; títulos, notas e imágenes impiden la unión. Es una heurística, no una garantía de
segmentación. Se reutilizan traducciones sólo si coincide el texto de la unidad; las uniones
entre páginas se traducen como una sola unidad para evitar duplicaciones.

Las imágenes se recortan del original intacto y entran en el mismo flujo que los párrafos;
pueden pasar a otra página, pero no a un apéndice. Mantienen proporción y no se agrandan sobre
su tamaño original. El recorte aproximado se amplía y ajusta a tinta visible; si toca los bordes
de búsqueda o invade texto OCR no asignado a la figura, se informa incertidumbre y no se exporta.
La búsqueda incorpora todas las cajas OCR asignadas a la imagen y se acota frente a elementos
vecinos para evitar perder títulos de tabla o incluir párrafos ajenos. Los títulos y leyendas
externos se mantienen como texto del flujo, junto a su imagen cuando entran en la misma hoja.
Es un control conservador de contraste sobre fondo claro, no segmentación universal de imágenes:
fotografías, fondos complejos y texto no detectado requieren validación adicional.
Tablas y gráficos conservan sus rótulos originales, aún sin traducir.
No hay láminas vacías de origen, IDs impresos, cabeceras de diagnóstico ni pies técnicos.
La fuente debe poder representar cada carácter; se rechazan glifos ausentes, no se sustituyen.

Límites iniciales: hasta 200 referencias/22.000 caracteres por página, imagen PNG hasta 1,5 MB,
máximo 2.000 px por lado/3 MP y respuesta estructurada acotada. No es un detector infalible:
puede omitir texto que ni OCR ni IA encuentren, equivocarse en una exclusión corta, alterar orden,
leer cifras mal con aparente acuerdo o proponer un recorte incorrecto. Inspeccionar el resultado.
La descarga corresponde sólo a las páginas seleccionadas, sin incluir las demás hojas del origen.

Fuente distribuida con licencia incluida en `public/fonts/LICENSE-DejaVu.txt`.

### Etapas pendientes

El modo limpio implementa un primer flujo de estructura, revisión, traducción y figuras integradas.
No reemplaza todavía los modos anteriores ni implica que se validaron todos los tipos de PDF.

1. Robustecer la representación trazable de títulos, párrafos, listas, notas,
   tablas, fórmulas y regiones gráficas. Conservar origen y coordenadas de cada elemento;
   el escaneo completo de una página no debe confundirse con una figura. Detectar regiones
   gráficas antes de borrar texto para no destruir ejes, celdas o rótulos.
2. El anclaje acordado es entre los mismos párrafos, no página/coordenadas físicas exactas.
   Robustecer detección de regiones y comprobar límites contra la imagen; ampliar a gráficos
   y tablas complejos sin destruir rótulos ni desplazar sus anclajes.
3. Evaluar una segunda revisión semántica/estructural del documento con IA y lotes acotados
   de hasta diez, sujetos a límites de texto e imágenes. OCR aporta lectura y coordenadas;
   la IA contrasta contra la página y propone clasificación, uniones y exclusiones justificadas.
   No es un resumen ni una reescritura libre. Cada fragmento debe quedar asignado exactamente
   una vez, en orden, al contenido conservado o a una exclusión registrada. No eliminar por baja
   confianza solamente; conservar ante ambigüedad. Proteger cifras, fórmulas, citas y notas.
4. Seguir revisando con el usuario las muestras reales de Easterly: primeras diez páginas y gráficos/
   tablas de páginas físicas 10–13 y 21–30. Evidencia y límites en
   `audits/2026-09-27-traduccion-limpia.md` y
   `audits/2026-09-27-traduccion-graficos-tablas.md`. La opción de procesar todas las páginas
   ya existe para archivos de hasta 100 páginas, pero falta validar una traducción completa
   real con control de calidad editorial. No volver a gastar API ni OCR por cambios
   exclusivamente tipográficos.

Otras mejoras: evaluación de coherencia del glosario entre lotes, evaluación humana de traducción
técnica y checkpoints descargables sin incluir credenciales.
