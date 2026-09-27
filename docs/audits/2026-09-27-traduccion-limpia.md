# Traducción limpia: prueba controlada de diez páginas

Fecha: 2026-09-27. Documento: *Easterly 1997*, primeras diez páginas físicas.
Estado: implementación experimental en PR; no certificación de producción ni traducción perfecta.

## Cambios

Nuevo modo opcional, separado de las exportaciones existentes: OCR y visión reconstruyen una
secuencia de títulos, párrafos, notas, fórmulas y figuras. Se exige cobertura única de todas las
referencias OCR, y se registran las exclusiones. El PDF se recompone en A4 con DejaVu Sans de
12 pt, sin láminas originales de fondo, IDs de bloques ni cabeceras/pies de diagnóstico.
Las imágenes son elementos del flujo, entre los mismos párrafos; no están sujetas a la página
original. La muestra limita las solicitudes a diez páginas, con consentimiento propio para
imágenes completas, OCR y contexto vecino, y credenciales del usuario. No hay clave de desarrollo
como fallback público, ni reintentos automáticos de solicitudes fallidas.

Las lecturas numéricas o simbólicas sospechosas requieren revisión por recorte. Hasta dos
lecturas adicionales permiten comparar acuerdos; esto no convierte al modelo en infalible.
Checkpoints en memoria permiten continuar únicamente el trabajo pendiente. Cambios de fuente,
traducción, credenciales o consentimiento invalidan la muestra. Se conservan los modos anteriores.

## Prueba real ejecutada

Se reutilizó el original privado conservado del ensayo anterior, junto con OCR y traducciones
previas cuando coincidían exactamente. No se volvió a ejecutar OCR de todo el libro. La extracción
estructural y las relecturas usaron el adaptador real de OpenAI y la clave de desarrollo ya
autorizada; la exportación usó el motor real dentro de Chromium. El recorrido público completo
de interfaz se comprobó aparte con respuestas simuladas, no con la clave personal guardada.

- Original: 40 páginas, SHA-256 `93e97a534c7c553d9668ce30cac55da20965226438051ea994058b5a41405f15`.
- Alcance exportado: primeras 10 páginas físicas, sin tomar contenido de la página 11.
- Resultado: 8 páginas nuevas; 65 referencias OCR contabilizadas; 57 unidades de texto exportadas.
- Clasificación: 44 párrafos, 13 títulos, una nota, una fórmula, una figura y 11 exclusiones registradas.
- Dos continuaciones de párrafo entre páginas de origen se tradujeron como unidades completas.
- Quince elementos tienen registro de verificación; uno se corrigió en la revisión visual final.
- El texto extraído del PDF coincide íntegramente y en orden con las unidades traducidas conservadas.
- Una sola fuente y tamaño de 12 pt, márgenes y ausencia de etiquetas técnicas comprobados.
- Renderizado e inspección visual de las ocho páginas; originales preservados, hash sin cambios.
- SHA-256 del resultado final: `e797fa4391e8a00a0ee623c504fa81920661129d34be0d0a5d27fbb50f83f996`.

La coincidencia con las unidades traducidas prueba integridad de exportación, **no** equivalencia
semántica perfecta con el original. Los datos, respuestas API y el PDF de prueba permanecen
fuera de Git; esta nota conserva sólo métricas y hashes, nunca credenciales.

## Fallos encontrados y tratamiento

1. Respuesta estructural incompleta: rechazo seguro, sin exportar cobertura falsa.
2. `WPS 1807` interpretado como marca de escaneo: clasificación corregida editorialmente en
   el piloto. Se reforzaron instrucciones y contrato para proteger WPS/ISBN/ISSN/DOI tanto
   en OCR como en la respuesta. Una nueva clasificación errónea se rechaza; no se arregla
   silenciosamente ni se vuelve a gastar API automáticamente.
3. OCR había unido tres párrafos: vinculación conservadora de referencias recuperadas,
   preservando separaciones reales, sin aceptar resúmenes ni coincidencias ambiguas.
4. Título/subtítulo separados por texto lateral: ajuste acotado de títulos conectados;
   no se mueve texto a través de una imagen interpuesta.
5. Continuaciones entre páginas duplicaban palabras: traducción conjunta de la unidad completa.
6. Recorte propuesto cortaba el logotipo: expansión y ajuste a tinta con control de invasión
   de texto ajeno. Confirmado contra el original y mediante una figura sintética recortada.
7. Asteriscos de énfasis añadidos: instrucción de texto plano y limpieza acotada de énfasis
   introducido; no se eliminan asteriscos del original ni operadores matemáticos.
8. “Don't forget to save” produjo “guardar” aun con contexto: corrección de traducción mediante
   glosario económico explícito `save = ahorrar`. La prueba requirió esta intervención editorial;
   el contexto general por sí solo no garantizó la traducción correcta.
9. Referencia pequeña `11` leída como `1`, incluso en relecturas concordantes: corregida tras
   comparar la imagen, con registro `visual-source-audit`. No afirmar revisión totalmente automática.
10. Nuevo estado de progreso vacío duplicaba localizadores existentes: se muestra sólo durante
    el trabajo y se nombra; regresiones de interfaz reejecutadas satisfactoriamente.

## Verificación automatizada

- Suite completa: **900 PASS, 1 SKIPPED**, 69 archivos.
- Contratos/estructura/exportación limpia: 45 pruebas incluidas en esa suite.
- Chromium: **26 PASS**, traducción, revisión automática y nueva muestra limpia.
- TypeScript, ESLint y compilación de producción local: PASS.
- Figura sintética entre párrafos: anclaje, integridad inferior del recorte, tipografía fija,
  reinicio seguro, reutilización de checkpoints y rechazo de estructura incompleta: PASS.
- Contratos: límites, IDs duplicados/faltantes, reducción sospechosa, cifras, incertidumbre,
  credenciales propias y origen extranjero: PASS. No se probaron todos los navegadores.

## Límites y siguiente etapa

Estas diez páginas contienen sólo el logotipo del Banco Mundial, no gráficos reales complejos.
El ensayo sintético verifica el mecanismo, no la detección universal. Rótulos de gráficos/tablas
siguen en su idioma original. Fondos complejos y fotografías pueden activar el rechazo conservador.
La lectura puede omitir texto no encontrado por OCR ni visión; contabilizar IDs no detecta esto.
Una coincidencia de lecturas del mismo modelo tampoco elimina errores semánticos o de notas.

Siguiente etapa propuesta: revisar esta muestra y luego probar un intervalo que contenga gráficos
y tablas reales, antes de ampliar al libro completo o publicar el nuevo modo como estable.
