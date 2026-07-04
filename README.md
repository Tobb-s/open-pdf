# OpenPDF

OpenPDF es una herramienta web para trabajar con archivos PDF de forma simple, rápida y privada.

La idea del proyecto es ofrecer una alternativa abierta a las páginas online de PDF, pero con una diferencia importante: los archivos se procesan en el navegador. Eso significa que, en condiciones normales de uso, tus documentos no necesitan subirse a un servidor externo para ser editados.

## Qué se puede hacer

Actualmente OpenPDF incluye estas herramientas:

- **Unir PDFs**: combina varios archivos PDF en un solo documento.
- **Dividir PDFs**: separa páginas o rangos de páginas en archivos nuevos.
- **Editar PDFs**: agrega texto sobre un PDF existente.
- **Completar formularios PDF**: detecta campos interactivos y permite llenarlos.
- **Convertir PDF a Word**: genera un archivo `.docx` a partir del contenido del PDF.

## Por qué es útil

Muchas herramientas online de PDF son cómodas, pero obligan a subir documentos a servidores de terceros. Eso puede ser un problema si el archivo contiene información personal, laboral o sensible.

OpenPDF busca resolver ese problema con una experiencia parecida, pero priorizando:

- **Privacidad**: el procesamiento ocurre del lado del navegador.
- **Transparencia**: el código es abierto y se puede revisar.
- **Simplicidad**: cada herramienta está pensada para hacer una tarea concreta.
- **Velocidad**: no hace falta esperar una carga a un servidor para operaciones comunes.

## Tecnologías utilizadas

El proyecto está construido con:

- [Next.js](https://nextjs.org/) como framework principal.
- [React](https://react.dev/) para la interfaz.
- [TypeScript](https://www.typescriptlang.org/) para escribir código más seguro.
- [Tailwind CSS](https://tailwindcss.com/) para los estilos.
- [pdf-lib](https://pdf-lib.js.org/) y [pdfjs-dist](https://mozilla.github.io/pdf.js/) para trabajar con PDFs.
- [docx](https://www.npmjs.com/package/docx) para generar documentos de Word.

## Requisitos

Para correr el proyecto localmente necesitas:

- Node.js `24.18.0` o superior.
- npm `11.16.0` o superior.

El repo incluye un archivo `.nvmrc` para que puedas usar la misma versión de Node recomendada.

## Cómo ejecutar el proyecto

1. Clonar el repositorio:

   ```bash
   git clone https://github.com/Tobb-s/open-pdf.git
   cd open-pdf
   ```

2. Instalar dependencias:

   ```bash
   npm ci
   ```

3. Iniciar el servidor de desarrollo:

   ```bash
   npm run dev
   ```

4. Abrir la app en el navegador:

   ```text
   http://localhost:3000
   ```

## Scripts disponibles

- `npm run dev`: inicia el proyecto en modo desarrollo.
- `npm run build`: genera una versión optimizada para producción.
- `npm run start`: ejecuta la versión de producción.
- `npm run lint`: revisa problemas de estilo y calidad en el código.

## Calidad y seguridad

El proyecto tiene un workflow de GitHub Actions que revisa automáticamente los cambios cuando se abre un pull request.

Ese control ejecuta:

- instalación limpia de dependencias con `npm ci`;
- revisión de código con `npm run lint`;
- build de producción con `npm run build`.

Esto ayuda a detectar errores antes de mezclar cambios en la rama principal.

## Licencia

Este proyecto está distribuido bajo licencia MIT. Puedes ver más detalles en el archivo `LICENSE`.
