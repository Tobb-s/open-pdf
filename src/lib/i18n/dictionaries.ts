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
    /** The dropdown that holds the single-task tools. */
    tools: string;
    toolsHint: string;
    allTools: string;
    /** The phone menu. */
    menu: string;
    closeMenu: string;
  };
  common: {
    /**
     * Said by every tool that rebuilds a file, because none of them can re-sign
     * one. It lives here rather than under a tool because three of them need
     * the same sentence and a signature does not care which tool broke it.
     */
    signatureBroken: string;
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
    /**
     * The two families on the front page. The names are product names and stay
     * the same in both languages, like «OpenPDF» itself.
     */
    studioName: string;
    studioBody: string;
    openStudio: string;
    toolsName: string;
    toolsBody: string;
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
    /** Said when the chosen file already carries real text. */
    hasTextTitle: string;
    hasTextBody: string;
    /** What the engine thought of what it read, instead of a bare count. */
    confidenceLine: (mean: number) => string;
    lowConfidenceNote: (low: number, total: number) => string;
    strippedNote: (count: number) => string;
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
    /** The three ways of cutting a document up. */
    modeRange: string;
    modeParts: string;
    modeEachPage: string;
    partsLabel: string;
    partsChoice: (parts: number) => string;
    partsNote: (parts: number, sizes: string) => string;
    partsTooMany: (pages: number) => string;
    extractingPart: (current: number, total: number) => string;
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
    /** Stage: split stopped destroying six things quietly. */
    checking: string;
    keptNote: (list: string) => string;
    lostNote: (list: string) => string;
    partsLoseNote: (list: string) => string;
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
    /** The pages that gave nothing, named rather than folded into «listo». */
    emptyPagesNote: (empty: number, total: number) => string;
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
    /** How many the reader CHANGED, not how many the loop touched. */
    doneTitle: (filled: number) => string;
    nothingChanged: string;
    /** Values that did not survive the write, read back from the produced file. */
    wrongNote: (names: string) => string;
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
  batch: {
    heading: string;
    intro: string;
    choose: string;
    addFiles: string;
    fileCount: (count: number) => string;
    removeFile: string;
    recipe: string;
    rotate: string;
    rotateNone: string;
    watermark: string;
    watermarkPlaceholder: string;
    pageNumbers: string;
    flattenForms: string;
    flattenNote: string;
    signedNote: string;
    privacyNote: string;
    action: string;
    noActionTitle: string;
    noActionBody: string;
    working: (current: number, total: number, name: string) => string;
    cancel: string;
    outputLimit: string;
    tooManyFiles: string;
    reportTitle: string;
    reportSummary: (success: number, failed: number) => string;
    cancelledNote: string;
    signedInputs: (count: number) => string;
    downloadZip: string;
    startOver: string;
    success: string;
    failed: string;
    pages: (count: number) => string;
    formsFixed: (count: number) => string;
  };
  studio: {
    heading: string;
    intro: string;
    choose: string;
    openNote: string;
    resumeTitle: string;
    resumeBody: (name: string) => string;
    resume: string;
    discard: string;
    building: string;
    buildFailed: string;
    undo: string;
    redo: string;
    undoHint: string;
    redoHint: string;
    previousHint: string;
    nextHint: string;
    zoomOut: string;
    zoomIn: string;
    zoomFit: string;
    zoomLevel: (value: number) => string;
    editCount: (count: number) => string;
    noEdits: string;
    pageOf: (current: number, total: number) => string;
    previous: string;
    next: string;
    tools: {
      pick: string;
      text: string;
      replaceText: string;
      paragraph: string;
      signature: string;
      rect: string;
      image: string;
      ink: string;
      ocr: string;
      crop: string;
      redact: string;
      highlight: string;
      underline: string;
      strikeout: string;
      comment: string;
    };
    toolHint: {
      pick: string;
      text: string;
      replaceText: string;
      paragraph: string;
      signature: string;
      rect: string;
      image: string;
      ink: string;
      crop: string;
      redact: string;
      highlight: string;
      underline: string;
      strikeout: string;
      comment: string;
    };
    /** The shapes already on the page, and what can be taken from them. */
    fontRegular: string;
    fontsHere: string;
    fontsCannotEmbed: string;
    rotateLeft: string;
    rotateRight: string;
    deletePage: string;
    lastPage: string;
    moveEarlier: string;
    moveLater: string;
    insert: string;
    insertHint: string;
    addImageFirst: string;
    cropReset: string;
    textPlaceholder: string;
    replaceTextOriginal: string;
    replaceTextNew: string;
    replaceTextBackground: string;
    replaceTextPick: string;
    replaceTextApply: string;
    replaceTextWorking: string;
    replaceTextNote: string;
    sourceFontDetected: (name: string) => string;
    sourceFontAvailable: string;
    sourceFontUnavailable: string;
    sourceFontUse: string;
    sourceFontRights: string;
    paragraphOriginal: string;
    paragraphNew: string;
    paragraphLineSpacing: string;
    paragraphAlignment: string;
    paragraphAlignLeft: string;
    paragraphAlignCenter: string;
    paragraphAlignRight: string;
    paragraphLines: (count: number) => string;
    paragraphOverflow: string;
    paragraphUnsupported: (character: string) => string;
    paragraphPick: string;
    paragraphApply: string;
    paragraphWorking: string;
    paragraphNote: string;
    signatureSigner: string;
    signatureReason: string;
    signatureReasonOptional: string;
    signatureTyped: string;
    signatureDrawn: string;
    signatureImage: string;
    signaturePrepare: string;
    signatureClear: string;
    signatureUse: string;
    signaturePad: string;
    signatureChooseImage: string;
    signatureReady: (name: string) => string;
    signatureNotice: string;
    strokeWidth: string;
    fill: string;
    stroke: string;
    marksOnPage: (count: number) => string;
    removeMark: string;
    editTools: string;
    reviewTools: string;
    reviewer: string;
    defaultReviewer: string;
    commentPlaceholder: string;
    replyPlaceholder: string;
    reply: string;
    replies: (count: number) => string;
    /** The converging preview and its escape hatch. */
    live: string;
    manual: string;
    checkPage: string;
    slowNote: (seconds: string) => string;
    onMainThread: string;
    saved: string;
    notSaved: string;
    forget: string;
    exportAction: string;
    exporting: string;
    doneTitle: (pages: number) => string;
    doneBody: string;
    keptNote: (list: string) => string;
    lostNote: (list: string) => string;
    /** Stage four: the document, not just its pages. */
    tabPage: string;
    tabDocument: string;
    tabSearch: string;
    tabCompare: string;
    compareHeading: string;
    compareBack: string;
    compareChoose: string;
    comparePrivacy: string;
    compareReading: (current: number, total: number) => string;
    compareOriginal: string;
    compareReference: string;
    comparePixelMap: string;
    compareRendering: string;
    comparePixels: (percent: string) => string;
    compareSinglePage: string;
    compareAnother: string;
    compareDownload: string;
    compareSummary: string;
    comparePages: string;
    compareUnchanged: string;
    compareModified: string;
    compareMoved: string;
    compareAdded: string;
    compareRemoved: string;
    comparePagePair: (base: number | null, comparison: number | null) => string;
    compareWordSummary: (added: number, removed: number) => string;
    compareVisual: string;
    compareText: string;
    compareNoText: string;
    searchHeading: string;
    searchQuery: string;
    searchPlaceholder: string;
    searchCase: string;
    searchWholeWord: string;
    searchAction: string;
    searchRunning: string;
    searchResults: (count: number) => string;
    searchNoResults: string;
    searchSelectAll: string;
    searchPage: (page: number) => string;
    searchReplacement: string;
    searchReplaceSelected: string;
    searchRedactSelected: string;
    searchApplying: (current: number, total: number) => string;
    searchRewriteNote: string;
    sanitizeHeading: string;
    sanitizeNote: string;
    sanitizeMetadata: string;
    sanitizeComments: string;
    sanitizeAttachments: string;
    sanitizeActions: string;
    sanitizeApply: string;
    sanitizeRemove: string;
    metadata: string;
    metaTitle: string;
    metaAuthor: string;
    metaLanguage: string;
    fieldsSection: string;
    noFields: string;
    fieldsNote: string;
    fieldsNotWritten: (list: string) => string;
    watermarkSection: string;
    watermarkText: string;
    watermarkOff: string;
    numbersSection: string;
    numbersOff: string;
    insertImages: string;
    insertImagesHint: string;
    runOcr: string;
    ocrRunning: string;
    ocrDone: (words: number) => string;
    ocrNone: string;
    ocrNote: string;
    importedLost: (name: string, list: string) => string;
    /**
     * A signed document, and the one claim this app cannot make.
     *
     * Said when the file is OPENED, not only at the end: someone who signed a
     * contract needs to know before an afternoon of work, not after.
     */
    droppedPages: (count: number) => string;
    signedTitle: string;
    signedBody: string;
    /** Stage five: taking information out, and proving it. */
    redactNote: string;
    redactWorking: string;
    cropHides: string;
    textNotEditable: string;
    pageToImage: string;
    pageToImageNote: string;
    flattenForms: string;
    flattenFormsNote: string;
    flattenFormsOff: string;
    checkingRedaction: string;
    redactUnproven: string;
    exportBlockedTitle: string;
    exportBlockedBody: (list: string) => string;
    keepEditing: string;
    startOver: string;
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
  nav: {
    switchLanguage: 'Cambiar idioma',
    github: 'GitHub',
    tools: 'Herramientas',
    toolsHint: 'una por tarea, todas en tu navegador',
    allTools: 'Ver todas las herramientas',
    menu: 'Abrir el menú',
    closeMenu: 'Cerrar el menú',
  },
  common: {
    signatureBroken:
      'Este documento venía firmado digitalmente. La firma ya no vale: cubre los bytes exactos del archivo original, y éste es un archivo nuevo. OpenPDF no puede volver a firmar.',
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
    studioName: 'OpenPDF Studio',
    studioBody:
      'El editor. Abrí el documento y trabajalo entero: reordená, recortá, escribí encima, tachá, deshacé sin límite y exportá una sola vez, con un informe de lo que se conservó.',
    openStudio: 'Abrir Studio',
    toolsName: 'OpenPDF Tools',
    toolsBody:
      'Trece herramientas, una por tarea. Abrís, hacés lo tuyo y descargás; nada sale de tu dispositivo.',
  },
  structures: {
    form: 'los campos de formulario',
    signatures: 'la firma digital',
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
    batch: {
      title: 'Automatizar PDFs por lote',
      navLabel: 'Lotes',
      tagline: 'Aplicá la misma receta a varios PDFs.',
      description:
        'Procesá varios PDFs de una vez: girá páginas, agregá marca de agua y numeración, fijá formularios y descargá un ZIP con informe. Todo en tu navegador.',
      keywords: ['lote', 'batch', 'automatizar', 'muchos', 'zip', 'receta', 'acción'],
    },
    studio: {
      title: 'OpenPDF Studio',
      navLabel: 'Studio',
      tagline: 'Abrí el documento y trabajá sobre él, como en un editor.',
      description:
        'Editor de PDF en tu navegador: reordená, girá, recortá, borrá e insertá páginas, poné texto, rectángulos, imágenes y trazo a mano, deshacé sin límite y exportá una sola vez con un informe de qué se conservó.',
      keywords: ['editor', 'estudio', 'studio', 'editar', 'anotar', 'recortar', 'documento'],
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
    hasTextTitle: 'Este PDF ya tiene texto seleccionable.',
    hasTextBody:
      'Lo miramos en las primeras páginas y encontramos texto real, no una imagen. El OCR convierte cada página en una foto y la reconoce de nuevo: perdés la capa de texto original por una reconocida, que es peor. Si lo que querés es buscar o seleccionar, ya podés hacerlo con el archivo que tenés.',
    confidenceLine: (mean) => `Confianza media del reconocimiento: ${mean} %.`,
    lowConfidenceNote: (low, total) =>
      `${low.toLocaleString('es')} de ${total.toLocaleString('es')} palabras salieron con confianza baja: el motor no estaba seguro de lo que leyó. Una búsqueda puede no encontrarlas, o encontrar otra cosa. Revisá el texto antes de confiar en él.`,
    strippedNote: (count) =>
      `${count.toLocaleString('es')} ${count === 1 ? 'palabra tenía' : 'palabras tenían'} caracteres que la fuente del PDF no puede llevar —ligaduras, flechas, letras de otro alfabeto— y en la capa de búsqueda van sin ellos. El archivo de texto los conserva enteros.`,
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
    intro:
      'Sacá las páginas que necesitás, cortá el documento en partes, o separá cada página por su lado.',
    rangeLabel: 'Páginas a conservar',
    eachPage: 'Un archivo por página',
    modeRange: 'Un rango',
    modeParts: 'En partes',
    modeEachPage: 'Una por página',
    partsLabel: '¿En cuántas partes?',
    partsChoice: (parts) => `${parts} partes`,
    partsNote: (parts, sizes) =>
      `${parts} PDF dentro de un ZIP, en orden y sin repetir ninguna página: ${sizes}.`,
    partsTooMany: (pages) =>
      `Este documento tiene ${pages} ${pages === 1 ? 'página' : 'páginas'}, así que salen menos partes que las pedidas.`,
    extractingPart: (current, total) => `Armando la parte ${current} de ${total}…`,
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
    checking: 'Comprobando qué se conservó…',
    keptNote: (list) => `Se conservaron ${list}.`,
    lostNote: (list) =>
      `En el archivo producido no viajaron ${list}. Pediste páginas repetidas, así que hubo que armar un documento nuevo en vez de recortar el original, y eso no tiene vuelta.`,
    partsLoseNote: (list) =>
      `Cada parte es un documento nuevo hecho con las páginas que le tocan, así que de ${list} no viaja nada. Copiar páginas no copia un documento. Si necesitás conservarlos, extraé un rango en un solo archivo en vez de dividir en partes.`,
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
    emptyPagesNote: (empty, total) =>
      `${empty} de ${total} páginas no tenían texto que extraer —lo más probable es que sean escaneos— y en el .docx quedan vacías. Si las necesitás, pasá el PDF por OCR y convertí la copia buscable.`,
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
    doneTitle: (filled) =>
      filled === 1 ? 'Se completó 1 campo' : `Se completaron ${filled} campos`,
    nothingChanged: 'No cambiaste ningún campo',
    wrongNote: (names) =>
      `Releímos el archivo producido y estos campos no dicen lo que pediste: ${names}. No te lo ocultamos: el archivo está para descargar, pero eso es lo que tiene adentro.`,
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
  batch: {
    heading: 'Automatizar PDFs por lote',
    intro: 'Elegí varios archivos, definí una receta y recibí un ZIP con resultados e informe.',
    choose: 'Elegí varios PDFs',
    addFiles: 'Agregar más PDFs',
    fileCount: (count) => `${count} ${count === 1 ? 'archivo' : 'archivos'}`,
    removeFile: 'Quitar archivo',
    recipe: 'Receta del lote',
    rotate: 'Girar todas las páginas',
    rotateNone: 'No girar',
    watermark: 'Agregar marca de agua',
    watermarkPlaceholder: 'Ejemplo: CONFIDENCIAL',
    pageNumbers: 'Numerar páginas',
    flattenForms: 'Fijar formularios',
    flattenNote: 'Los campos conservan lo que muestran y dejan de ser editables.',
    signedNote: 'Si un archivo ya tiene firma digital, cualquier cambio la invalida. El informe lo señala.',
    privacyNote: 'Todo se procesa en este navegador. Ningún PDF se sube a un servidor.',
    action: 'Procesar lote',
    noActionTitle: 'La receta está vacía',
    noActionBody: 'Elegí al menos una acción antes de procesar.',
    working: (current, total, name) => `Procesando ${current} de ${total}: ${name}`,
    cancel: 'Cancelar',
    outputLimit: 'Se alcanzó el límite seguro de 300 MB de resultados en memoria.',
    tooManyFiles: 'Un lote admite hasta 50 archivos.',
    reportTitle: 'Lote terminado',
    reportSummary: (success, failed) => `${success} correctos · ${failed} con error`,
    cancelledNote:
      'El lote fue cancelado. El ZIP contiene los archivos terminados antes de detenerlo.',
    signedInputs: (count) => `${count} ${count === 1 ? 'archivo tenía' : 'archivos tenían'} firma digital y la modificación la invalida.`,
    downloadZip: 'Descargar ZIP',
    startOver: 'Procesar otro lote',
    success: 'Correcto',
    failed: 'Error',
    pages: (count) => `${count} ${count === 1 ? 'página' : 'páginas'}`,
    formsFixed: (count) => `${count} ${count === 1 ? 'campo fijado' : 'campos fijados'}`,
  },
  studio: {
    heading: 'OpenPDF Studio',
    intro:
      'Abrí un documento y trabajá sobre él: páginas, texto, marcas. Nada se guarda en ningún servidor y el archivo original no se toca hasta que exportás.',
    choose: 'Abrí un PDF',
    openNote: 'Tus ediciones quedan en este navegador. Podés cerrar la pestaña y volver.',
    resumeTitle: 'Tenés trabajo sin terminar',
    resumeBody: (name) => `Dejaste «${name}» abierto en este navegador.`,
    resume: 'Seguir donde estaba',
    discard: 'Empezar de cero',
    building: 'Rehaciendo el documento…',
    buildFailed: 'No se pudo rehacer el documento con esta edición.',
    undo: 'Deshacer',
    redo: 'Rehacer',
    undoHint: 'Deshacer · Ctrl+Z',
    redoHint: 'Rehacer · Ctrl+Y o Ctrl+Mayús+Z',
    previousHint: 'Página anterior · ←',
    nextHint: 'Página siguiente · →',
    zoomOut: 'Alejar',
    zoomIn: 'Acercar',
    zoomFit: 'Ajustar al visor',
    zoomLevel: (value) => `Zoom ${value}%`,
    editCount: (count) => `${count} ${count === 1 ? 'edición' : 'ediciones'}`,
    noEdits: 'Sin cambios',
    pageOf: (current, total) => `Página ${current} de ${total}`,
    previous: 'Anterior',
    next: 'Siguiente',
    tools: {
      pick: 'Mano',
      text: 'Texto',
      replaceText: 'Reemplazar',
      paragraph: 'Párrafo',
      signature: 'Firmar',
      rect: 'Rectángulo',
      image: 'Imagen',
      ink: 'Lápiz',
      ocr: 'Capa de texto',
      crop: 'Recortar',
      redact: 'Tachar',
      highlight: 'Resaltar',
      underline: 'Subrayar',
      strikeout: 'Tachar texto',
      comment: 'Nota',
    },
    toolHint: {
      pick: 'Mirá el documento y usá los controles de página.',
      text: 'Hacé clic donde quieras el texto.',
      replaceText: 'Elegí un fragmento del texto existente para reemplazarlo.',
      paragraph: 'Elegí un bloque horizontal para editar su texto y formato.',
      signature: 'Prepará tu firma y hacé clic donde quieras colocarla.',
      rect: 'Arrastrá para dibujar un rectángulo.',
      image: 'Elegí una imagen y hacé clic para ponerla.',
      ink: 'Arrastrá para dibujar a mano alzada.',
      crop: 'Arrastrá el área que querés conservar.',
      redact: 'Arrastrá encima de lo que querés que desaparezca.',
      highlight: 'Arrastrá sobre el texto o el área que querés resaltar.',
      underline: 'Arrastrá debajo del texto que querés subrayar.',
      strikeout: 'Arrastrá sobre el texto que querés marcar como eliminado.',
      comment: 'Escribí la nota y hacé clic donde quieras dejarla.',
    },
    fontRegular: 'normal',
    fontsHere: 'Esta página usa',
    fontsCannotEmbed:
      'Tocá una para escribir con su misma forma: serifas, negrita, cursiva. Es distinto de reusar la fuente misma —eso lo ofrece el control de «fuente del documento»—, y es lo que queda cuando esa fuente no se puede reusar.',
    rotateLeft: 'Girar a la izquierda',
    rotateRight: 'Girar a la derecha',
    deletePage: 'Eliminar página',
    lastPage: 'No se puede eliminar la única página que queda.',
    moveEarlier: 'Mover antes',
    moveLater: 'Mover después',
    insert: 'Insertar páginas',
    insertHint: 'Se insertan justo antes de la página que estás viendo.',
    addImageFirst: 'Elegí una imagen',
    cropReset: 'Quitar el recorte',
    textPlaceholder: 'Escribí acá…',
    replaceTextOriginal: 'Texto original',
    replaceTextNew: 'Texto nuevo',
    replaceTextBackground: 'Fondo del documento',
    replaceTextPick: 'Hacé clic sobre el fragmento que querés reemplazar en la página.',
    replaceTextApply: 'Aplicar reemplazo',
    replaceTextWorking: 'Reemplazando…',
    replaceTextNote:
      'Para borrar el texto anterior de verdad, esta página se convierte en una imagen. Conserva su aspecto y vuelve a ser buscable, pero pierde enlaces, formularios, capas y anotaciones interactivas de esa página. El original queda intacto.',
    sourceFontDetected: (name) => `Fuente detectada: ${name}`,
    sourceFontAvailable: 'Está incrustada en este PDF y Studio puede reutilizarla.',
    sourceFontUnavailable: 'El PDF declara esta fuente, pero no incluye una copia reutilizable.',
    sourceFontUse: 'Usar la fuente incrustada',
    sourceFontRights: 'Usala solo si tenés derecho a reutilizarla.',
    paragraphOriginal: 'Párrafo original',
    paragraphNew: 'Contenido del párrafo',
    paragraphLineSpacing: 'Interlineado',
    paragraphAlignment: 'Alineación',
    paragraphAlignLeft: 'Alinear a la izquierda',
    paragraphAlignCenter: 'Centrar',
    paragraphAlignRight: 'Alinear a la derecha',
    paragraphLines: (count) => `${count} ${count === 1 ? 'línea' : 'líneas'}`,
    paragraphOverflow: 'El texto no entra en el bloque. Reducí el tamaño, el interlineado o el contenido.',
    paragraphUnsupported: (character) => `La fuente PDF elegida no admite «${character}».`,
    paragraphPick: 'Hacé clic sobre un bloque de texto horizontal para editarlo.',
    paragraphApply: 'Aplicar edición de párrafo',
    paragraphWorking: 'Recomponiendo…',
    paragraphNote:
      'El texto debe caber dentro del bloque original para no tapar otro contenido. La página se reconstruye y vuelve a ser buscable, pero pierde enlaces, formularios, capas y anotaciones interactivas. El original queda intacto.',
    signatureSigner: 'Nombre del firmante',
    signatureReason: 'Motivo',
    signatureReasonOptional: 'Opcional. Queda en el registro de auditoría.',
    signatureTyped: 'Escribir',
    signatureDrawn: 'Dibujar',
    signatureImage: 'Imagen',
    signaturePrepare: 'Preparar firma',
    signatureClear: 'Limpiar',
    signatureUse: 'Usar firma',
    signaturePad: 'Área para dibujar la firma',
    signatureChooseImage: 'Elegir imagen de firma',
    signatureReady: (name) => `Firma lista: ${name}. Hacé clic en la página para colocarla.`,
    signatureNotice:
      'Esta es una firma electrónica visual con fecha, método y hash de auditoría. No usa certificado digital y OpenPDF no verifica la identidad del firmante.',
    strokeWidth: 'Grosor',
    fill: 'Relleno',
    stroke: 'Borde',
    marksOnPage: (count) => `${count} ${count === 1 ? 'marca' : 'marcas'} en esta página`,
    removeMark: 'Quitar marca',
    editTools: 'Editar',
    reviewTools: 'Revisar',
    reviewer: 'Autor de los comentarios',
    defaultReviewer: 'Revisor',
    commentPlaceholder: 'Escribí el comentario…',
    replyPlaceholder: 'Responder…',
    reply: 'Responder',
    replies: (count) => `${count} ${count === 1 ? 'respuesta' : 'respuestas'}`,
    live: 'Vista en vivo',
    manual: 'Vista manual',
    checkPage: 'Comprobar página',
    slowNote: (seconds) =>
      `Rehacer este documento tarda ${seconds} s, así que la vista pasó a manual. Tocá «Comprobar página» cuando quieras verla.`,
    onMainThread:
      'Este navegador no permitió usar un worker, así que el documento se rehace en el hilo principal. Funciona igual, más lento.',
    saved: 'Guardado en este navegador',
    notSaved: 'No se pudo guardar en este navegador',
    forget: 'Borrar lo guardado',
    exportAction: 'Exportar',
    exporting: 'Exportando…',
    doneTitle: (pages) =>
      `${pages} ${pages === 1 ? 'página exportada' : 'páginas exportadas'}`,
    doneBody: 'Tu documento está listo.',
    keptNote: (list) => `Se conservaron ${list}.`,
    lostNote: (list) =>
      `Atención: el documento producido perdió ${list}. Si los necesitás, conservá el original.`,
    tabPage: 'Página',
    tabDocument: 'Documento',
    tabSearch: 'Buscar',
    tabCompare: 'Comparar',
    compareHeading: 'Comparar versiones PDF',
    compareBack: 'Volver al editor',
    compareChoose: 'Elegí la segunda versión del PDF',
    comparePrivacy: 'Ambos documentos se comparan en este navegador. No se suben a ningún servidor.',
    compareReading: (current, total) => `Leyendo páginas ${current} de ${total}…`,
    compareOriginal: 'Versión actual',
    compareReference: 'Segunda versión',
    comparePixelMap: 'Mapa de cambios',
    compareRendering: 'Preparando comparación visual…',
    comparePixels: (percent) => `${percent}% de píxeles distintos`,
    compareSinglePage: 'Esta página existe en una sola versión; no hay un par visual para superponer.',
    compareAnother: 'Cambiar archivo',
    compareDownload: 'Descargar informe',
    compareSummary: 'Resumen de diferencias',
    comparePages: 'Páginas comparadas',
    compareUnchanged: 'Sin cambios',
    compareModified: 'Modificada',
    compareMoved: 'Movida',
    compareAdded: 'Agregada',
    compareRemoved: 'Eliminada',
    comparePagePair: (base, comparison) =>
      `Original ${base ?? '-'} / Versión ${comparison ?? '-'}`,
    compareWordSummary: (added, removed) =>
      `${added} ${added === 1 ? 'palabra agregada' : 'palabras agregadas'} · ${removed} ${removed === 1 ? 'eliminada' : 'eliminadas'}`,
    compareVisual: 'Comparación visual',
    compareText: 'Cambios de texto',
    compareNoText: 'No se encontró texto extraíble en estas páginas.',
    searchHeading: 'Buscar en todo el documento',
    searchQuery: 'Texto a buscar',
    searchPlaceholder: 'Palabra o frase…',
    searchCase: 'Distinguir mayúsculas',
    searchWholeWord: 'Sólo palabras completas',
    searchAction: 'Buscar',
    searchRunning: 'Buscando…',
    searchResults: (count) => `${count} ${count === 1 ? 'coincidencia' : 'coincidencias'}`,
    searchNoResults: 'No se encontraron coincidencias.',
    searchSelectAll: 'Seleccionar todas',
    searchPage: (page) => `Página ${page}`,
    searchReplacement: 'Reemplazar por',
    searchReplaceSelected: 'Reemplazar seleccionadas',
    searchRedactSelected: 'Censurar seleccionadas',
    searchApplying: (current, total) => `Procesando página ${current} de ${total}…`,
    searchRewriteNote:
      'Las páginas modificadas se rehacen como imagen y recuperan una capa buscable. Pierden enlaces, formularios, capas y anotaciones interactivas de esas páginas; el original queda intacto.',
    sanitizeHeading: 'Sanitizar contenido oculto',
    sanitizeNote:
      'Elimina del archivo producido las categorías elegidas. La vista puede no cambiar porque son datos que normalmente no se ven.',
    sanitizeMetadata: 'Metadatos del documento',
    sanitizeComments: 'Comentarios y anotaciones',
    sanitizeAttachments: 'Archivos adjuntos',
    sanitizeActions: 'Scripts y acciones automáticas',
    sanitizeApply: 'Aplicar sanitización',
    sanitizeRemove: 'Quitar sanitización',
    metadata: 'Datos del documento',
    metaTitle: 'Título',
    metaAuthor: 'Autor',
    metaLanguage: 'Idioma',
    fieldsSection: 'Campos del formulario',
    noFields: 'Este documento no tiene campos para completar.',
    fieldsNote: 'Se escriben al exportar, y después se vuelven a leer del archivo para confirmar que quedaron.',
    fieldsNotWritten: (list) =>
      `Atención: estos campos no quedaron como los escribiste: ${list}. Lo sabemos porque volvimos a leer el archivo producido.`,
    watermarkSection: 'Marca de agua',
    watermarkText: 'Texto',
    watermarkOff: 'Quitar la marca de agua',
    numbersSection: 'Números de página',
    numbersOff: 'Quitar los números',
    insertImages: 'Insertar imágenes',
    insertImagesHint: 'Cada imagen entra como una página nueva, antes de la que estás viendo.',
    runOcr: 'Reconocer el texto de esta página',
    ocrRunning: 'Leyendo la página…',
    ocrDone: (words) => `${words} ${words === 1 ? 'palabra reconocida' : 'palabras reconocidas'}.`,
    ocrNone: 'No se reconoció ninguna palabra en esta página.',
    ocrNote:
      'Agrega una capa de texto invisible encima de la página, para poder buscar y seleccionar. No cambia lo que se ve.',
    importedLost: (name, list) =>
      `De «${name}» viajaron las páginas, no ${list}. Copiar páginas no copia el documento, y eso no tiene arreglo.`,
    droppedPages: (count) =>
      count === 1
        ? 'Una página no se pudo construir y no está en el documento. Suele ser una imagen que el archivo dice ser y no es. Deshacé esa inserción, o seguí sin ella: lo que ves es lo que va a salir.'
        : `${count} páginas no se pudieron construir y no están en el documento. Suelen ser imágenes que el archivo dice ser y no son. Deshacé esas inserciones, o seguí sin ellas: lo que ves es lo que va a salir.`,
    signedTitle: 'Este documento está firmado digitalmente',
    signedBody:
      'Cualquier cambio rompe la firma, y no es un defecto que podamos arreglar: una firma cubre los bytes exactos del archivo que se firmó, y guardar de nuevo los reescribe. OpenPDF no puede volver a firmar. Si necesitás conservar la firma, no edites acá — descargá el original y trabajá sobre una copia.',
    redactNote:
      'Tachar convierte la página en una imagen con la zona pintada encima. Lo que estaba debajo no queda tapado: no queda. A cambio, esa página deja de tener texto seleccionable.',
    redactWorking: 'Tachando y rehaciendo la página…',
    cropHides:
      'Recortar esconde, no borra: lo que queda fuera sigue en el archivo y se puede recuperar. Si lo que querés es que desaparezca, usá Tachar.',
    textNotEditable:
      'Este texto es parte del documento original. Podés taparlo y escribir encima. OpenPDF no lo edita porque no puede garantizar el resultado.',
    pageToImage: 'Convertir esta página en imagen',
    pageToImageNote:
      'Para dibujar encima sin tocar el original. La página deja de tener texto seleccionable.',
    flattenForms: 'Fijar el formulario',
    flattenFormsNote:
      'Los campos se vuelven parte de la página: se siguen leyendo, ya no se pueden completar.',
    flattenFormsOff: 'Dejar el formulario como está',
    checkingRedaction: 'Comprobando que lo tachado no esté…',
    redactUnproven:
      'La página se rehízo como imagen, así que lo que estaba debajo no está. Pero no había texto seleccionable bajo la zona pintada, así que no hubo nada que buscar en el archivo producido: no te lo podemos demostrar, sólo decírtelo. Suele pasar con documentos escaneados.',
    exportBlockedTitle: 'No se entregó el archivo',
    exportBlockedBody: (list) =>
      `Todavía se puede encontrar esto en el documento producido: ${list}. No te lo damos para descargar, porque un archivo que parece tachado y no lo está es peor que ninguno. Probá tachando un área un poco más grande.`,
    keepEditing: 'Seguir editando',
    startOver: 'Abrir otro',
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
  nav: {
    switchLanguage: 'Change language',
    github: 'GitHub',
    tools: 'Tools',
    toolsHint: 'one per task, all in your browser',
    allTools: 'See all tools',
    menu: 'Open menu',
    closeMenu: 'Close menu',
  },
  common: {
    signatureBroken:
      'This document arrived digitally signed. The signature is no longer valid: it covers the exact bytes of the original file, and this is a new file. OpenPDF cannot sign it again.',
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
    studioName: 'OpenPDF Studio',
    studioBody:
      'The editor. Open the document and work on the whole of it: reorder, crop, write over, redact, undo without limit and export once, with a report of what survived.',
    openStudio: 'Open Studio',
    toolsName: 'OpenPDF Tools',
    toolsBody:
      'Thirteen tools, one per task. Open, do the one thing, download; nothing leaves your device.',
  },
  structures: {
    form: 'the form fields',
    signatures: 'the digital signature',
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
    batch: {
      title: 'Batch PDF automation',
      navLabel: 'Batch',
      tagline: 'Apply one recipe to several PDFs.',
      description:
        'Process several PDFs at once: rotate pages, add a watermark and numbering, flatten forms, and download a ZIP with a report. Everything runs in your browser.',
      keywords: ['batch', 'automate', 'multiple', 'many', 'zip', 'recipe', 'action'],
    },
    studio: {
      title: 'OpenPDF Studio',
      navLabel: 'Studio',
      tagline: 'Open the document and work on it, like an editor.',
      description:
        'A PDF editor in your browser: reorder, rotate, crop, delete and insert pages, add text, rectangles, images and freehand strokes, undo without limit, and export once with a report of what survived.',
      keywords: ['editor', 'studio', 'edit', 'annotate', 'crop', 'document'],
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
    hasTextTitle: 'This PDF already has selectable text.',
    hasTextBody:
      'We looked at the first pages and found real text, not a picture. OCR turns every page into a photo and recognises it again: you lose the original text layer for a recognised one, which is worse. If all you want is to search or select, you already can with the file you have.',
    confidenceLine: (mean) => `Average recognition confidence: ${mean}%.`,
    lowConfidenceNote: (low, total) =>
      `${low.toLocaleString('en')} of ${total.toLocaleString('en')} words came out with low confidence: the engine was not sure what it read. A search may miss them, or find something else. Check the text before relying on it.`,
    strippedNote: (count) =>
      `${count.toLocaleString('en')} ${count === 1 ? 'word had' : 'words had'} characters the PDF font cannot carry — ligatures, arrows, letters from another alphabet — and they go into the search layer without them. The text file keeps them whole.`,
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
    intro:
      'Pull out the pages you need, cut the document into parts, or break every page apart.',
    rangeLabel: 'Pages to keep',
    eachPage: 'One file per page',
    modeRange: 'A range',
    modeParts: 'Into parts',
    modeEachPage: 'One per page',
    partsLabel: 'How many parts?',
    partsChoice: (parts) => `${parts} parts`,
    partsNote: (parts, sizes) =>
      `${parts} PDFs inside a ZIP, in order, with no page in two of them: ${sizes}.`,
    partsTooMany: (pages) =>
      `This document has ${pages} ${pages === 1 ? 'page' : 'pages'}, so you get fewer parts than you asked for.`,
    extractingPart: (current, total) => `Building part ${current} of ${total}…`,
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
    checking: 'Checking what survived…',
    keptNote: (list) => `${list} survived.`,
    lostNote: (list) =>
      `From the produced file, ${list} did not travel. You asked for repeated pages, so a new document had to be assembled instead of trimming the original, and there is no way around that.`,
    partsLoseNote: (list) =>
      `Each part is a new document made from the pages it gets, so none of ${list} travels. Copying pages does not copy a document. If you need to keep them, extract a range into a single file instead of splitting into parts.`,
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
    emptyPagesNote: (empty, total) =>
      `${empty} of ${total} pages had no text to extract — most likely scans — and are empty in the .docx. If you need them, run the PDF through OCR and convert the searchable copy.`,
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
    doneTitle: (filled) => (filled === 1 ? 'Filled 1 field' : `Filled ${filled} fields`),
    nothingChanged: 'You did not change any field',
    wrongNote: (names) =>
      `We read the produced file back and these fields do not say what you asked for: ${names}. We are not hiding it: the file is there to download, but that is what is inside it.`,
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
  batch: {
    heading: 'Batch PDF automation',
    intro: 'Choose several files, define one recipe, and receive a ZIP with results and a report.',
    choose: 'Choose several PDFs',
    addFiles: 'Add more PDFs',
    fileCount: (count) => `${count} ${count === 1 ? 'file' : 'files'}`,
    removeFile: 'Remove file',
    recipe: 'Batch recipe',
    rotate: 'Rotate every page',
    rotateNone: 'Do not rotate',
    watermark: 'Add watermark',
    watermarkPlaceholder: 'Example: CONFIDENTIAL',
    pageNumbers: 'Number pages',
    flattenForms: 'Flatten forms',
    flattenNote: 'Fields keep what they display and become read-only page content.',
    signedNote: 'If a file already has a digital signature, any change invalidates it. The report flags it.',
    privacyNote: 'Everything runs in this browser. No PDF is uploaded to a server.',
    action: 'Process batch',
    noActionTitle: 'The recipe is empty',
    noActionBody: 'Choose at least one action before processing.',
    working: (current, total, name) => `Processing ${current} of ${total}: ${name}`,
    cancel: 'Cancel',
    outputLimit: 'The safe 300 MB in-memory result limit was reached.',
    tooManyFiles: 'A batch can contain up to 50 files.',
    reportTitle: 'Batch complete',
    reportSummary: (success, failed) => `${success} succeeded · ${failed} failed`,
    cancelledNote:
      'The batch was cancelled. The ZIP contains the files completed before it stopped.',
    signedInputs: (count) => `${count} digitally signed ${count === 1 ? 'file was' : 'files were'} changed, invalidating the signature.`,
    downloadZip: 'Download ZIP',
    startOver: 'Process another batch',
    success: 'Succeeded',
    failed: 'Failed',
    pages: (count) => `${count} ${count === 1 ? 'page' : 'pages'}`,
    formsFixed: (count) => `${count} ${count === 1 ? 'field flattened' : 'fields flattened'}`,
  },
  studio: {
    heading: 'OpenPDF Studio',
    intro:
      'Open a document and work on it: pages, text, marks. Nothing reaches a server, and your original file is untouched until you export.',
    choose: 'Open a PDF',
    openNote: 'Your edits stay in this browser. You can close the tab and come back.',
    resumeTitle: 'You have unfinished work',
    resumeBody: (name) => `You left "${name}" open in this browser.`,
    resume: 'Pick up where I left off',
    discard: 'Start fresh',
    building: 'Rebuilding the document…',
    buildFailed: 'The document could not be rebuilt with this edit.',
    undo: 'Undo',
    redo: 'Redo',
    undoHint: 'Undo · Ctrl+Z',
    redoHint: 'Redo · Ctrl+Y or Ctrl+Shift+Z',
    previousHint: 'Previous page · ←',
    nextHint: 'Next page · →',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    zoomFit: 'Fit to viewer',
    zoomLevel: (value) => `Zoom ${value}%`,
    editCount: (count) => `${count} ${count === 1 ? 'edit' : 'edits'}`,
    noEdits: 'No changes',
    pageOf: (current, total) => `Page ${current} of ${total}`,
    previous: 'Previous',
    next: 'Next',
    tools: {
      pick: 'Hand',
      text: 'Text',
      replaceText: 'Replace',
      paragraph: 'Paragraph',
      signature: 'Sign',
      rect: 'Rectangle',
      image: 'Image',
      ink: 'Pen',
      ocr: 'Text layer',
      crop: 'Crop',
      redact: 'Redact',
      highlight: 'Highlight',
      underline: 'Underline',
      strikeout: 'Strike out',
      comment: 'Comment',
    },
    toolHint: {
      pick: 'Look through the document and use the page controls.',
      text: 'Click where you want the text.',
      replaceText: 'Select an existing text fragment to replace it.',
      paragraph: 'Select a horizontal block to edit its text and formatting.',
      signature: 'Prepare your signature, then click where you want to place it.',
      rect: 'Drag to draw a rectangle.',
      image: 'Choose an image, then click to place it.',
      ink: 'Drag to draw freehand.',
      crop: 'Drag the area you want to keep.',
      redact: 'Drag over whatever you want gone.',
      highlight: 'Drag over the text or area you want to highlight.',
      underline: 'Drag under the text you want to underline.',
      strikeout: 'Drag over the text you want to mark as removed.',
      comment: 'Write the comment, then click where you want to leave it.',
    },
    fontRegular: 'regular',
    fontsHere: 'This page uses',
    fontsCannotEmbed:
      'Tap one to write in the same shape: serifs, weight, slant. That is not the same as reusing the font itself — the source-font control offers that — and it is what remains when the font cannot be reused.',
    rotateLeft: 'Turn left',
    rotateRight: 'Turn right',
    deletePage: 'Delete page',
    lastPage: 'The last remaining page cannot be deleted.',
    moveEarlier: 'Move earlier',
    moveLater: 'Move later',
    insert: 'Insert pages',
    insertHint: 'They go in just before the page you are looking at.',
    addImageFirst: 'Choose an image',
    cropReset: 'Remove the crop',
    textPlaceholder: 'Type here…',
    replaceTextOriginal: 'Original text',
    replaceTextNew: 'New text',
    replaceTextBackground: 'Document background',
    replaceTextPick: 'Click the text fragment you want to replace on the page.',
    replaceTextApply: 'Apply replacement',
    replaceTextWorking: 'Replacing…',
    replaceTextNote:
      'To truly remove the old text, this page becomes an image. It keeps its appearance and becomes searchable again, but page links, forms, layers, and interactive annotations are lost. The original stays untouched.',
    sourceFontDetected: (name) => `Detected font: ${name}`,
    sourceFontAvailable: 'It is embedded in this PDF and Studio can reuse it.',
    sourceFontUnavailable: 'The PDF declares this font but does not include a reusable copy.',
    sourceFontUse: 'Use the embedded font',
    sourceFontRights: 'Use it only when you have the right to reuse it.',
    paragraphOriginal: 'Original paragraph',
    paragraphNew: 'Paragraph content',
    paragraphLineSpacing: 'Line spacing',
    paragraphAlignment: 'Alignment',
    paragraphAlignLeft: 'Align left',
    paragraphAlignCenter: 'Center',
    paragraphAlignRight: 'Align right',
    paragraphLines: (count) => `${count} ${count === 1 ? 'line' : 'lines'}`,
    paragraphOverflow: 'The text does not fit this block. Reduce its size, spacing, or content.',
    paragraphUnsupported: (character) => `The selected PDF font does not support “${character}”.`,
    paragraphPick: 'Click a horizontal text block on the page to edit it.',
    paragraphApply: 'Apply paragraph edit',
    paragraphWorking: 'Reflowing…',
    paragraphNote:
      'Text must fit the original block so it cannot cover other content. The page is rebuilt and becomes searchable again, but loses links, forms, layers, and interactive annotations. The original stays untouched.',
    signatureSigner: 'Signer name',
    signatureReason: 'Reason',
    signatureReasonOptional: 'Optional. Stored in the audit record.',
    signatureTyped: 'Type',
    signatureDrawn: 'Draw',
    signatureImage: 'Image',
    signaturePrepare: 'Prepare signature',
    signatureClear: 'Clear',
    signatureUse: 'Use signature',
    signaturePad: 'Signature drawing area',
    signatureChooseImage: 'Choose signature image',
    signatureReady: (name) => `Signature ready: ${name}. Click the page to place it.`,
    signatureNotice:
      'This is a visible electronic signature with a date, method, and audit hash. It does not use a digital certificate, and OpenPDF does not verify the signer’s identity.',
    strokeWidth: 'Thickness',
    fill: 'Fill',
    stroke: 'Border',
    marksOnPage: (count) => `${count} ${count === 1 ? 'mark' : 'marks'} on this page`,
    removeMark: 'Remove mark',
    editTools: 'Edit',
    reviewTools: 'Review',
    reviewer: 'Comment author',
    defaultReviewer: 'Reviewer',
    commentPlaceholder: 'Write a comment…',
    replyPlaceholder: 'Reply…',
    reply: 'Reply',
    replies: (count) => `${count} ${count === 1 ? 'reply' : 'replies'}`,
    live: 'Live view',
    manual: 'Manual view',
    checkPage: 'Check page',
    slowNote: (seconds) =>
      `Rebuilding this document takes ${seconds} s, so the view switched to manual. Tap "Check page" when you want to see it.`,
    onMainThread:
      'This browser would not give us a worker, so the document is rebuilt on the main thread. It still works, just slower.',
    saved: 'Saved in this browser',
    notSaved: 'Could not save in this browser',
    forget: 'Delete what is saved',
    exportAction: 'Export',
    exporting: 'Exporting…',
    doneTitle: (pages) => `${pages} ${pages === 1 ? 'page' : 'pages'} exported`,
    doneBody: 'Your document is ready.',
    keptNote: (list) => `${list} survived intact.`,
    lostNote: (list) =>
      `Careful: the produced document lost ${list}. Keep your original if you need them.`,
    tabPage: 'Page',
    tabDocument: 'Document',
    tabSearch: 'Search',
    tabCompare: 'Compare',
    compareHeading: 'Compare PDF versions',
    compareBack: 'Back to editor',
    compareChoose: 'Choose the second PDF version',
    comparePrivacy: 'Both documents are compared in this browser. Nothing is uploaded to a server.',
    compareReading: (current, total) => `Reading pages ${current} of ${total}…`,
    compareOriginal: 'Current version',
    compareReference: 'Second version',
    comparePixelMap: 'Change map',
    compareRendering: 'Preparing visual comparison…',
    comparePixels: (percent) => `${percent}% of pixels differ`,
    compareSinglePage: 'This page exists in only one version, so there is no visual pair to overlay.',
    compareAnother: 'Change file',
    compareDownload: 'Download report',
    compareSummary: 'Difference summary',
    comparePages: 'Compared pages',
    compareUnchanged: 'Unchanged',
    compareModified: 'Modified',
    compareMoved: 'Moved',
    compareAdded: 'Added',
    compareRemoved: 'Removed',
    comparePagePair: (base, comparison) =>
      `Original ${base ?? '-'} / Version ${comparison ?? '-'}`,
    compareWordSummary: (added, removed) =>
      `${added} ${added === 1 ? 'word added' : 'words added'} · ${removed} ${removed === 1 ? 'word removed' : 'words removed'}`,
    compareVisual: 'Visual comparison',
    compareText: 'Text changes',
    compareNoText: 'No extractable text was found on these pages.',
    searchHeading: 'Search the whole document',
    searchQuery: 'Text to find',
    searchPlaceholder: 'Word or phrase…',
    searchCase: 'Match case',
    searchWholeWord: 'Whole words only',
    searchAction: 'Search',
    searchRunning: 'Searching…',
    searchResults: (count) => `${count} ${count === 1 ? 'match' : 'matches'}`,
    searchNoResults: 'No matches were found.',
    searchSelectAll: 'Select all',
    searchPage: (page) => `Page ${page}`,
    searchReplacement: 'Replace with',
    searchReplaceSelected: 'Replace selected',
    searchRedactSelected: 'Redact selected',
    searchApplying: (current, total) => `Processing page ${current} of ${total}…`,
    searchRewriteNote:
      'Changed pages are rebuilt as images and receive a new searchable layer. Links, forms, layers, and interactive annotations on those pages are lost; the original remains untouched.',
    sanitizeHeading: 'Sanitize hidden content',
    sanitizeNote:
      'Removes the selected categories from the produced file. The preview may not change because this data is normally hidden.',
    sanitizeMetadata: 'Document metadata',
    sanitizeComments: 'Comments and annotations',
    sanitizeAttachments: 'File attachments',
    sanitizeActions: 'Scripts and automatic actions',
    sanitizeApply: 'Apply sanitization',
    sanitizeRemove: 'Remove sanitization',
    metadata: 'Document details',
    metaTitle: 'Title',
    metaAuthor: 'Author',
    metaLanguage: 'Language',
    fieldsSection: 'Form fields',
    noFields: 'This document has no fields to fill in.',
    fieldsNote: 'They are written on export, then read back out of the file to confirm they took.',
    fieldsNotWritten: (list) =>
      `Careful: these fields did not come out as you typed them: ${list}. We know because we read the produced file back.`,
    watermarkSection: 'Watermark',
    watermarkText: 'Text',
    watermarkOff: 'Remove the watermark',
    numbersSection: 'Page numbers',
    numbersOff: 'Remove the numbers',
    insertImages: 'Insert images',
    insertImagesHint: 'Each image becomes a new page, before the one you are looking at.',
    runOcr: 'Read the text on this page',
    ocrRunning: 'Reading the page…',
    ocrDone: (words) => `${words} ${words === 1 ? 'word recognised' : 'words recognised'}.`,
    ocrNone: 'No words were recognised on this page.',
    ocrNote:
      'Adds an invisible text layer over the page so it can be searched and selected. It does not change what you see.',
    importedLost: (name, list) =>
      `From "${name}" the pages travelled, but not ${list}. Copying pages does not copy a document, and there is no fixing that.`,
    droppedPages: (count) =>
      count === 1
        ? 'One page could not be built and is not in the document. Usually an image the file claims to be and is not. Undo that insertion, or carry on without it: what you see is what will come out.'
        : `${count} pages could not be built and are not in the document. Usually images the files claim to be and are not. Undo those insertions, or carry on without them: what you see is what will come out.`,
    signedTitle: 'This document is digitally signed',
    signedBody:
      'Any change breaks the signature, and that is not a defect we can fix: a signature covers the exact bytes of the file it was made over, and saving again rewrites them. OpenPDF cannot sign it again. If the signature has to survive, do not edit here — download the original and work on a copy.',
    redactNote:
      'Redacting turns the page into a picture with the area painted over. What was underneath is not covered — it is gone. In exchange, that page stops having selectable text.',
    redactWorking: 'Redacting and rebuilding the page…',
    cropHides:
      'Cropping hides, it does not remove: what falls outside is still in the file and can be recovered. If you want it gone, use Redact.',
    textNotEditable:
      'This text is part of the original document. You can cover it and write on top. OpenPDF does not edit it because it cannot guarantee the result.',
    pageToImage: 'Turn this page into an image',
    pageToImageNote:
      'To draw on it without touching the original. The page stops having selectable text.',
    flattenForms: 'Fix the form in place',
    flattenFormsNote:
      'The fields become part of the page: still readable, no longer fillable.',
    flattenFormsOff: 'Leave the form as it is',
    checkingRedaction: 'Checking that what you redacted is gone…',
    redactUnproven:
      'The page was rebuilt as a picture, so what was underneath is gone. But there was no selectable text under the painted area, so there was nothing to search the produced file for: we can tell you, not show you. This is usual for scanned documents.',
    exportBlockedTitle: 'The file was not handed over',
    exportBlockedBody: (list) =>
      `This can still be found in the produced document: ${list}. We are not giving it to you to download, because a file that looks redacted and is not is worse than no file. Try redacting a slightly larger area.`,
    keepEditing: 'Keep editing',
    startOver: 'Open another',
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
