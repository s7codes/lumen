/** Hands a Blob to the browser as a download. Blob URLs stay inside the CSP. */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Hands a generated text file to the browser as a download. */
export function downloadText(filename, text, type = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }));
}
