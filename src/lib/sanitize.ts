// Note content is stored as small HTML fragments. Anything outside this short list is stripped
// before it is saved or shown, so pasted or imported content cannot run scripts.
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'CODE', 'A', 'BR']);

function clean(node: Node, out: Node): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(document.createTextNode(child.textContent ?? ''));
    } else if (child instanceof HTMLElement) {
      if (ALLOWED.has(child.tagName)) {
        const copy = document.createElement(child.tagName);
        if (child.tagName === 'A') {
          const href = child.getAttribute('href') ?? '';
          if (!/^(https?:|mailto:)/i.test(href)) {
            clean(child, out);
            return;
          }
          copy.setAttribute('href', href);
          copy.setAttribute('target', '_blank');
          copy.setAttribute('rel', 'noopener noreferrer');
        }
        clean(child, copy);
        out.appendChild(copy);
      } else if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(child.tagName)) {
        clean(child, out);
      }
    }
  });
}

export function sanitizeHtml(html: string): string {
  const source = document.createElement('template');
  source.innerHTML = html;
  const target = document.createElement('div');
  clean(source.content, target);
  return target.innerHTML;
}

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
