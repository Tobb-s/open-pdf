# Traducción limpia: gráficos y tablas reales de Easterly 1997

Fecha: 2026-09-27. Alcance: prueba controlada del modo beta de **hasta diez páginas físicas
por muestra**. No es una traducción del libro completo ni una certificación semántica.

## Selección y método

Se preservó el PDF privado original de 40 páginas, SHA-256
`93e97a534c7c553d9668ce30cac55da20965226438051ea994058b5a41405f15`.
Se copiaron dos intervalos del original sin alterar el contenido: páginas físicas 10–13 (A) y
21–30 (B). Contienen cinco gráficos (Figuras 1–5) y cinco tablas (Tablas 1–5). El OCR de las
páginas problemáticas se regeneró localmente para obtener cajas por línea; en las demás se
reutilizó la extracción anterior sólo cuando coincidían archivo, texto y referencias. La
estructura nueva y las lecturas dudosas se contrastaron con la imagen mediante el proveedor
OpenAI real y la clave de desarrollo previamente autorizada. El español reutilizado se aplicó
sólo cuando coincidía el texto fuente; se tradujeron los pendientes con contexto acotado y
el glosario explícito `save = ahorrar (contexto económico)`. La exportación pasó por el motor
real en Chromium. El original y las respuestas privadas no se versionan.

| Comprobación | A: 10–13 | B: 21–30 |
| --- | ---: | ---: |
| Páginas fuente / resultado | 4 / 4 | 10 / 8 |
| Referencias OCR contabilizadas | 98 | 270 |
| Unidades de texto exportadas | 13 | 32 |
| Continuaciones entre páginas de origen | 0 | 5 |
| Gráficos/tablas entre párrafos | 2 gráficos | 3 gráficos + 5 tablas |
| Exclusiones registradas | 8 | 17 |
| SHA-256 del PDF generado | `66a2362a3f408cb6de887d77b06488093cab57d59c04a7565d2e81637366a59e` | `d2899d3ca18fcdd1c77317ab978e1b2f74d21f70dfd1783cef59cca84c0fcea6` |

Los dos PDF nuevos se extrajeron de nuevo y se comprobó que **todo el texto traducido
seleccionado aparece una sola vez y en el orden de los elementos fuente**. Cada imagen ocupa
la posición de su elemento en esa secuencia, no una página original obligatoria. La fuente
es única, de 12 pt; se verificaron márgenes y ausencia de IDs, pies técnicos o marcadores
`[ilegible]`. Las diez imágenes incrustadas coinciden byte a byte en píxeles RGB con los
recortes obtenidos de las páginas originales. Se renderizaron y revisaron visualmente las
12 páginas de salida: ejes, valores, filas y columnas permanecen legibles y las imágenes
siguen junto a los párrafos o leyendas correspondientes. El hash del original no cambió.

## Problemas descubiertos y solución acotada

1. Algunas cajas de la IA estaban en píxeles, otras en escala 0–1000: ahora el proveedor
   declara el sistema de coordenadas y se normaliza con las dimensiones reales del PNG.
   No se adivina la escala a partir de números ambiguos.
2. El OCR agrupaba cuerpo, título de tabla y leyenda en un mismo bloque: para la muestra
   limpia, cada línea OCR intacta se vuelve referencia trazable con ID y caja propios.
   Una edición del bloque invalida esta subdivisión.
3. Las Figuras 1 y 2 y varias tablas podían quedar recortadas o contener párrafos vecinos.
   La búsqueda incluye el área de todas sus referencias asignadas y frena ante contenido
   ajeno conocido. Un límite ambiguo bloquea la exportación en lugar de cortar silenciosamente.
4. Un título recuperado podía repetirse al comienzo del párrafo siguiente; la validación
   ahora lo detecta como incertidumbre. Los saltos de línea físicos se unen dentro del
   párrafo sin destruir separaciones reales ni los saltos de fórmulas.
5. Una marca marginal de procesamiento del gráfico se confundía con texto del libro.
   Una revisión visual específica con contexto más amplio clasificó esa marca como ruido.
   Las respuestas ambiguas preservan el contenido y bloquean la exportación; WPS, ISBN,
   ISSN y DOI no se pueden excluir por este camino.
6. Una leyenda corta podía quedar sola al pie de página; cuando el espacio lo permite se
   mantiene con la figura siguiente, sin reducir la tipografía.

## Gates y límites

- Suite completa: **927 PASS, 1 SKIPPED**, 73 archivos. Incluye coordenadas, líneas OCR,
  geometría de figuras, clasificación de ruido, orden, números y fallas conservadoras.
- Chromium local contra build de producción: **28 PASS**, incluidos los modos de traducción
  anteriores, la muestra limpia y el rechazo de una clasificación marginal ambigua.
- TypeScript, ESLint y compilación de producción local: PASS.
- Dos muestras reales exportadas y reabiertas; diez imágenes comprobadas por píxeles; doce
  páginas inspeccionadas visualmente. Esto verifica integridad de extracción y maquetación,
  **no** traducción perfecta ni detección universal de figuras.
- Las celdas, ejes y otros rótulos **dentro de las imágenes permanecen en inglés**. Leyendas
  externas clasificadas como texto sí se traducen. Este es el límite principal frente al
  objetivo de un PDF íntegramente en español.
- La muestra B termina en la página física 30: no se ensayaron los párrafos posteriores a
  su Figura 5. Una figura con fondo oscuro, color complejo, fotografía o tinta que toque
  un límite ambiguo puede seguir siendo rechazada. No se garantiza hallar texto que tanto
  OCR como visión hayan omitido.
- La revisión de textos dudosos por el mismo modelo y la exactitud del PDF frente a las
  traducciones entregadas no demuestran fidelidad semántica al inglés. Antes de considerar
  lectura académica definitiva, revisar cifras, citas, notas y términos económicos.

El ensayo de las primeras diez páginas queda documentado por separado en
`2026-09-27-traduccion-limpia.md`; sus métricas históricas no se mezclan con estas muestras.
