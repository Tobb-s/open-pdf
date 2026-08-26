# 0006: Reutilizacion de fuentes incrustadas

## Contexto

Studio podia localizar texto con PDF.js y reemplazarlo de forma segura, pero el texto nuevo
usaba una fuente PDF estandar. Eso conserva la edicion, no necesariamente la identidad visual
del documento. Un PDF no siempre contiene una fuente reutilizable: puede depender de una fuente
del sistema, contener solo una sustitucion de visor o guardar un subconjunto con pocas letras.

## Decision

Cuando se reconstruye un documento, Studio inspecciona sus recursos PDF y extrae los programas
`FontFile`, `FontFile2` o `FontFile3` que esten incrustados y midan como maximo 8 MB. PDF.js
asocia el texto seleccionado con su nombre de fuente y Studio ofrece una casilla explicita para
usar ese programa al reemplazar el fragmento o el parrafo.

Antes de crear la edicion, `fontkit` valida que cada caracter nuevo exista en la fuente. Si falta
un caracter, el reemplazo no se crea con esa fuente: la persona puede usar la fuente estandar.
El programa se guarda como un activo de la sesion en IndexedDB y se incrusta de nuevo al exportar,
por lo que deshacer, reabrir la sesion y descargar conservan el resultado.

## Consecuencias

- La deteccion y la reutilizacion ocurren en el navegador; el archivo y la fuente no se suben.
- La fuente no se copia automaticamente: usarla es una decision visible y la interfaz recuerda
  que la persona debe tener permiso para reutilizarla.
- No se promete recuperar una fuente de un PDF escaneado: primero necesita OCR y aun asi la fuente
  original no puede conocerse con certeza.
- Las fuentes protegidas, ausentes, con filtros no admitidos, demasiado grandes o con glifos
  insuficientes se muestran como detectadas pero no disponibles. La edicion sigue siendo posible
  con las fuentes estandar de Studio.
