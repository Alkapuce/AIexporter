import TurndownService, { type Node as TurndownNode } from "turndown";
import { gfm, tables } from "turndown-plugin-gfm";

function extractLanguageClass(code: Element | null): string {
  if (!code) return "";
  const className = code.getAttribute("class") ?? "";
  const match = className.match(/language-([\w-]+)/);
  return match?.[1] ?? "";
}

function extractKatexLatex(node: Element): string {
  const annotation = node.querySelector("annotation[encoding='application/x-tex']");
  if (annotation?.textContent?.trim()) {
    return annotation.textContent.trim();
  }

  return node.textContent?.trim() ?? "";
}

export function createMarkdownConverter(): TurndownService {
  const service = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    hr: "---",
  });

  service.use(gfm);
  service.use(tables);

  service.addRule("fencedPre", {
    filter: "pre",
    replacement: (_content: string, node: TurndownNode) => {
      const code = node.querySelector("code");
      const language = extractLanguageClass(code);
      const text = code?.textContent ?? node.textContent ?? "";
      return `\n\n\`\`\`${language}\n${text.trimEnd()}\n\`\`\`\n\n`;
    },
  });

  service.addRule("preserveLineBreaks", {
    filter: "br",
    replacement: () => "  \n",
  });

  service.addRule("katexDisplay", {
    filter: (node: TurndownNode) => {
      if (node.nodeType !== 1) return false;
      return (node as Element).classList.contains("katex-display");
    },
    replacement: (_content: string, node: TurndownNode) => {
      const latex = extractKatexLatex(node as Element);
      if (!latex) return "";
      return `\n\n$$\n${latex}\n$$\n\n`;
    },
  });

  service.addRule("katexInline", {
    filter: (node: TurndownNode) => {
      if (node.nodeType !== 1) return false;
      const element = node as Element;
      return element.classList.contains("katex") && !element.parentElement?.classList.contains("katex-display");
    },
    replacement: (_content: string, node: TurndownNode) => {
      const latex = extractKatexLatex(node as Element);
      if (!latex) return "";
      return `$${latex}$`;
    },
  });

  service.addRule("dropUiControls", {
    filter: (node: TurndownNode) => {
      if (node.nodeType !== 1) return false;
      const element = node as Element;
      return (
        element.tagName === "BUTTON" ||
        element.tagName === "SVG" ||
        element.tagName === "SCRIPT" ||
        element.tagName === "STYLE" ||
        element.matches("[aria-hidden='true']")
      );
    },
    replacement: () => "",
  });

  return service;
}
