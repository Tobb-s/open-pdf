# OpenPDF

Herramientas de PDF que se ejecutan enteras en el navegador. Sin subir archivos, sin
servidor al que subirlos: la aplicación son ficheros estáticos y el motor de PDF corre
en la propia página.

## Herramientas

| Herramienta | Qué hace |
| --- | --- |
| **Comprimir** | Reduce el tamaño reconvirtiendo cada página a imagen. Avisa cuando el documento tiene texto real, porque en ese caso suele crecer en vez de encoger. |
| **OCR** | Reconoce el texto de un PDF escaneado y devuelve una copia con capa de texto buscable, más el texto plano. Seis idiomas. |
| **Unir** | Combina varios PDF en uno, en el orden que elijas. |
| **Dividir** | Extrae un rango de páginas, corta el documento en 2, 4, 6, 8 o 10 partes, o parte cada página en su propio archivo. Sin tope de páginas: un libro de 700 se divide en segundos. |
| **Organizar** | Reordena, rota y elimina páginas, con vista previa de cada una. |
| **PDF a Word** | Extrae el texto a un `.docx` editable. Sólo texto: no conserva imágenes, tablas ni maquetación. |
| **Editar** | Coloca texto en cualquier punto de una página. |
| **Rellenar formulario** | Completa los campos interactivos de un formulario PDF. |
| **PPT y Word a PDF** | Convierte PowerPoint, Word, Excel y sus equivalentes libres a PDF con el motor de LibreOffice compilado a WebAssembly. Requiere descargar el motor una vez (~78 MB), sólo cuando lo pedís. |
| **Imágenes y PDF** | Convierte cada página en JPG, o une imágenes JPG, PNG y WebP en un PDF. |
| **Marca de agua** | Pone un texto o una imagen encima de las páginas que elijas, con opacidad, inclinación y posición. Vista previa de la página real, no una aproximación. |
| **Numerar** | Numera páginas eligiendo esquina, desde qué número empezar y formato «3» o «3 de 40». Sale derecho también en páginas rotadas. |
| **Procesar por lote** | Aplica una misma receta a hasta 50 PDF: rotación, marca de agua, numeración y aplanado de formularios. Entrega un ZIP con los resultados y un informe JSON que registra éxitos, errores y hashes SHA-256 sin frenar todo el lote si un archivo falla. |
| **Studio** | Editor con sesión: abrís el documento y trabajás sobre él. Páginas (girar, borrar, reordenar, recortar, insertar de otro PDF o de imágenes), edición visual (agregar o reemplazar texto, editar párrafos completos con reflujo, fuente, estilo, color, alineación e interlineado, dibujar rectángulos, insertar imágenes y trazar a mano), búsqueda en todo el documento con reemplazo o censura de varias coincidencias en una sola edición, saneamiento de metadatos, comentarios, adjuntos y acciones automáticas, comparación local de dos versiones con páginas movidas, modificadas, agregadas o eliminadas, mapa visual e informe JSON, firma electrónica escrita, dibujada o cargada, y revisión profesional con resaltado, subrayado, tachado de texto, comentarios y respuestas. Cada firma incluye un registro de auditoría JSON con fecha, método, página y hash SHA-256 de su apariencia; la interfaz aclara que no es una firma digital con certificado. El reemplazo, la edición de párrafos y la censura eliminan el texto anterior de las páginas reconstruidas y recuperan una capa buscable para el contenido restante. Las revisiones se exportan como anotaciones PDF reales, compatibles con lectores como Adobe Acrobat. También incluye OCR, formularios, marca de agua, numeración y datos del documento. Podés deshacer sin límite, cerrar la pestaña y volver. |

## Idiomas

El sitio está en **español por defecto** y en inglés. Cada idioma tiene sus propias
URLs — `/es/merge` y `/en/merge` — y las dos versiones se prerenderizan estáticamente,
declarando sus traducciones con `hreflang`. Los slugs no se traducen a propósito: así
los enlaces existentes siguen funcionando y hay una sola ruta por herramienta.

El selector está siempre a la vista en la barra superior y te deja en la misma
herramienta al cambiar. `/` y `/merge` redirigen a `/es` y `/es/merge`.

Todo el texto visible vive en `src/lib/i18n/dictionaries.ts`, tipado con una única
interfaz `Dictionary`: si a un idioma le falta una clave, no compila.

## El conversor de Office

`PPT y Word a PDF` es la única herramienta que necesita descargar algo pesado, y por eso
lo pide de forma explícita en vez de hacerlo al abrir la página.

