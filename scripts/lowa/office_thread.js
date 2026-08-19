/* SPDX-License-Identifier: MIT */

/**
 * Runs inside the LibreOffice worker thread and does the actual conversion.
 *
 * This file is served as a static asset rather than bundled: zetajs loads it by
 * URL from inside the worker, and resolves its own `zeta.js` relative to its
 * own location, so both have to sit at a real path on the server.
 *
 * It speaks a tiny protocol with the page:
 *   in   { cmd: 'convert', id, from, to, filter }
 *   out  { cmd: 'ready' }
 *        { cmd: 'converted', id }
 *        { cmd: 'failed', id, message }
 */

import { ZetaHelperThread } from './zetajs/zetaHelper.js';

const zHT = new ZetaHelperThread();
const zetajs = zHT.zetajs;
const css = zHT.css;

let openDocument;

function closeOpenDocument() {
  if (!openDocument) return;
  try {
    if (openDocument.queryInterface(zetajs.type.interface(css.util.XCloseable))) {
      openDocument.close(false);
    }
  } catch {
    // A document that will not close is not worth failing the next conversion for.
  }
  openDocument = undefined;
}

function convert({ id, from, to, filter }) {
  // Each conversion starts from a clean slate; a document left open from the
  // previous run holds on to a lot of memory.
  closeOpenDocument();

  const hidden = new css.beans.PropertyValue({ Name: 'Hidden', Value: true });
  const overwrite = new css.beans.PropertyValue({ Name: 'Overwrite', Value: true });
  const exportFilter = new css.beans.PropertyValue({ Name: 'FilterName', Value: filter });

  openDocument = zHT.desktop.loadComponentFromURL(`file://${from}`, '_blank', 0, [hidden]);
  if (!openDocument) {
    throw new Error('LibreOffice could not open the document.');
  }

  openDocument.storeToURL(`file://${to}`, [overwrite, exportFilter]);
  closeOpenDocument();

  zetajs.mainPort.postMessage({ cmd: 'converted', id });
}

zHT.thrPort.onmessage = (event) => {
  const message = event.data;

  if (message.cmd !== 'convert') {
    zetajs.mainPort.postMessage({
      cmd: 'failed',
      id: message.id,
      message: `Unknown command: ${message.cmd}`,
    });
    return;
  }

  try {
    convert(message);
  } catch (error) {
    // UNO exceptions are not plain JS errors; unwrap them so the page can show
    // something more useful than "[object Object]".
    let detail;
    try {
      const unoException = zetajs.catchUnoException(error);
      detail = unoException?.Message;
    } catch {
      detail = undefined;
    }
    closeOpenDocument();
    zetajs.mainPort.postMessage({
      cmd: 'failed',
      id: message.id,
      message: detail || error?.message || String(error),
    });
  }
};

zHT.thrPort.postMessage({ cmd: 'ready' });
