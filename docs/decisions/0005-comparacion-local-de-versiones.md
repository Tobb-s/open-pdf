# 0005: Comparacion local de versiones PDF

## Estado

Aceptada el 25 de agosto de 2026.

## Contexto

Comparar dos PDF pagina por pagina no alcanza cuando una revision reordena contenido. Tambien hay
documentos escaneados sin texto extraible y cambios visuales que conservan exactamente las mismas
palabras. La herramienta debe distinguir esos casos sin enviar archivos a un servidor.

## Decision

Studio incorpora un espacio de comparacion enteramente local:

1. Extrae el texto y una huella visual de baja resolucion de cada pagina de ambas versiones.
2. Empareja primero paginas identicas en la misma posicion y despues paginas identicas movidas.
3. Empareja las paginas restantes por una similitud combinada de texto y apariencia, con un umbral
   conservador para no confundir una pagina eliminada con otra nueva.
4. Clasifica cada resultado como sin cambios, modificado, movido, agregado o eliminado.
5. Muestra diferencias de palabras y, para el par seleccionado, renderiza ambas paginas y un mapa
   de pixeles distintos.
6. Permite descargar un informe JSON con archivos, resumen, paginas, similitudes y cambios de texto.

Las diferencias de texto usan `diff` y el mapa visual usa `pixelmatch`. Ambas dependencias tienen
licencias permisivas y se ejecutan en el navegador.

## Consecuencias

- Los dos documentos permanecen en el equipo del usuario y no se suben a OpenPDF.
- El reordenamiento se informa por separado de una modificacion de contenido.
- Las paginas escaneadas pueden compararse por apariencia aunque no tengan una capa de texto.
- La huella visual acelera el emparejamiento; el mapa detallado solo se calcula para el par elegido.
- El resultado es una ayuda de revision, no una certificacion legal ni una prueba de identidad.
- La deteccion es heuristica: cambios de renderizado, fuentes o escaneos pueden afectar la similitud.
- Para comparar semanticamente el texto de escaneos sigue siendo necesario aplicar OCR primero.
