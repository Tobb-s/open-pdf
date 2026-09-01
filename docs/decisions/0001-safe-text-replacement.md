# 0001: Reemplazo seguro de texto

## Estado

Aceptada el 25 de agosto de 2026. Reemplazada parcialmente por la
[0007](0007-reescritura-de-operadores.md) el 31 de agosto de 2026: la premisa de
que la edición vectorial real necesitaba un motor con licencia incompatible
resultó falsa. Lo que faltaba era un lector de content streams, no un motor.
Este camino sigue siendo el respaldo, y es el único que funciona cuando la fuente
incrustada no tiene los signos que la palabra nueva necesita.

## Contexto

OpenPDF Studio usa `pdf-lib` para escribir documentos y PDF.js para mostrarlos y leer su
contenido. PDF.js puede localizar texto existente, pero no reescribir sus operadores. A su
vez, `pdf-lib` permite agregar texto y completar formularios, pero no editar el texto que ya
forma parte del contenido de una pagina.

MuPDF puede aplicar redacciones y manipular contenido, pero su distribucion es AGPL-3.0 o
comercial. Incorporarlo obligaria a relicenciar esta aplicacion MIT o contratar una licencia.

## Decision

El reemplazo de texto se implementa localmente y sin dependencias nuevas:

1. PDF.js localiza el fragmento que el usuario selecciona.
2. La pagina visible se renderiza a una imagen PNG de alta resolucion.
3. El fragmento se elimina de esa imagen y la imagen reemplaza el contenido de la pagina.
4. Se escribe el texto nuevo y se reconstruye una capa invisible con el resto del texto.
5. Todo se guarda como una unica edicion para que Deshacer lo revierta de forma completa.

La interfaz informa antes de aplicar que la pagina pierde enlaces, formularios, capas y
anotaciones interactivas. El archivo original nunca se modifica.

## Consecuencias

- El texto anterior no queda oculto debajo de una forma: desaparece del contenido exportado.
- El resto de la pagina sigue siendo buscable y seleccionable mediante la capa reconstruida.
- La apariencia se conserva como imagen, pero el texto nuevo usa una fuente PDF estandar.
- Reemplazar varias veces en la misma pagina vuelve a rasterizarla y puede aumentar el peso.
- Una futura edicion vectorial real necesita un motor con licencia compatible o un servicio
  comercial aislado y explicitamente aprobado.
