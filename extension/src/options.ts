import "./theme.css";
import "./popup/popup.css";
import { getSettings, setKey, THEMES } from "./storage";

const root = document.getElementById("root")!;

/** Request access to the configured API origin (an optional host permission). */
export async function ensureOrigin(apiBase: string): Promise<boolean> {
  const origin = new URL(apiBase).origin + "/*";
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function main() {
  document.body.style.width = "auto";
  const s = await getSettings();
  document.documentElement.setAttribute("data-theme", s.theme);
  const field = (id: string, label: string, el: HTMLElement) => {
    const wrap = document.createElement("div");
    const l = document.createElement("label");
    l.className = "lbl";
    l.htmlFor = id;
    l.textContent = label;
    const f = document.createElement("div");
    f.className = "field";
    el.id = id;
    f.append(el);
    wrap.append(l, f);
    return wrap;
  };
  const api = document.createElement("input");
  api.type = "url";
  api.placeholder = "https://your-server.example";
  api.value = s.apiBase;
  const tok = document.createElement("input");
  tok.type = "password";
  tok.autocomplete = "off";
  tok.value = s.token;
  const theme = document.createElement("select");
  for (const t of THEMES) theme.append(new Option(t, t, false, t === s.theme));
  const status = document.createElement("div");
  status.className = "note";
  status.setAttribute("aria-live", "polite");
  const save = document.createElement("button");
  save.className = "btn pri";
  save.type = "button";
  save.textContent = "Save";
  save.addEventListener("click", async () => {
    let base = api.value.trim().replace(/\/+$/, "");
    if (base) {
      try {
        base = new URL(base).origin;
      } catch {
        status.textContent = "That is not a valid URL.";
        return;
      }
      if (!(await ensureOrigin(base))) {
        status.textContent = "Permission to reach that server was not granted.";
        return;
      }
    }
    await setKey("settings", { apiBase: base, token: tok.value.trim(), theme: theme.value });
    document.documentElement.setAttribute("data-theme", theme.value);
    status.textContent = "Saved.";
  });
  const title = document.createElement("h1");
  title.className = "t acc";
  title.textContent = "LVS ▸ OPTIONS";
  const box = document.createElement("section");
  box.className = "box";
  box.style.maxWidth = "420px";
  box.style.margin = "16px";
  box.append(
    title,
    field("api", "API base URL", api),
    field("token", "Extension token", tok),
    field("theme", "Theme", theme),
    save,
    status,
  );
  root.replaceChildren(box);
}
void main();
