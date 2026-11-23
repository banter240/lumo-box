/**
 * Shared <head>-tag insertion for served HTML pages. Both injection sites
 * (proxied app, settings page) must splice the same way or their first
 * synchronous invoke misses the transport.
 */

export function insertAfterHead(html: string, tag: string): string {
  const headOpen = /<head\b[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}
