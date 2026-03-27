declare const defineBackground: (handler: (...args: any[]) => any) => any;
declare const defineContentScript: (options: { matches: string[]; main: (...args: any[]) => any }) => any;
declare const defineUnlistedScript: (handler: (...args: any[]) => any) => any;
declare const injectScript: (path: string, options?: { keepInDom?: boolean }) => Promise<void>;

declare module "turndown-plugin-gfm" {
  export const gfm: (service: unknown) => void;
  export const tables: (service: unknown) => void;
}
