import sel from "./grindr.selectors.json";
import type { PageCtx } from "./base";
import { createSeparatorAdapter } from "./separator";
import type { SiteAdapter } from "./types";

export const createGrindrAdapter = (ctx?: PageCtx): SiteAdapter =>
  createSeparatorAdapter({ platform: "grindr", hostname: "web.grindr.com", pathPrefix: "/messages", chatPath: /^\/messages\/([^/]+)/, sel }, ctx);