Usa [LibreOffice compilado a WebAssembly](https://github.com/allotropia/zetajs) — el mismo
motor del escritorio — así que un gráfico sale como gráfico y una tabla como tabla, no como
captura de pantalla. Son unos 51 MB transferidos (250 MB sin comprimir), una sola vez, con
caché permanente.

Dos concesiones que conviene conocer, ambas **acotadas a esa ruta**:

- **Aislamiento de origen cruzado.** El motor usa hilos de WebAssembly, que necesitan
  `SharedArrayBuffer`, que el navegador sólo concede con `COOP` + `COEP`. Sólo es viable
  porque el sitio ya no carga nada de terceros.
- **`unsafe-eval` y `data:` en `script-src`.** El cargador de Emscripten evalúa cadenas y
  zetajs arranca su worker desde un `data:` URL. El resto de las rutas conserva la política
  estricta, y en esta siguen cerrados `connect-src`, `img-src` y `form-action`: aunque
  entrara código, no tendría a dónde mandar un documento.

## Privacidad

La promesa es verificable, no declarativa:

- **No hay rutas de servidor.** El build produce sólo páginas estáticas. No existe ningún
  endpoint al que se pueda enviar un archivo.
- **No se carga código de terceros en tiempo de ejecución.** El worker de pdf.js y el
  motor de OCR se copian desde `node_modules` a `public/vendor/` durante el build, y el
  motor de LibreOffice —que no está en npm— se baja en el build desde el CDN de
  ZetaOffice y queda fijado por sha256 en `scripts/vendor-assets.mjs`: si el archivo
  cambia, el build falla en vez de servir otra cosa. Todo se sirve desde el propio
  dominio. La `Content-Security-Policy` que se envía es
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`, y la ruta de Office lleva
  además cabeceras de aislamiento de origen cruzado. El `'unsafe-inline'` está porque
  Next inyecta scripts en línea; el navegador rechaza igual cualquier script de otro
  origen.
- **Después de cargar una herramienta, no vuelve a pedir nada al servidor** para
  procesar tu archivo. No hay service worker, así que la primera visita a cada
  herramienta sí baja lo suyo: sin conexión no arranca de cero.

Esto importa porque el riesgo real de una herramienta así no es que suba tu archivo, sino
que ejecute código ajeno en la misma pestaña donde está el documento. Con la política
anterior no podía hacerlo.

## Requisitos

- Node.js 20.9 o superior — la versión exacta está en `.nvmrc`.
- npm 10 o superior.

## Cómo ejecutarlo

```bash
git clone https://github.com/Tobb-s/open-pdf.git
cd open-pdf
npm ci
npm run dev
```

Y abrir `http://localhost:3000`.

La primera ejecución de `npm run dev` o `npm run build` dispara `npm run vendor`, que
copia el worker de pdf.js y el motor de OCR a `public/vendor/` y descarga los modelos de
idioma de Tesseract (unos 10 MB, una sola vez; después quedan en disco). Ese directorio
está en `.gitignore`: se regenera, no se versiona.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Build de producción. |
| `npm start` | Sirve el build de producción. |
| `npm run lint` | ESLint. |
| `npm test` | Tests con Vitest. |
| `npm run vendor` | Regenera `public/vendor/` a mano. |

## Tests

Los tests cubren la lógica donde un fallo es silencioso: la extracción de palabras del
resultado del OCR, el reensamblado de párrafos al convertir a Word, el parseo de rangos
de páginas, los nombres de archivo y la clasificación de errores.

Es deliberado que sean esas: un OCR que devuelve un PDF sin capa de texto, o un `.docx`
con las palabras pegadas, no lanza ninguna excepción — la interfaz anuncia éxito igual.
Sólo un test que afirme algo sobre el *resultado* detecta ese tipo de fallo.

```bash
npm test
```

## Arquitectura

```
src/
  app/[lang]/     una ruta por herramienta y por idioma, con su layout de metadatos
  components/     FileDropzone, ErrorNotice, ProgressPanel, Navbar, ToolCard,
                  StampPreview y StampControls (compartidos por marca de agua
                  y numeración)
  lib/
    pdfjs.ts      carga pdf.js con el worker local; copia los bytes antes de
                  pasarlos al worker, que los transfiere y deja el original vacío
    ocr.ts        extrae palabras de blocks → paragraphs → lines → words
    textLayout.ts reconstruye líneas y párrafos a partir de fragmentos sueltos
    pageRange.ts  parseo de "1-3, 7, 12-9"
    geometry.ts   el único lugar donde se convierten coordenadas: respeta
                  /Rotate y CropBox, y está verificado contra pdf.js
    stamp.ts      dibuja marcas de agua y números encima de páginas existentes
    batch.ts      aplica una receta reproducible e independiente a cada PDF de un lote
    pageEdits.ts  reordenar, rotar y borrar páginas mutando el documento en el
                  sitio, sin reconstruirlo con copyPages
    pdfGc.ts      recolector: pdf-lib no tiene, y sin esto una página borrada
                  seguía viajando entera dentro del archivo
    pdfio.ts      load/save de pdf-lib sin sus ticks de setTimeout
    verify/
      structural.ts  compara el catálogo de entrada contra el de salida y
                     declara qué sobrevivió, contando por referencia viva
    studio/
      script.ts     el guion de edición: una lista con un cursor. El estado es
                    una función pura de (ediciones, cursor), que es lo que hace
                    que deshacer sea correcto y gratis
      materialize.ts convierte ese estado en bytes, siempre desde el original y
                    nunca desde la materialización anterior
      studio.worker.ts  donde vive pdf-lib mientras el editor está abierto
      engine.ts     el puente al worker, con vuelta al hilo principal si el
                    navegador no da uno
      store.ts      la sesión en IndexedDB: bytes originales más la lista de
                    ediciones, nunca un documento ya armado
      verify.ts     lee de vuelta lo que se escribió: los campos, desde el
                    archivo producido, y qué no puede viajar con las páginas
                    que se importan
    errors.ts     traduce excepciones a mensajes con causa y salida
    limits.ts     topes de tamaño y páginas, cancelación, y el `yield` que
                  cede el control al navegador sin usar temporizadores (que un
                  navegador limita a ~1/segundo en pestañas de fondo)
    tools.ts      catálogo de herramientas: orden y color
    i18n/
      dictionaries.ts  todo el texto visible, en español e inglés
      context.tsx      provee el diccionario al árbol de React
      metadata.ts      title/description/hreflang por herramienta e idioma
scripts/
  vendor-assets.mjs   copia las dependencias de runtime a public/vendor/
tests/            Vitest, en Node
```

## Integración continua

Cada push y cada pull request pasa por `npm ci`, `npm run lint`, `npm test`,
`npm run build` y `npm audit --omit=dev --audit-level=high`.

## Licencia

MIT. Ver `LICENSE`.
