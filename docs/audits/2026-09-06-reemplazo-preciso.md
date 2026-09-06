# Reemplazo preciso de texto en PDF Studio

## Alcance

El reemplazo seleccionado usa por defecto las operaciones originales del PDF,
sin convertir la página en una imagen. El inspector muestra la fuente detectada,
estilo, tamaño decimal, color de pintado, posición, caja tipográfica, rotación,
opacidad, escala horizontal, espaciado y capa declarada cuando se puede resolver.
Los datos sin evidencia se muestran como desconocidos, no como valores confirmados.

La selección usa métricas de fuente y polígonos para texto girado o inclinado.
Una lista filtrable permite elegir fragmentos pequeños o superpuestos. Se evitan
áreas seleccionables artificiales para marcas combinantes huérfanas sin avance.

## Flujo y protecciones

1. PDF.js extrae texto y operaciones de pintado localmente. La correspondencia
   usa fuente, posición y texto, no el índice de dos listas independientes.
2. El usuario selecciona un fragmento y modifica texto, tamaño o color. Puede
   ajustar el ancho al espacio original, conservar el avance o usar ancho natural.
3. Antes de agregar la edición, el motor reconstruye el candidato y exige una
   única coincidencia de texto, fuente, tamaño y posición. Si no es demostrable,
   rechaza el cambio sin agregar una edición ni activar un modo con pérdidas.
4. El reemplazo mantiene la fuente original, aísla cambios de formato y separa
   streams compartidos para no modificar otras páginas. Deshacer restaura el
   estado anterior; la exportación usa el mismo motor que la vista previa.

El campo vacío elimina el fragmento seleccionado. Esto **no es una garantía de
saneamiento de información sensible** en todo el documento: pueden existir otras
copias, metadatos o estructuras. Para esa finalidad corresponde la herramienta
de redacción y una verificación específica.

La reconstrucción de página sigue disponible, pero sólo como alternativa explícita.
Advierte que pierde enlaces, formularios y capas de esa página y que el fondo de
borrado puede cubrir detalles vecinos. Reutiliza la fuente incrustada cuando está
disponible; no promete equivalencia exacta cuando necesita una alternativa.

## Evidencia reproducible

- `tests/studio.precise-replacement.test.ts`: 17 pruebas nuevas de selección
  inequívoca, fuentes, glifos faltantes, formatos aislados, streams compartidos,
  deshacer, rotación/recorte, borrado vacío, matrices, métricas, opacidad y capas.
- `e2e/studio-precise-replacement.spec.ts`: 9 flujos nuevos de Chromium, desde
  carga y selección hasta inspección del PDF descargado. Incluyen texto duplicado,
  tamaño/color, caracteres no soportados, texto pequeño, escaneo, página girada,
  reconstrucción explícita y eliminación. Sólo usan documentos sintéticos.
- Suite pública completa: 551 pruebas unitarias en 54 archivos y 42 pruebas de
  navegador aprobadas. Tras la última mejora de opacidad/capas se repitieron las
  551 unitarias y los 9 flujos nuevos de navegador, todos aprobados.
- TypeScript, lint estricto y build de producción aprobados; auditoría de
  dependencias sin vulnerabilidades reportadas durante la validación local.
- Se renderizó con Poppler y revisó visualmente una descarga sintética con cambio
  de tamaño/color: texto actualizado rojo, segundo fragmento azul, texto pequeño,
  dibujo vectorial y anotación visibles. No constituye una comparación píxel a
  píxel; Poppler avisó de fuentes de respaldo ausentes para Symbol/ArialUnicode.
- Un documento real aportado por el usuario se inspeccionó sólo localmente:
  51 fragmentos útiles; 49 admitieron el chequeo nativo de identidad con texto
  sin cambios y dos fueron rechazados por segmentación/ambigüedad. Esto es una
  prueba de correspondencia, no 49 ediciones exportadas. El archivo original
  conservó su hash y el ensayo local de interfaz no envió el documento por red.
  No se incluyen aquí el archivo, su nombre, su contenido ni capturas privadas.

## Límites conocidos

- Las cajas usan métricas tipográficas, no contornos exactos de cada glifo.
  No hay certificación exhaustiva de transformaciones afines ni de `UserUnit`.
- El editor nativo rechaza coincidencias ambiguas, fragmentos repartidos entre
  operaciones, glifos inexistentes en la fuente, streams ilegibles, imágenes inline
  y fuentes redefinidas por estados gráficos. No reescribe texto dentro de Form
  XObjects ni implementa edición vertical/Type3.
- El color mostrado es el RGB normalizado por el motor de pintado; no certifica
  el espacio CMYK/perfil ICC original ni composición final con transparencias.
  Una capa desconocida no significa que el archivo carezca de capas.
- La fuente nativa se conserva, no se sustituye por cualquier familia arbitraria.
  Fuentes subconjuntadas pueden carecer de caracteres solicitados.
- No se incorporó un nuevo motor OCR. Un escaneo o texto trazado como vectores
  no permite recuperar con certeza tipografía y estilo originales. La interfaz
  explica esta diferencia en vez de presentar estimaciones como exactas.

No se agregaron dependencias ni servicios externos. El trabajo de formato se
separó en módulos y el matching espacial evita comparar cada fragmento contra
todos los glifos de la página.

## Corrección del entorno de CI

La primera ejecución remota aprobó 41 de 42 casos de navegador. El caso de color
falló porque `.nvmrc` seguía indicando Node 20, mientras que la versión instalada
de PDF.js declara Node >=22.13 o >=24. El lector de operaciones encontraba
`buffer.transferToFixedLength is not a function` y devolvía información parcial.
Se alineó `.nvmrc` con Node 22 y se activó `stopAtErrors` en la inspección del PDF
descargado para que un error de lectura no pueda pasar como un resultado completo.
No se relajó la aserción de color ni se incorporó un polyfill que oculte el fallo.
