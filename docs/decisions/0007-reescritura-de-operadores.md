# 0007: Reemplazo de texto reescribiendo operadores

## Estado

Aceptada el 31 de agosto de 2026. Reemplaza parcialmente a la
[0001](0001-safe-text-replacement.md), que queda vigente solo como camino de
respaldo.

## Contexto

La 0001 concluyó que la edición vectorial real necesitaba "un motor con licencia
compatible o un servicio comercial aislado", porque MuPDF es AGPL-3.0 y este
proyecto es MIT. La premisa era esta, y sigue siendo cierta:

> PDF.js puede localizar texto existente, pero no reescribir sus operadores. A
> su vez, `pdf-lib` permite agregar texto y completar formularios, pero no
> editar el texto que ya forma parte del contenido de una página.

La conclusión no lo era. Lo que faltaba no era un motor: era un lector de
content streams. Son unas cuatrocientas líneas y no agrega ninguna dependencia.

## Decisión

Reemplazar una palabra editando los operadores que la dibujan.

1. Se leen los content streams de la página y se parsean a operaciones,
   guardando el rango de bytes del que salió cada operando.
2. Se lee cada fuente del recurso `/Font`: cuántos bytes forma un código, qué
   carácter significa cada código (`/ToUnicode`, o las tablas de codificación) y
   cuánto mide.
3. Se recorre el stream como lo haría un visor, siguiendo el estado de texto, y
   se anota dónde cayó cada glifo y cuánto avanzó.
4. Se busca la palabra sobre ese texto reconstruido y se reescriben únicamente
   los bytes del operador que la dibuja, con los códigos de la misma fuente.
5. El stream editado se escribe **encima del objeto original**, no como objeto
   nuevo: `pdf-lib` no tiene recolección de basura y un stream huérfano seguiría
   conteniendo la palabra vieja dentro del archivo.

Se reescribe por empalme de rangos de bytes, no reserializando. Todo lo que este
parser no entiende — el contenido binario de una imagen en línea, los
diccionarios — se copia en vez de reinterpretarse.

## Lo que no se puede conservar, y qué se hace

Una palabra distinta mide distinto. Hay exactamente tres opciones y cada una
cuesta algo; se nombran en vez de elegir una en silencio:

- `squeeze` escala la palabra nueva al ancho de la vieja. No se mueve nada, no
  hay hueco ni superposición, y los glifos quedan unos puntos porcentuales
  angostos o anchos. Es el que usa la interfaz.
- `keep-layout` la dibuja sin deformar y devuelve la diferencia, así nada se
  mueve — pero una palabra larga puede pisar la siguiente.
- `keep-flow` deja que el resto del renglón acompañe, como haría un procesador
  de texto.

## Lo que se rechaza, y por qué se dice

Los rechazos son el caso ordinario, no la excepción, y cada uno tiene nombre:

- **La fuente no tiene el signo.** Un PDF incrusta solo los glifos que el
  documento usó. Un documento que nunca escribió una «á» lleva una fuente que no
  puede dibujarla, y no hay forma de conseguirla de esa misma fuente.
- **La palabra está partida** entre dos operadores o su fuente no se pudo leer.
- **El operador no se reescribe**: `'` y `"` además saltan de renglón, y
  reescribirlos como `TJ` perdería ese salto en silencio.
- **Hay un glifo ilegible** en la coincidencia, así que sus bytes no son
  confiables.
- **El ajuste deformaría demasiado** la palabra.

La interfaz informa cuántas se reemplazaron, cuántas no y qué signos faltaban.

## Consecuencias

- La página sigue siendo una página: conserva su texto seleccionable, sus
  vectores, sus enlaces, su formulario y sus anotaciones. No se convierte en
  imagen y no crece.
- Reemplazar dos veces en la misma página ya no degrada nada, porque no hay
  generaciones de mapa de bits.
- La palabra vieja no queda en el archivo en ninguna forma.
- Los acentos de TeX siguen fuera de alcance. En esas fuentes «í» no existe:
  «Asimetrías» son cuatro glifos donde el lector ve una letra — un acento suelto
  y una i sin punto, acomodados con kerning. Buscar la palabra que el lector ve
  no la encuentra, y escribirla exigiría descomponerla y aprender del propio
  documento cómo coloca el acento. Está identificado y sin resolver.
- El camino de la 0001 — rasterizar la página y dibujar encima — sigue
  disponible como respaldo, y es el único que funciona cuando la fuente no tiene
  los signos.
- Solo se ofrece cuando están seleccionadas todas las coincidencias de una
  página, porque el panel encuentra sus coincidencias con PDF.js y el motor con
  su propio lector, y hacerlas coincidir por número sería apostar a que ordenan
  igual. Perder esa apuesta significa reemplazar la palabra equivocada en un
  documento que alguien después manda.
