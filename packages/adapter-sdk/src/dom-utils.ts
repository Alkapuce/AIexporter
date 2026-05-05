/**
 * Creates a sanitized deep clone of a DOM element, removing interactive
 * and non-content elements such as buttons, SVGs, scripts, and styles.
 *
 * @param element - The DOM element to clone and sanitize.
 * @param extraSelectors - Optional additional CSS selectors to remove from the clone.
 * @returns A sanitized deep clone of the element.
 */
export function sanitizeClone(element: HTMLElement, extraSelectors?: string[]): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, svg, script, style, textarea, select, input").forEach((node) => node.remove());
  if (extraSelectors && extraSelectors.length > 0) {
    clone.querySelectorAll(extraSelectors.join(",")).forEach((node) => node.remove());
  }
  return clone;
}
