import TurndownService, { type Node as TurndownNode } from "turndown";
import { gfm, tables } from "turndown-plugin-gfm";

function extractLanguageClass(code: Element | null): string {
  if (!code) return "";
  const className = code.getAttribute("class") ?? "";
  const match = className.match(/language-([\w-]+)/);
  return match?.[1] ?? "";
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
