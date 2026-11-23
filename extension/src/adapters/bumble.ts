import sel from "./bumble.selectors.json";
import type { PageCtx } from "./base";
import { createSeparatorAdapter } from "./separator";
import type { SiteAdapter } from "./types";

export const createBumbleAdapter = (ctx?: PageCtx): SiteAdapter =>
  createSeparatorAdapter({ platform: "bumble", hostname: "bumble.com", pathPrefix: "/app", chatPath: /^\/app\/connections\/([^/]+)/, sel }, ctx);
