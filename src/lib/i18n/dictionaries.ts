import type { Anchor } from '@/lib/geometry';
import type { ToolSlug } from '@/lib/tools';
import type { StructureCategory } from '@/lib/verify/structural';

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

interface ToolCopy {
  title: string;
  navLabel: string;
  tagline: string;
  description: string;
  keywords: string[];
}

export interface Dictionary {
  meta: {
    siteTitle: string;
    siteDescription: string;
    /** Suffix appended to each tool's page title. */
    titleSuffix: string;
  };
  nav: {
    switchLanguage: string;
    github: string;
  };
  common: {
    choosePdf: string;
    orDropIt: string;
    orDropThem: string;
    removeFile: string;
    download: string;
    page: string;
    pages: string;
    field: string;
    fields: string;
    image: string;
    images: string;
    file: string;
    files: string;
    saving: string;
    cancel: string;
    dismiss: string;
    keepTabVisible: string;
    processingPaused: string;
  };
  dropzone: {
    notSupported: (names: string, kind: string) => string;
    skipped: (added: number, kind: string, rejected: number) => string;
    kindPdf: string;
    kindImage: string;
    kindOffice: string;
  };
  home: {
    badge: string;
    headingLine1: string;
    headingLine2: string;
    intro: string;
    searchPlaceholder: string;
    searchLabel: string;
    noMatches: (query: string) => string;
    clearSearch: string;
    private: string;
    fast: string;
    openSource: string;
    whyTitle: string;
    whyBody: string;
    footer: string;
    readCode: string;
  };
  notFound: {
    title: string;
    body: string;
    seeAll: string;
  };
  /** Human names for what a PDF carries besides pages, used by result reports. */
  structures: Record<StructureCategory, string>;
  tools: Record<ToolSlug, ToolCopy>;
  compress: {
    heading: string;
    intro: string;
    badge: string;
    chooseLevel: string;
    presets: Record<'extreme' | 'recommended' | 'low', { title: string; description: string }>;
    recommendedBadge: string;
    textWarningTitle: string;
    textWarningBody: string;
    action: string;
    working: string;
    reading: string;
    compressingPage: (current: number, total: number) => string;
    saving: string;
    doneTitle: string;
    grewTitle: string;
    doneBody: (pages: number) => string;
    grewBody: string;
    original: string;
    compressed: string;
    saved: string;
    savedNothing: string;
    downloadAnyway: string;
    another: string;
  };
  ocr: {
    heading: string;
    intro: string;
    step1: string;
    step2: string;
    upTo: (pages: number) => string;
    chooseAnother: string;
    languages: Record<'spa' | 'eng' | 'fra' | 'deu' | 'ita' | 'por', string>;
    action: string;
    working: string;
    starting: string;
    reading: string;
    readingPage: (current: number, total: number) => string;
    assembling: string;
    noTextTitle: string;
    noTextBody: string;
    doneTitle: (words: number) => string;
    doneBody: (pages: number) => string;
    searchablePdf: string;
    searchablePdfNote: string;
    plainText: string;
    plainTextNote: string;
    recognisedText: string;
    copy: string;
    copied: string;
    copyFailedTitle: string;
    copyFailedBody: string;
    another: string;
  };
  merge: {
    heading: string;
    intro: string;
    choose: string;
    listHeading: (count: number) => string;
    removeAll: string;
    adding: (name: string) => string;
    saving: string;
    action: string;
    working: string;
    needTwo: string;
    moveEarlier: (name: string) => string;
    moveLater: (name: string) => string;
    remove: (name: string) => string;
    doneTitle: (pages: number) => string;
    lostNote: (list: string) => string;
    another: string;
  };
  split: {
    heading: string;
    intro: string;
    rangeLabel: string;
    eachPage: string;
    placeholder: string;
    action: string;
    working: string;
    eachPageNote: (pages: number) => string;
    syntaxNote: string;
    selected: (count: number, summary: string) => string;
    invalid: (tokens: string, pages: number) => string;
    noneTitle: string;
    noneBody: (pages: number) => string;
    extracting: string;
    extractingPage: (current: number, total: number) => string;
    packing: string;
    doneZip: (files: number) => string;
    doneSingle: (pages: number) => string;
    doneBody: string;
    downloadZip: string;
    downloadPdf: string;
    another: string;
  };
  organize: {
    heading: string;
    intro: string;
    preparing: string;
    renderingPage: (current: number, total: number) => string;
    pageLabel: (n: number) => string;
    moveEarlier: (n: number) => string;
    moveLater: (n: number) => string;
    rotate: (n: number) => string;
    remove: (n: number) => string;
    hint: string;
    action: string;
    doneTitle: (pages: number) => string;
    doneBody: string;
    keptNote: (list: string) => string;
    lostNote: (list: string) => string;
    another: string;
  };
  pdfToWord: {
    heading: string;
    intro: string;
    reading: string;
    extractingPage: (current: number, total: number) => string;
    building: string;
    noTextTitle: string;
    noTextBody: string;
    action: string;
    working: string;
    doneTitle: string;
    doneBody: (paragraphs: number, pages: number) => string;
    downloadDocx: string;
    another: string;
  };
  edit: {
    heading: string;
    intro: string;
    choose: string;
    addText: string;
    placing: string;
    hint: string;
    annotationLabel: string;
    removeAnnotation: string;
    previous: string;
    next: string;
    pageOf: (current: number, total: number) => string;
    nothingTitle: string;
    nothingBody: string;
    action: string;
    doneTitle: string;
    doneBody: (boxes: number) => string;
    keepEditing: string;
  };
  fillForm: {
    heading: string;
    intro: string;
    choose: string;
    chooseNote: string;
    looking: string;
    noFieldsTitle: string;
    noFieldsBody: string;
    sectionTitle: string;
    checked: string;
    unchecked: string;
    leaveEmpty: string;
    action: string;
    working: string;
    doneTitle: (filled: number, total: number) => string;
    doneBody: string;
    skippedNote: (names: string) => string;
    keepEditing: string;
  };
  imagePdf: {
    heading: string;
    badge: string;
    introSelect: string;
    introPdfToJpg: string;
    introJpgToPdf: string;
    pdfToJpgTitle: string;
    pdfToJpgBody: string;
    jpgToPdfTitle: string;
    jpgToPdfBody: string;
    back: string;
    choosePdf: string;
    chooseImages: string;
    chooseImagesNote: string;
    addMore: string;
    inOrder: (count: number) => string;
    reading: string;
    convertingPage: (current: number, total: number) => string;
    packing: string;
    preparing: string;
    addingImage: (current: number, total: number) => string;
    saving: string;
    actionToJpg: string;
    actionToPdf: string;
    workingToJpg: string;
    workingToPdf: string;
    zipDoneTitle: (count: number) => string;
    zipDoneBody: (size: string) => string;
    downloadZip: string;
    another: string;
    pdfDoneTitle: string;
    settings: string;
    orientation: string;
    orientationAuto: string;
    orientationPortrait: string;
    orientationLandscape: string;
    margins: string;
    marginNone: string;
    marginSmall: string;
    marginBig: string;
    changeImages: string;
    removeImage: (name: string) => string;
  };
  officeToPdf: {
    heading: string;
    intro: string;
    accepts: string;
    choose: string;
    families: { presentation: string; document: string; spreadsheet: string; drawing: string };
    legacyNote: (extension: string) => string;
    unsupportedTitle: (name: string) => string;
    unsupportedBody: (list: string) => string;
    engineTitle: string;
    engineBody: (size: string) => string;
    enginePrivacy: string;
    engineAction: string;
    engineCached: string;
    action: string;
    reuseNote: string;
    preparing: string;
    unsupportedBrowserTitle: string;
    unsupportedBrowserBody: string;
    downloading: string;
    starting: string;
    converting: (name: string) => string;
    opening: (name: string) => string;
    exporting: (name: string) => string;
    slidesTip: string;
    abandonedTitle: string;
    abandonedBody: string;
    abandonedWhile: (phase: string) => string;
    phases: { opening: string; exporting: string };
    cancelledTitle: string;
    cancelledBody: string;
    doneTitle: string;
    doneBody: (pages: number, size: string) => string;
    another: string;

    // Batch
    chooseMany: string;
    addMore: string;
    removeAll: string;
    queueHeading: (count: number) => string;
    moveEarlier: (name: string) => string;
    moveLater: (name: string) => string;
    remove: (name: string) => string;
    outputHeading: string;
    separateTitle: string;
    separateBody: string;
    combinedTitle: string;
    combinedBody: string;
    slowdownWarning: string;
    convertingItem: (index: number, total: number, name: string) => string;
    combining: string;
    combiningItem: (index: number, total: number, name: string) => string;
    zipping: string;
    cancelledPartial: (converted: number) => string;
    timedOutItem: string;
    zipName: string;
    combinedName: string;
    statusDone: (pages: number) => string;
    statusFailed: string;
    batchDoneTitle: (converted: number, total: number) => string;
    batchDoneZip: (files: number, size: string) => string;
    batchDoneCombined: (pages: number, size: string) => string;
    batchFailures: (names: string) => string;
    batchStopped: (converted: number, size: string) => string;
    batchNoneTitle: string;
    batchNoneBody: string;
    combineSkipped: (names: string) => string;
    downloadZip: string;
  };
  /** Copy shared by the two tools that draw on top of existing pages. */
  stamp: {
    position: string;
    anchors: Record<Anchor, string>;
    margin: string;
    marginNote: string;
    typeface: string;
    fontHelvetica: string;
    fontTimes: string;
    fontCourier: string;
    bold: string;
    italic: string;
    size: string;
    color: string;
    whichPages: string;
    allPages: string;
    somePages: string;
    rangePlaceholder: string;
    rangeHelp: string;
    rangeInvalid: (tokens: string) => string;
    rangeEmpty: string;
    rangeChosen: (count: number, list: string) => string;
    preview: string;
    previewPage: (page: number) => string;
    previewWorking: string;
    previewFailed: string;
    unsupportedCharacter: (character: string) => string;
  };
  watermark: {
    heading: string;
    intro: string;
    choose: string;
    kind: string;
    kindText: string;
    kindImage: string;
    text: string;
    textPlaceholder: string;
    chooseImage: string;
    imageNote: string;
    imageChosen: (name: string) => string;
    changeImage: string;
    imageWidth: string;
    opacity: string;
    tilt: string;
    action: string;
    working: string;
    nothingTitle: string;
    nothingBody: string;
    doneTitle: (pages: number) => string;
    doneBody: string;
    another: string;
  };
  pageNumbers: {
    heading: string;
    intro: string;
    choose: string;
    format: string;
    formatPlain: string;
    formatOfTotal: string;
    /** The word printed between the two numbers, inside the PDF itself. */
    ofWord: string;
    startAt: string;
    startAtNote: string;
    action: string;
    working: string;
    doneTitle: (pages: number) => string;
    doneBody: string;
    another: string;
  };
  errors: {
    encryptedTitle: string;
    encryptedBody: string;
    invalidTitle: string;
    invalidBody: string;
    assetsTitle: string;
    assetsBody: string;
    memoryTitle: string;
    memoryBody: string;
    unknownTitle: string;
    unknownBody: string;
    tooLargeTitle: (name: string) => string;
    tooLargeBody: (limit: string, actual: string) => string;
    tooManyPagesTitle: (what: string) => string;
    tooManyPagesBody: (pages: number, limit: number) => string;
    cancelledTitle: string;
    cancelledBody: string;
    unsupportedImageTitle: (name: string) => string;
    unsupportedImageDecode: string;
    unsupportedImageConvert: string;
    officeFailedTitle: string;
    officeFailedBody: (detail: string) => string;
    limitLabels: {
      ocr: string;
      compression: string;
      previews: string;
      conversion: string;
      office: string;
    };
  };
}

