# 0004: Edicion segura de parrafos

## Estado

Aceptada el 25 de agosto de 2026.

## Contexto

Reemplazar un fragmento aislado no alcanza para corregir contratos, informes o apuntes que
necesitan recomponer un bloque entero. Un editor de parrafos debe reconocer lineas relacionadas,
separar columnas y titulos, volver a distribuir palabras y permitir formato sin superponer el
resultado sobre contenido vecino.

El proyecto no incorpora un motor PDF vectorial comercial. PDF.js puede leer la geometria del
texto, pero no reescribir los operadores originales que lo dibujaron.

## Decision

Studio ofrece una herramienta de parrafos enteramente local:

1. Agrupa elementos horizontales de PDF.js por linea, columna, distancia y tamano tipografico.
2. Excluye texto rotado porque no puede recomponerse con la misma garantia geometrica.
3. Calcula el mayor tamano inicial que cabe con las metricas reales de la fuente PDF elegida.
4. Permite cambiar contenido, familia, negrita, cursiva, tamano, color, fondo, alineacion e
   interlineado.
5. Bloquea la aplicacion si el resultado excede el bloque original o contiene un caracter que
   las fuentes PDF estandar no pueden representar.
6. Reconstruye la pagina, agrega las lineas nuevas como texto PDF y recupera una capa buscable
   para todo el texto no editado.

El cambio completo es una sola edicion reversible y el archivo original no se modifica.

## Consecuencias

- El texto anterior deja de existir en el contenido exportado y no queda oculto debajo del nuevo.
- Los saltos de linea explicitos se respetan y las palabras largas se dividen cuando es necesario.
- La edicion queda limitada al rectangulo original para proteger el contenido que lo rodea.
- Las paginas reconstruidas pierden enlaces, formularios, capas y anotaciones interactivas; la
  interfaz lo informa antes de aplicar.
- El soporte tipografico se limita a Helvetica, Times y Courier con sus variantes estandar.
- La edicion de texto rotado o vectorial real queda pendiente de un motor con licencia compatible.
