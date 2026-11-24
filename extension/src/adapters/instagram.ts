import sel from "./instagram.selectors.json";
import type { PageCtx } from "./base";
import { createSeparatorAdapter } from "./separator";
import type { SiteAdapter } from "./types";

export const createInstagramAdapter = (ctx?: PageCtx): SiteAdapter =>
  createSeparatorAdapter({ platform: "instagram", hostname: "www.instagram.com", pathPrefix: "/direct/", chatPath: /^\/direct\/t\/([^/]+)/, sel }, ctx);