export const es: Dictionary = {
  meta: {
    siteTitle: 'OpenPDF — herramientas de PDF que corren en tu navegador',
    siteDescription:
      'Herramientas de PDF libres y de código abierto. Une, divide, comprime, aplica OCR, edita y rellena formularios sin subir nada: todo corre en tu navegador.',
    titleSuffix: 'gratis, en tu navegador | OpenPDF',
  },
  nav: { switchLanguage: 'Cambiar idioma', github: 'GitHub' },
  common: {
    choosePdf: 'Elegí un archivo PDF',
    orDropIt: 'o soltalo acá',
    orDropThem: 'o soltalos acá',
    removeFile: 'Quitar este archivo',
    download: 'Descargar',
    page: 'página',
    pages: 'páginas',
    field: 'campo',
    fields: 'campos',
    image: 'imagen',
    images: 'imágenes',
    file: 'archivo',
    files: 'archivos',
    saving: 'Guardando…',
    cancel: 'Cancelar',
    dismiss: 'Cerrar',
    keepTabVisible: 'Mantené esta pestaña a la vista — si cambiás de pestaña, el proceso se pausa.',
    processingPaused:
      'El proceso se pausa mientras esta pestaña está en segundo plano. Volvé a ella para que termine.',
  },
  dropzone: {
    notSupported: (names, kind) => `${names} no es un archivo ${kind} admitido.`,
    skipped: (added, kind, rejected) =>
      `Se agregaron ${added} archivo${added === 1 ? '' : 's'} ${kind}; se descartó${rejected === 1 ? '' : 'aron'} ${rejected} que no ${rejected === 1 ? 'era' : 'eran'} compatible${rejected === 1 ? '' : 's'}.`,
    kindPdf: 'PDF',
    kindImage: 'de imagen',
    kindOffice: 'de Office',
  },
  home: {
    badge: 'Libre y de código abierto',
    headingLine1: 'Herramientas de PDF,',
    headingLine2: 'dentro de tu navegador',
    intro:
      'Tus archivos no salen de tu dispositivo. No hay subida, ni servidor al que subirlos: todo corre en la página que estás leyendo.',
    searchPlaceholder: 'Buscar herramientas…',
    searchLabel: 'Buscar herramientas',
    noMatches: (query) => `No hay nada que coincida con «${query}».`,
    clearSearch: 'Limpiar la búsqueda',
    private: 'Privado',
    fast: 'Rápido',
    openSource: 'Código abierto',
    whyTitle: '¿Por qué OpenPDF?',
    whyBody:
      'La mayoría de las herramientas de PDF en línea te piden subir el documento al servidor de otra persona. OpenPDF no tiene servidor al que subirlo: la aplicación entera son archivos estáticos, y el motor de PDF corre en tu navegador. Nada de lo que abras acá se transmite a ningún lado.',
    footer: 'OpenPDF — libre y de código abierto.',
    readCode: 'Ver el código',
  },
  structures: {
    form: 'los campos de formulario',
    bookmarks: 'los marcadores',
    attachments: 'los archivos adjuntos',
    pageLabels: 'las etiquetas de página',
    layers: 'las capas',
    accessibility: 'la estructura de accesibilidad',
    metadataTitle: 'el título del documento',
    language: 'el idioma del documento',
  },
  notFound: {
    title: 'Esa página no existe',
    body: 'Puede que el enlace esté desactualizado, o que la dirección tenga algún error. Acá está lo que busca la mayoría.',
    seeAll: 'Ver todas las herramientas',
  },
  tools: {
    compress: {
      title: 'Comprimir PDF',
      navLabel: 'Comprimir',
      tagline: 'Achicá un PDF reconvirtiendo sus páginas.',
      description:
        'Reducí el tamaño de un PDF en tu navegador. Elegí cuánto comprimir y mirá el resultado antes de descargar nada.',
      keywords: ['reducir', 'tamaño', 'achicar', 'peso', 'optimizar', 'comprimir'],
    },
    ocr: {
      title: 'OCR de PDF',
      navLabel: 'OCR',
      tagline: 'Leé el texto de un escaneo y hacelo buscable.',
      description:
        'Reconocé el texto de un PDF escaneado y obtené una copia que podés buscar y seleccionar, más el texto plano. Todo en tu dispositivo.',
      keywords: ['escaneo', 'escaneado', 'reconocer', 'buscable', 'texto', 'ocr'],
    },
    merge: {
      title: 'Unir PDF',
      navLabel: 'Unir',
      tagline: 'Combiná varios PDF en un solo documento.',
      description:
        'Juntá varios archivos PDF en un solo documento, en el orden que elijas, sin subir nada.',
      keywords: ['combinar', 'juntar', 'unir', 'fusionar', 'concatenar'],
    },
    split: {
      title: 'Dividir PDF',
      navLabel: 'Dividir',
      tagline: 'Sacá páginas, o separá cada una por su lado.',
      description:
        'Extraé un rango de páginas de un PDF, o separá cada página en su propio archivo, directamente en tu navegador.',
      keywords: ['extraer', 'páginas', 'rango', 'separar', 'dividir', 'partir'],
    },
    organize: {
      title: 'Organizar PDF',
      navLabel: 'Organizar',
      tagline: 'Reordená, rotá y eliminá páginas.',
      description:
        'Reacomodá las páginas de un PDF, rotalas y sacá las que no necesitás, con una vista previa de cada una.',
      keywords: ['reordenar', 'rotar', 'eliminar', 'reacomodar', 'ordenar', 'girar'],
    },
    'pdf-to-word': {
      title: 'PDF a Word',
      navLabel: 'PDF a Word',
      tagline: 'Extraé el texto a un .docx editable.',
      description:
        'Convertí el texto de un PDF en un documento de Word editable. Sólo texto: no conserva imágenes, tablas ni maquetación.',
      keywords: ['docx', 'word', 'convertir', 'texto', 'editable'],
    },
    edit: {
      title: 'Editar PDF',
      navLabel: 'Editar',
      tagline: 'Agregá texto en cualquier parte de una página.',
      description:
        'Colocá texto en cualquier página de un PDF y guardá una copia nueva, con la página a la vista mientras trabajás.',
      keywords: ['anotar', 'texto', 'escribir', 'agregar', 'firmar', 'editar'],
    },
    'fill-form': {
      title: 'Rellenar formulario',
      navLabel: 'Formularios',
      tagline: 'Completá un formulario PDF interactivo.',
      description:
        'Completá los campos interactivos de un formulario PDF y descargá el documento terminado, sin mandarlo a ningún lado.',
      keywords: ['formulario', 'campos', 'completar', 'acroform', 'rellenar'],
    },
    'office-to-pdf': {
      title: 'PPT y Word a PDF',
      navLabel: 'Office',
      tagline: 'Convertí presentaciones y documentos a PDF.',
      description:
        'Convertí PowerPoint, Word, Excel y sus equivalentes libres a PDF con la fidelidad de LibreOffice, sin subir el archivo a ningún lado.',
      keywords: [
        'ppt', 'pptx', 'powerpoint', 'presentacion', 'presentación', 'diapositivas',
        'word', 'docx', 'documento', 'excel', 'xlsx', 'planilla',
        'odp', 'odt', 'ods', 'libreoffice', 'office', 'convertir',
      ],
    },
    'image-pdf': {
      title: 'Imágenes y PDF',
      navLabel: 'Imágenes',
      tagline: 'Pasá páginas a JPG, o imágenes a PDF.',
      description:
        'Convertí cada página de un PDF en una imagen JPG, o combiná imágenes JPG, PNG y WebP en un solo PDF.',
      keywords: ['jpg', 'jpeg', 'png', 'webp', 'imagen', 'foto', 'convertir'],
    },
    watermark: {
      title: 'Marca de agua en PDF',
      navLabel: 'Marca de agua',
      tagline: 'Poné un texto o un logo encima de cada página.',
      description:
        'Agregá una marca de agua de texto o imagen a un PDF, eligiendo opacidad, inclinación, posición y en qué páginas. Todo en tu navegador.',
      keywords: ['marca', 'agua', 'watermark', 'logo', 'sello', 'borrador', 'confidencial'],
    },
    'page-numbers': {
      title: 'Numerar páginas de un PDF',
      navLabel: 'Numerar',
      tagline: 'Poné números de página donde los necesites.',
      description:
        'Numerá las páginas de un PDF eligiendo posición, desde qué número empezar y el formato. Funciona también en páginas rotadas. Todo en tu navegador.',
      keywords: ['numerar', 'números', 'página', 'foliar', 'paginación', 'numeración'],
    },
  },
  compress: {
    heading: 'Comprimir PDF',
    intro:
      'Achicá un PDF reconvirtiendo cada página a imagen. Funciona mejor con escaneos y documentos con muchas fotos.',
    badge: 'Todo corre en tu navegador',
    chooseLevel: '¿Cuánto querés comprimir?',
    presets: {
      extreme: {
        title: 'Lo más chico',
        description: 'La menor calidad. Útil cuando el tamaño importa más que el detalle.',
      },
      recommended: {
        title: 'Equilibrado',
        description: 'Buena calidad con un tamaño bastante menor.',
      },
      low: {
        title: 'Mejor calidad',
        description: 'Pérdida casi imperceptible, ahorro más modesto.',
      },
    },
    recommendedBadge: 'Recomendado',
    textWarningTitle: 'Este documento tiene texto real.',
    textWarningBody:
      'La compresión convierte cada página en una imagen, así que el texto deja de poder seleccionarse y buscarse — y las páginas de texto suelen quedar más grandes como imágenes. Vas a ver el tamaño final antes de descargar nada.',
    action: 'Comprimir PDF',
    working: 'Comprimiendo…',
    reading: 'Leyendo el documento…',
    compressingPage: (current, total) => `Comprimiendo la página ${current} de ${total}…`,
    saving: 'Guardando…',
    doneTitle: 'Comprimido',
    grewTitle: 'Acá comprimir no ayuda',
    doneBody: (pages) =>
      `${pages} ${pages === 1 ? 'página reconvertida' : 'páginas reconvertidas'}. El texto de esas páginas ahora es parte de la imagen.`,
    grewBody:
      'La copia rasterizada no quedó más chica que el original, que es lo que suele pasar con documentos de texto. Quedate con tu original: pesa menos y su texto se sigue pudiendo seleccionar.',
    original: 'Original',
    compressed: 'Comprimido',
    saved: 'Ahorro',
    savedNothing: 'ninguno',
    downloadAnyway: 'Descargarlo igual',
    another: 'Comprimir otro',
  },
  ocr: {
    heading: 'OCR de PDF',
    intro:
      'Leé el texto de un PDF escaneado y obtené una copia que podés buscar y seleccionar. Todo corre en tu dispositivo.',
    step1: '1. Elegí un PDF',
    step2: '2. Elegí el idioma del documento',
    upTo: (pages) => `Hasta ${pages} páginas`,
    chooseAnother: 'Tocá para elegir otro archivo',
    languages: {
      spa: 'Español',
      eng: 'Inglés',
      fra: 'Francés',
      deu: 'Alemán',
      ita: 'Italiano',
      por: 'Portugués',
    },
    action: 'Empezar el OCR',
    working: 'Leyendo…',
    starting: 'Iniciando el motor de OCR…',
    reading: 'Leyendo el documento…',
    readingPage: (current, total) => `Leyendo la página ${current} de ${total}…`,
    assembling: 'Armando el PDF buscable…',
    noTextTitle: 'No se reconoció ningún texto',
    noTextBody:
      'Las páginas volvieron vacías. Fijate que el idioma elegido coincida con el del documento, y que el escaneo esté derecho y sea legible.',
    doneTitle: (words) => `Se reconocieron ${words.toLocaleString('es')} palabras`,
    doneBody: (pages) =>
      `En ${pages} ${pages === 1 ? 'página' : 'páginas'}. El PDF de abajo lleva una capa de texto invisible, así que podés buscarlo y seleccionarlo.`,
    searchablePdf: 'PDF buscable',
    searchablePdfNote: 'El escaneo, más el texto seleccionable',
    plainText: 'Texto plano',
    plainTextNote: 'Sólo las palabras, en .txt',
    recognisedText: 'Texto reconocido',
    copy: 'Copiar',
    copied: 'Copiado',
    copyFailedTitle: 'No se pudo copiar al portapapeles',
    copyFailedBody: 'Tu navegador bloqueó el acceso al portapapeles. Usá la descarga en .txt.',
    another: 'Leer otro documento',
  },
  merge: {
    heading: 'Unir archivos PDF',
    intro: 'Combiná varios PDF en uno solo, en el orden que elijas.',
    choose: 'Elegí archivos PDF',
    listHeading: (count) =>
      `${count} ${count === 1 ? 'archivo' : 'archivos'}, se unen de arriba hacia abajo`,
    removeAll: 'Quitar todos',
    adding: (name) => `Agregando ${name}…`,
    saving: 'Guardando…',
    action: 'Unir PDF',
    working: 'Uniendo…',
    needTwo: 'Agregá al menos dos archivos.',
    moveEarlier: (name) => `Mover ${name} antes`,
    moveLater: (name) => `Mover ${name} después`,
    remove: (name) => `Quitar ${name}`,
    doneTitle: (pages) => `${pages} ${pages === 1 ? 'página' : 'páginas'} en un solo documento`,
    lostNote: (list) =>
      `Los archivos originales tenían ${list}. Al combinarlos en un documento nuevo, eso no se conserva: quedan las páginas, no lo demás.`,
    another: 'Unir más archivos',
  },
  split: {
    heading: 'Dividir un PDF',
    intro: 'Sacá las páginas que necesitás, o separá cada página por su lado.',
    rangeLabel: 'Páginas a conservar',
    eachPage: 'Un archivo por página',
    placeholder: 'ej. 1-3, 5, 12-9',
    action: 'Extraer páginas',
    working: 'Dividiendo…',
    eachPageNote: (pages) =>
      `Cada una de las ${pages} páginas se convierte en su propio PDF, dentro de un ZIP.`,
    syntaxNote:
      'Separá con comas. Los rangos pueden ir al revés («12-9»), y un extremo abierto llega hasta el borde del documento («5-»).',
    selected: (count, summary) =>
      `${count} ${count === 1 ? 'página seleccionada' : 'páginas seleccionadas'}: ${summary}`,
    invalid: (tokens, pages) =>
      `No se pudo leer ${tokens} — este documento tiene páginas de la 1 a la ${pages}.`,
    noneTitle: 'No hay páginas seleccionadas',
    noneBody: (pages) => `Escribí números de página entre 1 y ${pages}, por ejemplo «1-3, 7».`,
    extracting: 'Extrayendo páginas…',
    extractingPage: (current, total) => `Extrayendo la página ${current} de ${total}…`,
    packing: 'Armando el ZIP…',
    doneZip: (files) => `${files} PDF listos`,
    doneSingle: (pages) => `${pages} ${pages === 1 ? 'página extraída' : 'páginas extraídas'}`,
    doneBody: 'Tu descarga está lista.',
    downloadZip: 'Descargar ZIP',
    downloadPdf: 'Descargar PDF',
    another: 'Dividir otro archivo',
  },
  organize: {
    heading: 'Organizar las páginas de un PDF',
    intro: 'Reordená, rotá y eliminá páginas, y guardá el resultado como un documento nuevo.',
    preparing: 'Preparando las vistas previas…',
    renderingPage: (current, total) => `Dibujando la página ${current} de ${total}…`,
    pageLabel: (n) => `Página ${n}`,
    moveEarlier: (n) => `Mover la página ${n} antes`,
    moveLater: (n) => `Mover la página ${n} después`,
    rotate: (n) => `Rotar la página ${n}`,
    remove: (n) => `Quitar la página ${n}`,
    hint: 'Arrastrá una página para moverla, o usá las flechas debajo de cada vista previa.',
    action: 'Guardar PDF',
    doneTitle: (pages) => `${pages} ${pages === 1 ? 'página' : 'páginas'}, en tu orden`,
    doneBody: 'Tu documento actualizado está listo.',
    keptNote: (list) => `Se conservaron ${list}.`,
    lostNote: (list) =>
      `Atención: el documento producido perdió ${list}. Si los necesitás, conservá el original.`,
    another: 'Organizar otro archivo',
  },
  pdfToWord: {
    heading: 'PDF a Word',
    intro:
      'Sacá el texto de un PDF a un .docx editable. Sólo texto: las imágenes, las tablas y la maquetación no se conservan.',
    reading: 'Leyendo el documento…',
    extractingPage: (current, total) => `Extrayendo la página ${current} de ${total}…`,
    building: 'Armando el documento de Word…',
    noTextTitle: 'Este PDF no tiene texto que extraer',
    noTextBody:
      'Lo más probable es que sea un escaneo: una foto de una página, no texto. Pasalo primero por OCR de PDF y después convertí la copia buscable.',
    action: 'Convertir a Word',
    working: 'Convirtiendo…',
    doneTitle: 'Tu documento de Word está listo',
    doneBody: (paragraphs, pages) =>
      `${paragraphs.toLocaleString('es')} ${paragraphs === 1 ? 'párrafo' : 'párrafos'} de ${pages} ${pages === 1 ? 'página' : 'páginas'}.`,
    downloadDocx: 'Descargar .docx',
    another: 'Convertir otro',
  },
  edit: {
    heading: 'Editar PDF',
    intro: 'Agregá texto en cualquier parte de una página y guardá una copia nueva.',
    choose: 'Elegí un archivo PDF',
    addText: 'Agregar texto',
    placing: 'Tocá la página…',
    hint: 'Hacé clic en cualquier parte de la página para poner ahí un cuadro de texto.',
    annotationLabel: 'Texto de la anotación',
    removeAnnotation: 'Quitar esta anotación',
    previous: 'Anterior',
    next: 'Siguiente',
    pageOf: (current, total) => `Página ${current} de ${total}`,
    nothingTitle: 'Todavía no hay nada para guardar',
    nothingBody: 'Escribí algo en al menos uno de los cuadros que colocaste, y después guardá.',
    action: 'Guardar PDF',
    doneTitle: 'Tu PDF editado está listo',
    doneBody: (boxes) =>
      `Se ${boxes === 1 ? 'agregó 1 cuadro de texto' : `agregaron ${boxes} cuadros de texto`}.`,
    keepEditing: 'Seguir editando',
  },
  fillForm: {
    heading: 'Rellenar un formulario PDF',
    intro: 'Completá los campos interactivos de un formulario PDF, acá mismo en tu dispositivo.',
    choose: 'Elegí un formulario PDF',
    chooseNote: 'Un PDF con campos rellenables',
    looking: 'Buscando campos de formulario…',
    noFieldsTitle: 'Este PDF no tiene campos de formulario interactivos.',
    noFieldsBody:
      'Los formularios pensados para imprimir y completar a mano no tienen campos que rellenar. Usá Editar PDF para poner texto sobre la página.',
    sectionTitle: 'Campos del formulario',
    checked: 'Marcado',
    unchecked: 'Sin marcar',
    leaveEmpty: 'Dejar vacío',
    action: 'Rellenar el formulario',
    working: 'Rellenando…',
    doneTitle: (filled, total) =>
      `Se completaron ${filled} de ${total} ${total === 1 ? 'campo' : 'campos'}`,
    doneBody: 'Tu formulario completado está listo.',
    skippedNote: (names) =>
      `Estos campos no se pudieron escribir y quedaron como estaban: ${names}. Puede que sean de sólo lectura, o que tengan caracteres que la fuente del formulario no puede mostrar.`,
    keepEditing: 'Seguir editando',
  },
  imagePdf: {
    heading: 'Imágenes y PDF',
    badge: 'Todo corre en tu navegador',
    introSelect: 'Elegí una dirección. Las dos corren en tu dispositivo.',
    introPdfToJpg: 'Convertí cada página de un PDF en una imagen JPG.',
    introJpgToPdf: 'Combiná varias imágenes en un solo PDF.',
    pdfToJpgTitle: 'PDF a JPG',
    pdfToJpgBody: 'Convertí cada página de un PDF en una imagen JPG de buena calidad, en un ZIP.',
    jpgToPdfTitle: 'Imágenes a PDF',
    jpgToPdfBody:
      'Combiná imágenes JPG, PNG o WebP en un solo PDF. Elegí la orientación y los márgenes.',
    back: 'Volver al selector',
    choosePdf: 'Elegí un PDF',
    chooseImages: 'Elegí imágenes',
    chooseImagesNote: 'JPG, PNG y WebP. Podés soltar varias a la vez.',
    addMore: 'Agregar más',
    inOrder: (count) =>
      `${count} ${count === 1 ? 'imagen' : 'imágenes'}, en el orden que se ven.`,
    reading: 'Leyendo el documento…',
    convertingPage: (current, total) => `Convirtiendo la página ${current} de ${total}…`,
    packing: 'Armando el ZIP…',
    preparing: 'Preparando el PDF…',
    addingImage: (current, total) => `Agregando la imagen ${current} de ${total}…`,
    saving: 'Guardando…',
    actionToJpg: 'Convertir a JPG',
    actionToPdf: 'Crear PDF',
    workingToJpg: 'Convirtiendo…',
    workingToPdf: 'Creando…',
    zipDoneTitle: (count) => `${count} ${count === 1 ? 'imagen lista' : 'imágenes listas'}`,
    zipDoneBody: (size) => `${size} en un solo ZIP.`,
    downloadZip: 'Descargar ZIP',
    another: 'Convertir otro',
    pdfDoneTitle: 'Tu PDF está listo',
    settings: 'Configuración de página',
    orientation: 'Orientación',
    orientationAuto: 'Según cada imagen',
    orientationPortrait: 'Vertical',
    orientationLandscape: 'Horizontal',
    margins: 'Márgenes',
    marginNone: 'Sin margen',
    marginSmall: 'Margen chico',
    marginBig: 'Margen grande',
    changeImages: 'Cambiar las imágenes',
    removeImage: (name) => `Quitar ${name}`,
  },
  officeToPdf: {
    heading: 'PPT y Word a PDF',
    intro:
      'Convertí presentaciones y documentos a PDF con el motor de LibreOffice, que corre entero dentro de tu navegador.',
    accepts: 'PowerPoint, Word, Excel y sus equivalentes de LibreOffice.',
    choose: 'Elegí un documento',
    families: {
      presentation: 'Presentación',
      document: 'Documento',
      spreadsheet: 'Planilla',
      drawing: 'Dibujo',
    },
    legacyNote: (extension) =>
      `${extension} es un formato viejo. Se convierte igual, pero si el resultado no te convence, abrilo y volvé a guardarlo en el formato nuevo.`,
    unsupportedTitle: (name) => `No se puede convertir ${name}`,
    unsupportedBody: (list) => `Los formatos admitidos son: ${list}.`,
    engineTitle: 'Hace falta descargar el motor de conversión',
    engineBody: (size) =>
      `Son unos ${size}, una sola vez. Es LibreOffice completo: por eso el PDF sale igual que si lo exportaras desde tu computadora, con los gráficos y las tablas de verdad y no como capturas.`,
    enginePrivacy:
      'Se descarga desde este mismo sitio y corre en tu navegador. Tu documento no se envía a ningún servidor, ni siquiera al nuestro.',
    engineAction: 'Descargar el motor y convertir',
    engineCached: 'El motor ya está cargado.',
    action: 'Convertir a PDF',
    reuseNote:
      'El motor sigue cargado, así que esta conversión arranca enseguida. Si convertís varios archivos seguidos se va poniendo más lento: recargá la página para empezar de cero.',
    preparing: 'Preparando el conversor…',
    unsupportedBrowserTitle: 'Tu navegador no puede ejecutar el motor',
    unsupportedBrowserBody:
      'La conversión necesita funciones que este navegador no habilita. Probá con una versión reciente de Chrome, Edge o Firefox de escritorio.',
    downloading: 'Descargando el motor…',
    starting: 'Iniciando LibreOffice…',
    converting: (name) => `Convirtiendo ${name}…`,
    opening: (name) => `Abriendo ${name}…`,
    exporting: (name) => `Exportando ${name} a PDF…`,
    slidesTip:
      '¿Tenés una presentación en Google Slides? No hace falta pasar por acá: en Slides andá a Archivo → Descargar → Documento PDF.',
    abandonedTitle: 'La conversión tardó demasiado y se abandonó',
    abandonedBody:
      'Recargá la página y probá de nuevo: el motor se vuelve más lento cuanto más se usa, y a veces alcanza con empezar de cero. Si vuelve a pasar, suele destrabarse abriendo el archivo en PowerPoint y volviéndolo a guardar.',
    abandonedWhile: (phase) => `Se quedó en la etapa de ${phase}.`,
    phases: { opening: 'abrir el archivo', exporting: 'exportar a PDF' },
    cancelledTitle: 'Conversión cancelada',
    cancelledBody: 'Podés volver a intentarlo cuando quieras; el motor ya está descargado.',
    doneTitle: 'Tu PDF está listo',
    doneBody: (pages, size) =>
      `${pages} ${pages === 1 ? 'página' : 'páginas'} · ${size}. El texto quedó seleccionable y se puede buscar.`,
    another: 'Convertir otro',

    chooseMany: 'Elegí uno o varios documentos',
    addMore: 'Agregar más',
    removeAll: 'Quitar todos',
    queueHeading: (count) =>
      count === 1
        ? '1 documento'
        : `${count} documentos, se convierten en este orden`,
    moveEarlier: (name) => `Mover ${name} antes`,
    moveLater: (name) => `Mover ${name} después`,
    remove: (name) => `Quitar ${name}`,
    outputHeading: '¿Cómo querés el resultado?',
    separateTitle: 'Un PDF por documento',
    separateBody:
      'Cada uno con el nombre de su archivo. Si hay más de uno se descargan juntos en un ZIP.',
    combinedTitle: 'Todo en un solo PDF',
    combinedBody:
      'Se unen en el orden de la lista. Unir lleva su tiempo: con varias presentaciones largas puede tardar más que la propia conversión.',
    slowdownWarning:
      'El motor se pone más lento a medida que convierte: el último archivo de una lista larga puede tardar bastante más que el primero. Si alguno se traba, se salta y los demás siguen.',
    convertingItem: (index, total, name) => `Convirtiendo ${index} de ${total}: ${name}`,
    combining: 'Uniendo los PDF…',
    combiningItem: (index, total, name) => `Uniendo ${index} de ${total}: ${name}`,
    zipping: 'Armando el ZIP…',
    cancelledPartial: (converted) =>
      converted === 0
        ? 'Cancelaste antes de que se convirtiera ningún documento.'
        : `Cancelaste después de convertir ${converted} ${converted === 1 ? 'documento' : 'documentos'}; se descartaron.`,
    timedOutItem: 'Tardó demasiado y se salteó',
    zipName: 'documentos.zip',
    combinedName: 'documentos.pdf',
    statusDone: (pages) => `${pages} ${pages === 1 ? 'página' : 'páginas'}`,
    statusFailed: 'No se pudo',
    batchDoneTitle: (converted, total) =>
      converted === total
        ? total === 1
          ? 'Se convirtió el documento'
          : `Se convirtieron los ${total} documentos`
        : converted === 1
          ? `Se convirtió 1 de ${total} documentos`
          : `Se convirtieron ${converted} de ${total} documentos`,
    batchDoneZip: (files, size) => `${files} PDF en un ZIP · ${size}.`,
    batchDoneCombined: (pages, size) =>
      `${pages} ${pages === 1 ? 'página' : 'páginas'} en un solo PDF · ${size}.`,
    batchFailures: (names) => `No se pudieron convertir: ${names}.`,
    batchStopped: (converted, size) =>
      `Se paró después de ${converted} ${converted === 1 ? 'documento' : 'documentos'} (${size}) para no quedarse sin memoria. Abajo está lo convertido; el resto conviene hacerlo en otra tanda.`,
    batchNoneTitle: 'No se pudo convertir ninguno',
    batchNoneBody:
      'Ningún documento de la lista llegó a convertirse. Recargá la página y probá de a uno para ver cuál da problema.',
    combineSkipped: (names) => `Quedaron fuera del PDF combinado: ${names}.`,
    downloadZip: 'Descargar ZIP',
  },
  stamp: {
    position: 'Posición',
    anchors: {
      'top-left': 'Arriba a la izquierda',
      'top-center': 'Arriba al centro',
      'top-right': 'Arriba a la derecha',
      'middle-left': 'Al medio, a la izquierda',
      center: 'Al centro',
      'middle-right': 'Al medio, a la derecha',
      'bottom-left': 'Abajo a la izquierda',
      'bottom-center': 'Abajo al centro',
      'bottom-right': 'Abajo a la derecha',
    },
    margin: 'Margen',
    marginNote: 'Distancia al borde, en puntos.',
    typeface: 'Tipografía',
    fontHelvetica: 'Helvetica',
    fontTimes: 'Times',
    fontCourier: 'Courier',
    bold: 'Negrita',
    italic: 'Cursiva',
    size: 'Tamaño',
    color: 'Color',
    whichPages: 'Páginas',
    allPages: 'Todas',
    somePages: 'Algunas',
    rangePlaceholder: '1-3, 7, 12-',
    rangeHelp: 'Números y rangos separados por comas. «12-» significa de la 12 al final.',
    rangeInvalid: (tokens) => `No entendí esto: ${tokens}.`,
    rangeEmpty: 'Elegí al menos una página.',
    rangeChosen: (count, list) =>
      `${count} ${count === 1 ? 'página' : 'páginas'}: ${list}`,
    preview: 'Vista previa',
    previewPage: (page) => `Página ${page}, con la marca aplicada de verdad`,
    previewWorking: 'Armando la vista previa…',
    previewFailed: 'No se pudo armar la vista previa, pero podés aplicar igual.',
    unsupportedCharacter: (character) =>
      `Esta tipografía no puede dibujar «${character}». Las tipografías estándar de PDF cubren el español pero no todos los alfabetos.`,
  },
  watermark: {
    heading: 'Marca de agua',
    intro: 'Poné un texto o una imagen encima de las páginas que elijas.',
    choose: 'Elegí un PDF',
    kind: 'Qué poner',
    kindText: 'Texto',
    kindImage: 'Imagen',
    text: 'Texto',
    textPlaceholder: 'BORRADOR',
    chooseImage: 'Elegí una imagen',
    imageNote: 'PNG o JPG. Un PNG con fondo transparente queda mejor.',
    imageChosen: (name) => `Imagen: ${name}`,
    changeImage: 'Cambiar imagen',
    imageWidth: 'Ancho',
    opacity: 'Opacidad',
    tilt: 'Inclinación',
    action: 'Aplicar marca de agua',
    working: 'Aplicando…',
    nothingTitle: 'Falta qué poner',
    nothingBody: 'Escribí un texto o elegí una imagen antes de aplicar.',
    doneTitle: (pages) => `Marca aplicada en ${pages} ${pages === 1 ? 'página' : 'páginas'}`,
    doneBody: 'Tu documento con la marca de agua está listo.',
    another: 'Marcar otro',
  },
  pageNumbers: {
    heading: 'Numerar páginas',
    intro: 'Poné números de página donde los necesites, con el formato que quieras.',
    choose: 'Elegí un PDF',
    format: 'Formato',
    formatPlain: 'Solo el número',
    formatOfTotal: 'Número y total',
    ofWord: 'de',
    startAt: 'Empezar en',
    startAtNote: 'El número que lleva la primera página numerada.',
    action: 'Numerar páginas',
    working: 'Numerando…',
    doneTitle: (pages) => `${pages} ${pages === 1 ? 'página numerada' : 'páginas numeradas'}`,
    doneBody: 'Tu documento numerado está listo.',
    another: 'Numerar otro',
  },
  errors: {
    encryptedTitle: 'Este PDF está protegido con contraseña',
    encryptedBody:
      'OpenPDF no puede abrir documentos cifrados. Quitá la contraseña desde tu lector de PDF, guardá una copia y volvé a intentar.',
    invalidTitle: 'Este archivo no es un PDF legible',
    invalidBody:
      'Puede estar dañado, incompleto, o guardado en otro formato con nombre .pdf. Probá exportarlo de nuevo desde el programa que lo creó.',
    assetsTitle: 'No se pudo cargar el motor de PDF',
    assetsBody:
      'Falló la carga del código de procesamiento. Revisá tu conexión y recargá la página — una vez cargado, todo corre localmente.',
    memoryTitle: 'El navegador se quedó sin memoria',
    memoryBody:
      'Este documento es demasiado grande para procesarlo de una vez. Dividilo en partes más chicas y volvé a intentar.',
    unknownTitle: 'Algo salió mal',
    unknownBody: 'No hay más detalle disponible. La consola del navegador puede tener más datos.',
    tooLargeTitle: (name) => `${name} es demasiado grande`,
    tooLargeBody: (limit, actual) =>
      `Esta herramienta trabaja con archivos de hasta ${limit}; este pesa ${actual}. Dividilo en documentos más chicos y volvé a intentar.`,
    tooManyPagesTitle: (what) => `Este documento tiene demasiadas páginas para ${what}`,
    tooManyPagesBody: (pages, limit) =>
      `${pages} páginas superan el límite de ${limit}. Usá Dividir PDF para partirlo primero.`,
    cancelledTitle: 'Cancelado',
    cancelledBody: 'La operación se detuvo antes de terminar.',
    unsupportedImageTitle: (name) => `No se pudo procesar ${name}`,
    unsupportedImageDecode:
      'Este navegador no pudo decodificar la imagen. Guardala como JPG o PNG y volvé a intentar.',
    unsupportedImageConvert: 'El navegador no pudo convertir la imagen.',
    officeFailedTitle: 'LibreOffice no pudo convertir este documento',
    officeFailedBody: (detail) =>
      `El motor devolvió: ${detail}. Si el archivo se abre bien en tu computadora, probá volver a guardarlo antes de convertirlo.`,
    limitLabels: {
      ocr: 'el OCR',
      compression: 'la compresión',
      previews: 'las vistas previas',
      conversion: 'esta conversión',
      office: 'la conversión a PDF',
    },
  },
};

