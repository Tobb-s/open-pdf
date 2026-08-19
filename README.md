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
| **Dividir** | Extrae un rango de páginas, o parte cada página en su propio archivo. |
| **Organizar** | Reordena, rota y elimina páginas, con vista previa de cada una. |
| **PDF a Word** | Extrae el texto a un `.docx` editable. Sólo texto: no conserva imágenes, tablas ni maquetación. |
| **Editar** | Coloca texto en cualquier punto de una página. |
| **Rellenar formulario** | Completa los campos interactivos de un formulario PDF. |
| **Imágenes y PDF** | Convierte cada página en JPG, o une imágenes JPG, PNG y WebP en un PDF. |

## Privacidad

La promesa es verificable, no declarativa:

- **No hay rutas de servidor.** El build produce sólo páginas estáticas. No existe ningún
  endpoint al que se pueda enviar un archivo.
- **No se carga código de terceros.** El worker de pdf.js y el motor de OCR se copian
  desde `node_modules` a `public/vendor/` durante el build y se sirven desde el propio
  dominio. La `Content-Security-Policy` es `script-src 'self' 'wasm-unsafe-eval'`: el
  navegador rechaza cualquier script de otro origen.
- **Funciona sin conexión** una vez cargada la página.

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
  app/            una ruta por herramienta, más su layout con metadatos
  components/     FileDropzone, ErrorNotice, ProgressPanel, Navbar, ToolCard
  lib/
    pdfjs.ts      carga pdf.js con el worker local; copia los bytes antes de
                  pasarlos al worker, que los transfiere y deja el original vacío
    ocr.ts        extrae palabras de blocks → paragraphs → lines → words
    textLayout.ts reconstruye líneas y párrafos a partir de fragmentos sueltos
    pageRange.ts  parseo de "1-3, 7, 12-9"
    errors.ts     traduce excepciones a mensajes con causa y salida
    limits.ts     topes de tamaño y páginas, cancelación
    tools.ts      catálogo único: home, navegación, sitemap y metadatos
scripts/
  vendor-assets.mjs   copia las dependencias de runtime a public/vendor/
tests/            Vitest, en Node
```

## Integración continua

Cada push y cada pull request pasa por `npm ci`, `npm run lint`, `npm test`,
`npm run build` y `npm audit --omit=dev --audit-level=high`.

## Licencia

MIT. Ver `LICENSE`.
