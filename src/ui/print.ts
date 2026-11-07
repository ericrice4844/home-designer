/** Fill a (new window's) document with a printable plan. Built with DOM APIs so names are never parsed as HTML. */
export function buildPrintDocument(doc: Document, projectName: string, imageUrl: string, autoPrint = true) {
  doc.title = `${projectName} – plan`;
  const style = doc.createElement('style');
  style.textContent = 'body{margin:16px;font-family:system-ui,sans-serif}img{max-width:100%}';
  doc.head.appendChild(style);
  const h = doc.createElement('h2');
  h.textContent = projectName;
  const img = doc.createElement('img');
  img.alt = `Floor plan of ${projectName}`;
  if (autoPrint) img.addEventListener('load', () => setTimeout(() => doc.defaultView?.print(), 200));
  img.src = imageUrl;
  doc.body.replaceChildren(h, img);
}