export const en: Dictionary = {
  meta: {
    siteTitle: 'OpenPDF — PDF tools that run in your browser',
    siteDescription:
      'Free, open-source PDF tools. Merge, split, compress, OCR, edit and fill PDF forms without uploading anything: every tool runs in your browser.',
    titleSuffix: 'free, in your browser | OpenPDF',
  },
  nav: { switchLanguage: 'Change language', github: 'GitHub' },
  common: {
    choosePdf: 'Choose a PDF file',
    orDropIt: 'or drop one here',
    orDropThem: 'or drop them here',
    removeFile: 'Remove this file',
    download: 'Download',
    page: 'page',
    pages: 'pages',
    field: 'field',
    fields: 'fields',
    image: 'image',
    images: 'images',
    file: 'file',
    files: 'files',
    saving: 'Saving…',
    cancel: 'Cancel',
    dismiss: 'Dismiss',
    keepTabVisible: 'Keep this tab visible — switching away pauses processing.',
    processingPaused:
      'Processing pauses while this tab is in the background. Keep it visible to finish.',
  },
  dropzone: {
    notSupported: (names, kind) => `${names} is not a supported ${kind} file.`,
    skipped: (added, kind, rejected) =>
      `Added ${added} ${kind} file${added === 1 ? '' : 's'}; skipped ${rejected} that ${rejected === 1 ? 'was' : 'were'} not supported.`,
    kindPdf: 'PDF',
    kindImage: 'image',
    kindOffice: 'Office',
  },
  home: {
    badge: 'Free and open source',
    headingLine1: 'PDF tools,',
    headingLine2: 'right in your browser',
    intro:
      'Your files never leave your device. There is no upload, and no server to upload to — every tool here runs in the page you are reading.',
    searchPlaceholder: 'Search tools…',
    searchLabel: 'Search tools',
    noMatches: (query) => `Nothing matches “${query}”.`,
    clearSearch: 'Clear the search',
    private: 'Private',
    fast: 'Fast',
    openSource: 'Open source',
    whyTitle: 'Why OpenPDF?',
    whyBody:
      'Most online PDF tools ask you to upload your document to someone else’s server. OpenPDF has no server to upload to: the whole application is static files, and the PDF engine runs in your browser. Nothing you open here is transmitted anywhere.',
    footer: 'OpenPDF — free and open source.',
    readCode: 'Read the code',
  },
  structures: {
    form: 'the form fields',
    bookmarks: 'the bookmarks',
    attachments: 'the attached files',
    pageLabels: 'the page labels',
    layers: 'the layers',
    accessibility: 'the accessibility structure',
    metadataTitle: 'the document title',
    language: 'the document language',
  },
  notFound: {
    title: 'That page does not exist',
    body: 'The link may be out of date, or the address slightly off. Here is where most people were heading.',
    seeAll: 'See all tools',
  },
  tools: {
    compress: {
      title: 'Compress PDF',
      navLabel: 'Compress',
      tagline: 'Make a PDF smaller by re-encoding its pages.',
      description:
        'Reduce the size of a PDF in your browser. Choose how hard to compress, and see the result before you download anything.',
      keywords: ['reduce', 'size', 'smaller', 'shrink', 'optimise'],
    },
    ocr: {
      title: 'OCR PDF',
      navLabel: 'OCR',
      tagline: 'Read the text off a scan and make it searchable.',
      description:
        'Recognise the text in a scanned PDF and get back a copy you can search and select, plus the plain text. Runs entirely on your device.',
      keywords: ['scan', 'scanned', 'recognise', 'recognize', 'searchable', 'text'],
    },
    merge: {
      title: 'Merge PDF',
      navLabel: 'Merge',
      tagline: 'Combine several PDFs into one document.',
      description:
        'Join several PDF files into a single document, in the order you choose, without uploading anything.',
      keywords: ['combine', 'join', 'append', 'concatenate'],
    },
    split: {
      title: 'Split PDF',
      navLabel: 'Split',
      tagline: 'Pull out pages, or break every page apart.',
      description:
        'Extract a range of pages from a PDF, or split every page into its own file, directly in your browser.',
      keywords: ['extract', 'pages', 'range', 'separate', 'divide'],
    },
    organize: {
      title: 'Organize PDF',
      navLabel: 'Organize',
      tagline: 'Reorder, rotate and remove pages.',
      description:
        'Rearrange the pages of a PDF, rotate them, and drop the ones you do not need — with a preview of every page.',
      keywords: ['reorder', 'rotate', 'delete', 'rearrange', 'sort'],
    },
    'pdf-to-word': {
      title: 'PDF to Word',
      navLabel: 'PDF to Word',
      tagline: 'Extract the text into an editable .docx.',
      description:
        'Turn the text of a PDF into an editable Word document. Text only — images, tables and layout are not carried over.',
      keywords: ['docx', 'word', 'convert', 'text', 'editable'],
    },
    edit: {
      title: 'Edit PDF',
      navLabel: 'Edit',
      tagline: 'Add text anywhere on a page.',
      description:
        'Place text on any page of a PDF and save a new copy, with the page in front of you as you work.',
      keywords: ['annotate', 'text', 'write', 'add', 'sign'],
    },
    'fill-form': {
      title: 'Fill Form',
      navLabel: 'Fill Form',
      tagline: 'Complete an interactive PDF form.',
      description:
        'Fill in the interactive fields of a PDF form and download the completed document, without sending it anywhere.',
      keywords: ['form', 'fields', 'complete', 'acroform', 'input'],
    },
    'office-to-pdf': {
      title: 'PPT and Word to PDF',
      navLabel: 'Office',
      tagline: 'Convert presentations and documents to PDF.',
      description:
        'Convert PowerPoint, Word, Excel and their open equivalents to PDF with LibreOffice fidelity, without uploading the file anywhere.',
      keywords: [
        'ppt', 'pptx', 'powerpoint', 'presentation', 'slides', 'deck',
        'word', 'docx', 'document', 'excel', 'xlsx', 'spreadsheet',
        'odp', 'odt', 'ods', 'libreoffice', 'office', 'convert',
      ],
    },
    'image-pdf': {
      title: 'Images & PDF',
      navLabel: 'Images',
      tagline: 'Convert pages to JPG, or images to a PDF.',
      description:
        'Turn every page of a PDF into a JPG image, or combine JPG, PNG and WebP images into a single PDF.',
      keywords: ['jpg', 'jpeg', 'png', 'webp', 'image', 'photo', 'picture', 'convert'],
    },
    watermark: {
      title: 'Watermark PDF',
      navLabel: 'Watermark',
      tagline: 'Put text or a logo over every page.',
      description:
        'Add a text or image watermark to a PDF, choosing opacity, tilt, position and which pages. All in your browser.',
      keywords: ['watermark', 'stamp', 'logo', 'draft', 'confidential', 'overlay'],
    },
    'page-numbers': {
      title: 'Number PDF pages',
      navLabel: 'Numbers',
      tagline: 'Put page numbers wherever you need them.',
      description:
        'Number the pages of a PDF, choosing position, the number to start from and the format. Works on rotated pages too. All in your browser.',
      keywords: ['page numbers', 'numbering', 'paginate', 'folio', 'number pages'],
    },
  },
  compress: {
    heading: 'Compress PDF',
    intro:
      'Shrink a PDF by re-encoding each page as an image. Best on scans and photo-heavy documents.',
    badge: 'Runs entirely in your browser',
    chooseLevel: 'How hard should it squeeze?',
    presets: {
      extreme: {
        title: 'Smallest file',
        description: 'Lowest quality. Use when size matters more than detail.',
      },
      recommended: { title: 'Balanced', description: 'Good quality at a much smaller size.' },
      low: {
        title: 'Best quality',
        description: 'Barely visible loss, more modest savings.',
      },
    },
    recommendedBadge: 'Recommended',
    textWarningTitle: 'This document contains real text.',
    textWarningBody:
      'Compression turns every page into an image, so the text will stop being selectable and searchable — and text pages often get larger as pictures. You will see the final size before you download anything.',
    action: 'Compress PDF',
    working: 'Compressing…',
    reading: 'Reading the document…',
    compressingPage: (current, total) => `Compressing page ${current} of ${total}…`,
    saving: 'Saving…',
    doneTitle: 'Compressed',
    grewTitle: 'Compression would not help here',
    doneBody: (pages) =>
      `${pages} ${pages === 1 ? 'page' : 'pages'} re-encoded. Text on those pages is now part of the image.`,
    grewBody:
      'The rasterised copy came out no smaller than the original, which is what usually happens with text documents. Keep your original — it is smaller and its text is still selectable.',
    original: 'Original',
    compressed: 'Compressed',
    saved: 'Saved',
    savedNothing: 'nothing',
    downloadAnyway: 'Download it anyway',
    another: 'Compress another',
  },
  ocr: {
    heading: 'OCR PDF',
    intro:
      'Read the text off a scanned PDF and get back a copy you can search and select. Everything runs on your device.',
    step1: '1. Choose a PDF',
    step2: '2. Choose the document language',
    upTo: (pages) => `Up to ${pages} pages`,
    chooseAnother: 'Click to choose a different file',
    languages: {
      spa: 'Spanish',
      eng: 'English',
      fra: 'French',
      deu: 'German',
      ita: 'Italian',
      por: 'Portuguese',
    },
    action: 'Start OCR',
    working: 'Reading…',
    starting: 'Starting the OCR engine…',
    reading: 'Reading the document…',
    readingPage: (current, total) => `Reading page ${current} of ${total}…`,
    assembling: 'Assembling the searchable PDF…',
    noTextTitle: 'No text was recognised',
    noTextBody:
      'The pages came back empty. Check that the selected language matches the document, and that the scan is straight and legible.',
    doneTitle: (words) => `Recognised ${words.toLocaleString('en')} words`,
    doneBody: (pages) =>
      `Across ${pages} ${pages === 1 ? 'page' : 'pages'}. The PDF below carries an invisible text layer, so you can search and select it.`,
    searchablePdf: 'Searchable PDF',
    searchablePdfNote: 'The scan, plus selectable text',
    plainText: 'Plain text',
    plainTextNote: 'Just the words, .txt',
    recognisedText: 'Recognised text',
    copy: 'Copy',
    copied: 'Copied',
    copyFailedTitle: 'Could not copy to the clipboard',
    copyFailedBody: 'Your browser blocked clipboard access. Use the .txt download instead.',
    another: 'Read another document',
  },
  merge: {
    heading: 'Merge PDF files',
    intro: 'Combine several PDFs into one, in the order you choose.',
    choose: 'Choose PDF files',
    listHeading: (count) =>
      `${count} ${count === 1 ? 'file' : 'files'}, merged top to bottom`,
    removeAll: 'Remove all',
    adding: (name) => `Adding ${name}…`,
    saving: 'Saving…',
    action: 'Merge PDFs',
    working: 'Merging…',
    needTwo: 'Add at least two files.',
    moveEarlier: (name) => `Move ${name} earlier`,
    moveLater: (name) => `Move ${name} later`,
    remove: (name) => `Remove ${name}`,
    doneTitle: (pages) => `${pages} ${pages === 1 ? 'page' : 'pages'} in one document`,
    lostNote: (list) =>
      `The original files carried ${list}. Combining them into a new document does not preserve that: the pages survive, the rest does not.`,
    another: 'Merge more files',
  },
  split: {
    heading: 'Split a PDF',
    intro: 'Pull out the pages you need, or break every page apart.',
    rangeLabel: 'Pages to keep',
    eachPage: 'One file per page',
    placeholder: 'e.g. 1-3, 5, 12-9',
    action: 'Extract pages',
    working: 'Splitting…',
    eachPageNote: (pages) => `Each of the ${pages} pages becomes its own PDF, delivered as a ZIP.`,
    syntaxNote:
      'Separate entries with commas. Ranges may count backwards (“12-9”), and an open end reaches the edge of the document (“5-”).',
    selected: (count, summary) =>
      `${count} ${count === 1 ? 'page' : 'pages'} selected: ${summary}`,
    invalid: (tokens, pages) =>
      `Could not read ${tokens} — this document has pages 1 to ${pages}.`,
    noneTitle: 'No pages selected',
    noneBody: (pages) => `Enter page numbers between 1 and ${pages}, for example “1-3, 7”.`,
    extracting: 'Extracting pages…',
    extractingPage: (current, total) => `Extracting page ${current} of ${total}…`,
    packing: 'Packing the ZIP…',
    doneZip: (files) => `${files} PDFs ready`,
    doneSingle: (pages) => `${pages} ${pages === 1 ? 'page' : 'pages'} extracted`,
    doneBody: 'Your download is ready.',
    downloadZip: 'Download ZIP',
    downloadPdf: 'Download PDF',
    another: 'Split another file',
  },
  organize: {
    heading: 'Organize PDF pages',
    intro: 'Reorder, rotate and remove pages, then save the result as a new document.',
    preparing: 'Preparing page previews…',
    renderingPage: (current, total) => `Rendering page ${current} of ${total}…`,
    pageLabel: (n) => `Page ${n}`,
    moveEarlier: (n) => `Move page ${n} earlier`,
    moveLater: (n) => `Move page ${n} later`,
    rotate: (n) => `Rotate page ${n}`,
    remove: (n) => `Remove page ${n}`,
    hint: 'Drag a page to move it, or use the arrows under each preview.',
    action: 'Save PDF',
    doneTitle: (pages) => `${pages} ${pages === 1 ? 'page' : 'pages'}, in your order`,
    doneBody: 'Your updated document is ready.',
    keptNote: (list) => `${list} survived intact.`,
    lostNote: (list) =>
      `Careful: the produced document lost ${list}. Keep your original if you need them.`,
    another: 'Organize another file',
  },
  pdfToWord: {
    heading: 'PDF to Word',
    intro:
      'Pull the text out of a PDF into an editable .docx. Text only — images, tables and layout are not carried over.',
    reading: 'Reading the document…',
    extractingPage: (current, total) => `Extracting page ${current} of ${total}…`,
    building: 'Building the Word document…',
    noTextTitle: 'This PDF has no text to extract',
    noTextBody:
      'It is most likely a scan — a picture of a page rather than text. Run it through OCR PDF first, then convert the searchable copy.',
    action: 'Convert to Word',
    working: 'Converting…',
    doneTitle: 'Your Word document is ready',
    doneBody: (paragraphs, pages) =>
      `${paragraphs.toLocaleString('en')} ${paragraphs === 1 ? 'paragraph' : 'paragraphs'} from ${pages} ${pages === 1 ? 'page' : 'pages'}.`,
    downloadDocx: 'Download .docx',
    another: 'Convert another',
  },
  edit: {
    heading: 'Edit PDF',
    intro: 'Add text anywhere on a page, then save a new copy.',
    choose: 'Choose a PDF file',
    addText: 'Add text',
    placing: 'Click the page…',
    hint: 'Click anywhere on the page to put a text box there.',
    annotationLabel: 'Annotation text',
    removeAnnotation: 'Remove this annotation',
    previous: 'Previous',
    next: 'Next',
    pageOf: (current, total) => `Page ${current} of ${total}`,
    nothingTitle: 'Nothing to save yet',
    nothingBody: 'Add some text to at least one of the boxes you placed, then save.',
    action: 'Save PDF',
    doneTitle: 'Your edited PDF is ready',
    doneBody: (boxes) => `${boxes} text ${boxes === 1 ? 'box was' : 'boxes were'} added.`,
    keepEditing: 'Keep editing',
  },
  fillForm: {
    heading: 'Fill a PDF form',
    intro: 'Complete the interactive fields of a PDF form, right here on your device.',
    choose: 'Choose a PDF form',
    chooseNote: 'A PDF with fillable fields',
    looking: 'Looking for form fields…',
    noFieldsTitle: 'This PDF has no interactive form fields.',
    noFieldsBody:
      'Forms designed to be printed and written on by hand have no fields to fill. Use Edit PDF to place text on the page instead.',
    sectionTitle: 'Form fields',
    checked: 'Checked',
    unchecked: 'Unchecked',
    leaveEmpty: 'Leave empty',
    action: 'Fill the form',
    working: 'Filling…',
    doneTitle: (filled, total) =>
      `Filled ${filled} of ${total} ${total === 1 ? 'field' : 'fields'}`,
    doneBody: 'Your completed form is ready.',
    skippedNote: (names) =>
      `These fields could not be written and were left as they were: ${names}. They may be read-only, or contain characters the form’s font cannot show.`,
    keepEditing: 'Keep editing',
  },
  imagePdf: {
    heading: 'Images & PDF',
    badge: 'Runs entirely in your browser',
    introSelect: 'Pick a direction. Both run on your device.',
    introPdfToJpg: 'Turn each page of a PDF into a JPG image.',
    introJpgToPdf: 'Combine several images into a single PDF.',
    pdfToJpgTitle: 'PDF to JPG',
    pdfToJpgBody: 'Turn every page of a PDF into a high-quality JPG image, delivered as a ZIP.',
    jpgToPdfTitle: 'Images to PDF',
    jpgToPdfBody:
      'Combine JPG, PNG or WebP images into one PDF. Choose the orientation and margins.',
    back: 'Back to the tool chooser',
    choosePdf: 'Choose a PDF',
    chooseImages: 'Choose images',
    chooseImagesNote: 'JPG, PNG and WebP. Drop several at once.',
    addMore: 'Add more',
    inOrder: (count) => `${count} ${count === 1 ? 'image' : 'images'}, in the order shown.`,
    reading: 'Reading the document…',
    convertingPage: (current, total) => `Converting page ${current} of ${total}…`,
    packing: 'Packing the ZIP…',
    preparing: 'Preparing the PDF…',
    addingImage: (current, total) => `Adding image ${current} of ${total}…`,
    saving: 'Saving…',
    actionToJpg: 'Convert to JPG',
    actionToPdf: 'Create PDF',
    workingToJpg: 'Converting…',
    workingToPdf: 'Creating…',
    zipDoneTitle: (count) => `${count} ${count === 1 ? 'image' : 'images'} ready`,
    zipDoneBody: (size) => `${size} in one ZIP.`,
    downloadZip: 'Download ZIP',
    another: 'Convert another',
    pdfDoneTitle: 'Your PDF is ready',
    settings: 'Page setup',
    orientation: 'Orientation',
    orientationAuto: 'Match each image',
    orientationPortrait: 'Portrait',
    orientationLandscape: 'Landscape',
    margins: 'Margins',
    marginNone: 'No margin',
    marginSmall: 'Small margin',
    marginBig: 'Big margin',
    changeImages: 'Change images',
    removeImage: (name) => `Remove ${name}`,
  },
  officeToPdf: {
    heading: 'PPT and Word to PDF',
    intro:
      'Convert presentations and documents to PDF using the LibreOffice engine, running entirely inside your browser.',
    accepts: 'PowerPoint, Word, Excel and their LibreOffice equivalents.',
    choose: 'Choose a document',
    families: {
      presentation: 'Presentation',
      document: 'Document',
      spreadsheet: 'Spreadsheet',
      drawing: 'Drawing',
    },
    legacyNote: (extension) =>
      `${extension} is an old format. It still converts, but if the result looks off, open it and save it again in the newer format.`,
    unsupportedTitle: (name) => `${name} cannot be converted`,
    unsupportedBody: (list) => `The supported formats are: ${list}.`,
    engineTitle: 'The conversion engine has to be downloaded',
    engineBody: (size) =>
      `About ${size}, once. It is the whole of LibreOffice, which is why the PDF comes out exactly as it would from your own computer — with real charts and tables rather than screenshots of them.`,
    enginePrivacy:
      'It downloads from this site and runs in your browser. Your document is not sent to any server, not even ours.',
    engineAction: 'Download the engine and convert',
    engineCached: 'The engine is already loaded.',
    action: 'Convert to PDF',
    reuseNote:
      'The engine is still loaded, so this conversion starts straight away. It gets slower as you convert several files in a row: reload the page for a clean start.',
    preparing: 'Preparing the converter…',
    unsupportedBrowserTitle: 'This browser cannot run the engine',
    unsupportedBrowserBody:
      'The conversion needs features this browser does not enable. Try a recent desktop Chrome, Edge or Firefox.',
    downloading: 'Downloading the engine…',
    starting: 'Starting LibreOffice…',
    converting: (name) => `Converting ${name}…`,
    opening: (name) => `Opening ${name}…`,
    exporting: (name) => `Exporting ${name} to PDF…`,
    slidesTip:
      'Working in Google Slides? You do not need this: in Slides, use File → Download → PDF Document.',
    abandonedTitle: 'The conversion took too long and was abandoned',
    abandonedBody:
      'Reload the page and try again: the engine gets slower the more it is used, and a clean start is often enough. If it happens again, opening the file in PowerPoint and saving it once usually clears it.',
    abandonedWhile: (phase) => `It stopped while ${phase}.`,
    phases: { opening: 'opening the file', exporting: 'exporting to PDF' },
    cancelledTitle: 'Conversion cancelled',
    cancelledBody: 'You can try again whenever you like; the engine is already downloaded.',
    doneTitle: 'Your PDF is ready',
    doneBody: (pages, size) =>
      `${pages} ${pages === 1 ? 'page' : 'pages'} · ${size}. The text stayed selectable and searchable.`,
    another: 'Convert another',

    chooseMany: 'Choose one or more documents',
    addMore: 'Add more',
    removeAll: 'Remove all',
    queueHeading: (count) =>
      `${count} ${count === 1 ? 'document' : 'documents'}, converted in this order`,
    moveEarlier: (name) => `Move ${name} earlier`,
    moveLater: (name) => `Move ${name} later`,
    remove: (name) => `Remove ${name}`,
    outputHeading: 'How do you want the result?',
    separateTitle: 'One PDF per document',
    separateBody:
      'Each named after its source. More than one arrives together in a ZIP.',
    combinedTitle: 'Everything in one PDF',
    combinedBody:
      'Joined in the order of the list. Joining is not instant: with several long decks it can take longer than the conversion itself.',
    slowdownWarning:
      'The engine slows down as it converts: the last file in a long list can take considerably longer than the first. If one gets stuck it is skipped and the rest carry on.',
    convertingItem: (index, total, name) => `Converting ${index} of ${total}: ${name}`,
    combining: 'Joining the PDFs…',
    combiningItem: (index, total, name) => `Joining ${index} of ${total}: ${name}`,
    zipping: 'Building the ZIP…',
    cancelledPartial: (converted) =>
      converted === 0
        ? 'You cancelled before any document was converted.'
        : `You cancelled after ${converted} ${converted === 1 ? 'document was' : 'documents were'} converted; they were discarded.`,
    timedOutItem: 'Took too long and was skipped',
    zipName: 'documents.zip',
    combinedName: 'documents.pdf',
    statusDone: (pages) => `${pages} ${pages === 1 ? 'page' : 'pages'}`,
    statusFailed: 'Failed',
    batchDoneTitle: (converted, total) =>
      converted === total
        ? `All ${total} documents converted`
        : `${converted} of ${total} documents converted`,
    batchDoneZip: (files, size) => `${files} ${files === 1 ? 'PDF' : 'PDFs'} in a ZIP · ${size}.`,
    batchDoneCombined: (pages, size) =>
      `${pages} ${pages === 1 ? 'page' : 'pages'} in a single PDF · ${size}.`,
    batchFailures: (names) => `Could not convert: ${names}.`,
    batchStopped: (converted, size) =>
      `Stopped after ${converted} ${converted === 1 ? 'document' : 'documents'} (${size}) to stay clear of running out of memory. What converted is below; the rest is best done as a second batch.`,
    batchNoneTitle: 'Nothing could be converted',
    batchNoneBody:
      'None of the documents in the list converted. Reload the page and try them one at a time to see which one is the problem.',
    combineSkipped: (names) => `Left out of the combined PDF: ${names}.`,
    downloadZip: 'Download ZIP',
  },
  stamp: {
    position: 'Position',
    anchors: {
      'top-left': 'Top left',
      'top-center': 'Top centre',
      'top-right': 'Top right',
      'middle-left': 'Middle left',
      center: 'Centre',
      'middle-right': 'Middle right',
      'bottom-left': 'Bottom left',
      'bottom-center': 'Bottom centre',
      'bottom-right': 'Bottom right',
    },
    margin: 'Margin',
    marginNote: 'Distance from the edge, in points.',
    typeface: 'Typeface',
    fontHelvetica: 'Helvetica',
    fontTimes: 'Times',
    fontCourier: 'Courier',
    bold: 'Bold',
    italic: 'Italic',
    size: 'Size',
    color: 'Colour',
    whichPages: 'Pages',
    allPages: 'All',
    somePages: 'Some',
    rangePlaceholder: '1-3, 7, 12-',
    rangeHelp: 'Numbers and ranges separated by commas. "12-" means 12 to the end.',
    rangeInvalid: (tokens) => `I could not read this: ${tokens}.`,
    rangeEmpty: 'Choose at least one page.',
    rangeChosen: (count, list) => `${count} ${count === 1 ? 'page' : 'pages'}: ${list}`,
    preview: 'Preview',
    previewPage: (page) => `Page ${page}, with the mark really applied`,
    previewWorking: 'Building the preview…',
    previewFailed: 'The preview could not be built, but you can still apply.',
    unsupportedCharacter: (character) =>
      `This typeface cannot draw "${character}". The standard PDF typefaces cover Western European languages but not every alphabet.`,
  },
  watermark: {
    heading: 'Watermark',
    intro: 'Put text or an image over the pages you choose.',
    choose: 'Choose a PDF',
    kind: 'What to put',
    kindText: 'Text',
    kindImage: 'Image',
    text: 'Text',
    textPlaceholder: 'DRAFT',
    chooseImage: 'Choose an image',
    imageNote: 'PNG or JPG. A PNG with a transparent background looks best.',
    imageChosen: (name) => `Image: ${name}`,
    changeImage: 'Change image',
    imageWidth: 'Width',
    opacity: 'Opacity',
    tilt: 'Tilt',
    action: 'Apply watermark',
    working: 'Applying…',
    nothingTitle: 'Nothing to put on',
    nothingBody: 'Type some text or choose an image before applying.',
    doneTitle: (pages) => `Marked ${pages} ${pages === 1 ? 'page' : 'pages'}`,
    doneBody: 'Your watermarked document is ready.',
    another: 'Mark another',
  },
  pageNumbers: {
    heading: 'Number pages',
    intro: 'Put page numbers where you need them, in the format you want.',
    choose: 'Choose a PDF',
    format: 'Format',
    formatPlain: 'Just the number',
    formatOfTotal: 'Number and total',
    ofWord: 'of',
    startAt: 'Start at',
    startAtNote: 'The number the first numbered page carries.',
    action: 'Number pages',
    working: 'Numbering…',
    doneTitle: (pages) => `${pages} ${pages === 1 ? 'page numbered' : 'pages numbered'}`,
    doneBody: 'Your numbered document is ready.',
    another: 'Number another',
  },
  errors: {
    encryptedTitle: 'This PDF is password-protected',
    encryptedBody:
      'OpenPDF cannot open encrypted documents. Remove the password in your PDF reader, save a copy, and try again.',
    invalidTitle: 'This file is not a readable PDF',
    invalidBody:
      'The file may be damaged, incomplete, or saved in another format with a .pdf name. Try re-exporting it from the program that created it.',
    assetsTitle: 'Could not load the PDF engine',
    assetsBody:
      'The processing code failed to load. Check your connection and reload the page — everything runs locally once it has loaded.',
    memoryTitle: 'The browser ran out of memory',
    memoryBody:
      'This document is too large to process in one pass. Split it into smaller parts and try again.',
    unknownTitle: 'Something went wrong',
    unknownBody: 'No further detail is available. The browser console may have more.',
    tooLargeTitle: (name) => `${name} is too large`,
    tooLargeBody: (limit, actual) =>
      `This tool works on files up to ${limit}; this one is ${actual}. Split it into smaller documents and try again.`,
    tooManyPagesTitle: (what) => `This document has too many pages for ${what}`,
    tooManyPagesBody: (pages, limit) =>
      `${pages} pages exceeds the limit of ${limit}. Use Split PDF to break it into parts first.`,
    cancelledTitle: 'Cancelled',
    cancelledBody: 'The operation was stopped before it finished.',
    unsupportedImageTitle: (name) => `${name} could not be processed`,
    unsupportedImageDecode:
      'This browser could not decode the image. Save it as JPG or PNG and try again.',
    unsupportedImageConvert: 'The browser could not convert the image.',
    officeFailedTitle: 'LibreOffice could not convert this document',
    officeFailedBody: (detail) =>
      `The engine reported: ${detail}. If the file opens correctly on your computer, try saving it again before converting.`,
    limitLabels: {
      ocr: 'OCR',
      compression: 'compression',
      previews: 'page previews',
      conversion: 'this conversion',
      office: 'converting to PDF',
    },
  },
};

export const DICTIONARIES: Record<Locale, Dictionary> = { es, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
