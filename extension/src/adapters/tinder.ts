import sel from "./tinder.selectors.json";
import type { PageCtx } from "./base";
import { createSeparatorAdapter } from "./separator";
import type { SiteAdapter } from "./types";

export const createTinderAdapter = (ctx?: PageCtx): SiteAdapter =>
  createSeparatorAdapter({ platform: "tinder", hostname: "tinder.com", pathPrefix: "/app/messages", chatPath: /^\/app\/messages\/([^/]+)/, sel }, ctx);
