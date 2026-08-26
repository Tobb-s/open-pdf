# 0003: Busqueda, censura y saneamiento local

## Estado

Aceptada el 25 de agosto de 2026.

## Contexto

Studio ya podia reemplazar un fragmento elegido en una pagina. Para documentos extensos se
necesita localizar una palabra o frase en todas las paginas, revisar las coincidencias y aplicar
un cambio coherente sin repetir la operacion manualmente. La censura, ademas, debe quitar el
texto del contenido exportado: cubrirlo solamente con un rectangulo no protege la informacion.

Los PDF tambien pueden contener informacion no visible, como metadatos, comentarios,
archivos adjuntos, JavaScript y acciones automaticas.

## Decision

La busqueda y el saneamiento se ejecutan enteramente en el navegador:

1. PDF.js crea un indice temporal de los fragmentos de texto de cada pagina.
2. El usuario elige las coincidencias que quiere reemplazar o censurar.
3. Las paginas afectadas se reconstruyen a partir de una imagen de alta resolucion.
4. El texto restante recupera una capa buscable; el reemplazo agrega texto PDF nuevo y la
   censura registra las palabras prohibidas para comprobar que no sobrevivan al exportar.
5. Todas las paginas cambian dentro de una unica edicion reversible.
6. El saneamiento elimina solo las categorias elegidas al materializar el PDF final.

Las anotaciones de enlace se conservan durante el saneamiento, pero se quitan sus acciones si
el usuario eligio eliminar scripts y acciones automaticas. El archivo original no se modifica.

## Consecuencias

- Una frase puede atravesar varios fragmentos internos del PDF y aun asi encontrarse.
- La censura elimina tanto la apariencia como el texto extraible y se verifica antes de exportar.
- Las paginas reconstruidas pierden enlaces, formularios, capas y anotaciones interactivas; la
  interfaz informa este limite antes de aplicar el cambio.
- El saneamiento puede no producir un cambio visible porque opera sobre contenido oculto.
- La busqueda no sale del dispositivo ni crea un indice persistente del documento.
