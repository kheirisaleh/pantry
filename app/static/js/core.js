const Pantry = (() => {
  const state = {
    boot: null,
    user: null,
    online: navigator.onLine,
    mobile: false,
    listeners: new Set(),
  };

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === "class") el.className = value;
        else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
        else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === "html") el.innerHTML = value;
        else if (value === true) el.setAttribute(key, "");
        else el.setAttribute(key, value);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  const SVG = {
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.86l10.4-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 01-10 0c0-2.5 1.5-3.5 2-5 1 1.5 2 2 2 2s-1-3 1-7z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 002 1.6h7.7a2 2 0 002-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
  };

  function svg(name) {
    const span = document.createElement("span");
    span.style.display = "contents";
    span.innerHTML = SVG[name] || "";
    return span.firstChild;
  }

  function icon(name, cls, pending) {
    return h("img", {
      class: "ico" + (cls ? " " + cls : "") + (pending ? " pending" : ""),
      src: "/static/icons/" + (name || "package") + ".svg",
      alt: "",
      loading: "lazy",
      onerror: (event) => { event.target.src = "/static/icons/package.svg"; },
    });
  }

  function ingredientIcon(ingredient, cls) {
    return icon(ingredient && ingredient.icon, cls, ingredient && ingredient.status === "pending");
  }

  function names(entity, opts) {
    const display = entity.display || entity.name_en || entity.raw_name || entity.name || "?";
    const wrap = h("span", { class: "names" + (opts && opts.block ? " stack tight" : "") }, h("span", { class: "en" }, display));
    if (entity.name_fa && entity.name_fa !== display) wrap.append(" ", h("span", { class: "fa" }, "(", entity.name_fa, ")"));
    return wrap;
  }

  function qty(value, unit) {
    if (value === null || value === undefined) return "";
    const number = Number(value);
    if (unit === "pcs") return trim(number, number < 10 ? 1 : 0) + " pcs";
    if (UNIT_LABELS[unit] && !["g", "ml"].includes(unit)) return trim(number, 1) + " " + UNIT_LABELS[unit];
    if (number >= 1000) return trim(number / 1000, 2) + (unit === "g" ? " kg" : " l");
    return trim(number, number < 10 ? 1 : 0) + " " + unit;
  }

  function trim(number, digits) {
    return String(Number(number.toFixed(digits)));
  }

  function money(value) {
    if (value === null || value === undefined || value === "") return "";
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value));
  }

  function parseNumber(text) {
    if (text === null || text === undefined) return null;
    const cleaned = String(text).trim().replace(/\s/g, "").replace(",", ".");
    if (!cleaned) return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function iso(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function fromIso(text) {
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(text, days) {
    const date = fromIso(text);
    date.setDate(date.getDate() + days);
    return iso(date);
  }

  function monday(text) {
    const date = fromIso(text);
    const shift = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - shift);
    return iso(date);
  }

  function today() {
    return (state.boot && state.boot.today) || iso(new Date());
  }

  function dayLabel(text, style) {
    const date = fromIso(text);
    if (text === today()) return "Today";
    if (text === addDays(today(), 1)) return "Tomorrow";
    if (text === addDays(today(), -1)) return "Yesterday";
    return date.toLocaleDateString("en-GB", style || { weekday: "short", day: "numeric", month: "short" });
  }

  function shortDate(text) {
    return fromIso(text.slice(0, 10)).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  }

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem("pantry:" + key) || "null");
      localStorage.setItem("pantry:" + key, JSON.stringify(value));
    } catch (error) {
      return null;
    }
    return value;
  }

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  function headers(extra) {
    const result = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (state.user) result["X-User-Id"] = String(state.user.id);
    return result;
  }

  async function get(path) {
    try {
      const response = await fetch(path, { headers: headers(), cache: "no-store" });
      if (!response.ok) throw new ApiError(await errorText(response), response.status);
      const data = await response.json();
      setOnline(true);
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      setOnline(false);
      const cached = await cachedGet(path);
      if (cached !== undefined) return cached;
      throw new ApiError("You are offline and this page has not been loaded before.", 0);
    }
  }

  async function cachedGet(path) {
    if (!("caches" in window)) return undefined;
    try {
      const match = await caches.match(new URL(path, location.origin).toString(), { ignoreVary: true });
      if (match) return await match.json();
    } catch (error) {
      return undefined;
    }
    return undefined;
  }

  async function errorText(response) {
    try {
      const data = await response.json();
      return data.error || data.detail || "Request failed (" + response.status + ")";
    } catch (error) {
      return "Request failed (" + response.status + ")";
    }
  }

  async function send(method, path, body, opId) {
    const response = await fetch(path, {
      method,
      headers: headers({ "X-Op-Id": opId || uid() }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new ApiError(await errorText(response), response.status);
    setOnline(true);
    return response.json();
  }

  async function mutate(method, path, body, options) {
    const opId = uid();
    if (options && options.offline && queue().length) {
      enqueue({ method, path, body, opId, temp: options.temp, user: state.user && state.user.id });
      return { queued: true };
    }
    try {
      return await send(method, path, body, opId);
    } catch (error) {
      if (error instanceof ApiError) {
        toast(error.message, true);
        throw error;
      }
      setOnline(false);
      if (options && options.offline) {
        enqueue({ method, path, body, opId, temp: options.temp, user: state.user && state.user.id });
        return { queued: true };
      }
      toast("You are offline. Try again when connected.", true);
      throw error;
    }
  }

  function queue() {
    return store("queue") || [];
  }

  function enqueue(entry) {
    const items = queue();
    items.push(entry);
    store("queue", items);
    renderOffline();
  }

  let flushing = false;
  async function flush() {
    if (flushing) return;
    let items = queue();
    if (!items.length) return;
    flushing = true;
    const temps = store("temps") || {};
    try {
      while (items.length) {
        const entry = items[0];
        let path = entry.path;
        for (const [temp, real] of Object.entries(temps)) path = path.split(temp).join(String(real));
        let body = entry.body;
        if (body && body.session_id && temps[body.session_id]) body = Object.assign({}, body, { session_id: temps[body.session_id] });
        if (/\/tmp-/.test(path)) {
          items.shift();
          store("queue", items);
          continue;
        }
        const previous = state.user;
        if (entry.user) state.user = (state.boot && state.boot.users.find((user) => user.id === entry.user)) || previous;
        let result;
        try {
          result = await send(entry.method, path, body, entry.opId);
        } catch (error) {
          state.user = previous;
          if (error instanceof ApiError) {
            toast("A saved change could not be applied: " + error.message, true);
            items.shift();
            store("queue", items);
            continue;
          }
          throw error;
        }
        state.user = previous;
        if (entry.temp) {
          const real = result.item_id || result.session_id;
          if (real) temps[entry.temp] = real;
          store("temps", temps);
        }
        items.shift();
        store("queue", items);
      }
      store("temps", {});
      emit("synced");
    } catch (error) {
      setOnline(false);
    } finally {
      flushing = false;
      renderOffline();
    }
  }

  function setOnline(value) {
    if (state.online === value) return;
    state.online = value;
    renderOffline();
    if (value) flush();
  }

  let offlinePill = null;
  function renderOffline() {
    const pending = queue().length;
    const show = !state.online || pending;
    if (!show) {
      if (offlinePill) offlinePill.remove();
      offlinePill = null;
      return;
    }
    if (!offlinePill) {
      offlinePill = h("div", { class: "offline-pill", role: "status" });
      document.body.appendChild(offlinePill);
    }
    offlinePill.textContent = state.online
      ? "Syncing " + pending + " saved change" + (pending === 1 ? "" : "s")
      : "Offline" + (pending ? ", " + pending + " change" + (pending === 1 ? "" : "s") + " waiting" : "");
  }

  window.addEventListener("online", () => { state.online = true; renderOffline(); flush(); });
  window.addEventListener("offline", () => { state.online = false; renderOffline(); });
  setInterval(() => { if (queue().length) flush(); }, 15000);

  function on(fn) {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  }

  function emit(event, detail) {
    for (const fn of state.listeners) fn(event, detail);
  }

  let toastHost = null;
  function toast(message, bad) {
    if (!toastHost) {
      toastHost = h("div", { class: "toast-host", "aria-live": "polite" });
      document.body.appendChild(toastHost);
    }
    const el = h("div", { class: "toast" + (bad ? " bad" : "") }, message);
    toastHost.appendChild(el);
    setTimeout(() => el.remove(), bad ? 5200 : 2600);
  }

  let scrollLocks = 0;
  let lockedScroll = 0;
  function lockScroll() {
    scrollLocks += 1;
    if (scrollLocks > 1) return;
    lockedScroll = window.scrollY;
    document.documentElement.classList.add("scroll-locked");
    if (state.mobile) document.body.style.top = -lockedScroll + "px";
  }
  function unlockScroll() {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks) return;
    document.documentElement.classList.remove("scroll-locked");
    if (state.mobile) {
      document.body.style.top = "";
      window.scrollTo(0, lockedScroll);
    }
  }

  function openSheet({ title, subtitle, body, footer, wide, onClose }) {
    const previousFocus = document.activeElement;
    const closeButton = h("button", { class: "btn icon ghost", "aria-label": "Close" }, svg("close"));
    const titleNode = typeof title === "string" ? h("h3", null, title) : title;
    const sheet = h("div", { class: "sheet" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true" },
      h("header", null, h("div", { class: "grow" }, titleNode, subtitle ? h("div", { class: "muted" }, subtitle) : null), closeButton),
      h("div", { class: "body" }, body),
      footer ? h("footer", null, footer) : null,
    );
    const overlay = h("div", { class: "overlay" }, sheet);
    let closed = false;
    lockScroll();
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      overlay.classList.add("closing");
      const done = () => {
        overlay.remove();
        unlockScroll();
        if (onClose) onClose();
        if (previousFocus && previousFocus.focus && !state.mobile) previousFocus.focus();
      };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) done();
      else setTimeout(done, 200);
    }
    if (state.mobile) {
      const handle = sheet.querySelector("header");
      let startY = null;
      let delta = 0;
      handle.addEventListener("touchstart", (event) => { startY = event.touches[0].clientY; delta = 0; sheet.style.transition = "none"; }, { passive: true });
      handle.addEventListener("touchmove", (event) => {
        if (startY === null) return;
        delta = Math.max(0, event.touches[0].clientY - startY);
        sheet.style.transform = "translateY(" + delta + "px)";
      }, { passive: true });
      handle.addEventListener("touchend", () => {
        sheet.style.transition = "";
        if (delta > 110) { sheet.style.transform = "translateY(100%)"; close(); }
        else sheet.style.transform = "";
        startY = null;
      });
    }
    function onKey(event) {
      if (event.key !== "Escape") return;
      const all = document.querySelectorAll(".overlay");
      if (all[all.length - 1] === overlay) close();
    }
    closeButton.addEventListener("click", close);
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    const focusable = sheet.querySelector("input, select, textarea");
    if (focusable && !state.mobile) setTimeout(() => focusable.focus(), 60);
    return { close, sheet, setFooter: (nodes) => { const f = sheet.querySelector("footer"); if (f) append(clear(f), [nodes]); } };
  }

  function confirmSheet(title, text, action, danger) {
    return new Promise((resolve) => {
      let done = false;
      const sheet = openSheet({
        title,
        body: h("p", { class: "soft" }, text),
        onClose: () => { if (!done) resolve(false); },
        footer: [
          h("button", { class: "btn ghost", onclick: () => sheet.close() }, "Cancel"),
          h("button", { class: "btn " + (danger ? "danger" : "primary"), onclick: () => { done = true; sheet.close(); resolve(true); } }, action),
        ],
      });
    });
  }

  const UNIT_LABELS = { g: "g", ml: "ml", pcs: "pcs", jar: "jar", can: "can", pack: "pack", tbsp: "tbsp", tsp: "tsp" };
  const RECIPE_UNITS = ["g", "ml", "pcs", "jar", "can", "pack", "tbsp", "tsp"];

  function unitSelect(value, onChange) {
    const select = h("select", { class: "input unit-select", "aria-label": "Unit" },
      RECIPE_UNITS.map((unit) => h("option", { value: unit, selected: unit === value }, UNIT_LABELS[unit])));
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function shopUnitSelect(value, onChange) {
    const select = h("select", { class: "input unit-select", "aria-label": "Unit" },
      ["g", "kg", "ml", "l", "pcs", "pack"].map((unit) => h("option", { value: unit, selected: unit === value }, unit)));
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function unitToggle(value, onChange, units) {
    const wrap = h("div", { class: "unit-toggle", role: "group", "aria-label": "Unit" });
    let current = value;
    for (const unit of units || ["g", "ml", "pcs"]) {
      const button = h("button", { type: "button", "aria-pressed": String(unit === current) }, unit);
      button.addEventListener("click", () => {
        current = unit;
        for (const other of wrap.children) other.setAttribute("aria-pressed", String(other === button));
        onChange(unit);
      });
      wrap.appendChild(button);
    }
    wrap.value = () => current;
    return wrap;
  }

  function ingredientPicker({ placeholder, onPick, keepText, autofocus }) {
    const input = h("input", { class: "input", placeholder: placeholder || "Type any name, in any language", autocomplete: "off", autocapitalize: "none", spellcheck: "false" });
    const menu = h("div", { class: "picker-menu hidden", role: "listbox" });
    const wrap = h("div", { class: "picker" }, input, menu);
    let results = [];
    let active = 0;
    let timer = null;
    let seq = 0;
    function render() {
      clear(menu);
      const text = input.value.trim();
      if (!text) { menu.classList.add("hidden"); return; }
      results.forEach((entry, index) => {
        menu.appendChild(h("button", {
          type: "button", role: "option", "aria-selected": String(index === active),
          onmousedown: (event) => { event.preventDefault(); choose(index); },
        }, ingredientIcon(entry, "sm"), h("span", { class: "grow ellipsis" }, names(entry)), entry.stock ? h("span", { class: "muted num" }, qty(entry.stock, entry.unit)) : null));
      });
      menu.appendChild(h("button", {
        type: "button", role: "option", "aria-selected": String(active === results.length),
        onmousedown: (event) => { event.preventDefault(); choose(results.length); },
      }, icon("package", "sm"), h("span", { class: "grow" }, "Add “" + text + "” as new")));
      menu.classList.remove("hidden");
    }
    function choose(index) {
      const text = input.value.trim();
      if (!text) return;
      const entry = results[index];
      onPick(entry ? { ingredient_id: entry.id, ingredient: entry, name: text } : { name: text });
      if (!keepText) input.value = "";
      results = [];
      menu.classList.add("hidden");
    }
    input.addEventListener("input", () => {
      clearTimeout(timer);
      active = 0;
      const text = input.value.trim();
      if (!text) { results = []; render(); return; }
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const found = await get("/api/ingredients/search?q=" + encodeURIComponent(text));
          if (mine === seq) { results = found; render(); }
        } catch (error) {
          results = [];
          render();
        }
      }, 140);
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { active = Math.min(results.length, active + 1); render(); event.preventDefault(); }
      else if (event.key === "ArrowUp") { active = Math.max(0, active - 1); render(); event.preventDefault(); }
      else if (event.key === "Enter") { event.preventDefault(); choose(active); }
      else if (event.key === "Escape" && !menu.classList.contains("hidden")) { menu.classList.add("hidden"); event.stopPropagation(); }
    });
    input.addEventListener("blur", () => setTimeout(() => menu.classList.add("hidden"), 120));
    if (autofocus) setTimeout(() => input.focus(), 80);
    wrap.input = input;
    return wrap;
  }

  function plate(recipe, opts) {
    const node = h("div", { class: "plate" + (opts && opts.cooked ? " cooked" : "") + (opts && opts.short ? " short" : ""), style: { width: (opts && opts.size) || "64px" } });
    if (recipe && recipe.image_path) node.appendChild(h("img", { src: recipe.image_path, alt: "", loading: "lazy" }));
    else node.appendChild(icon("shallow-pan-of-food"));
    return node;
  }

  function recipeEditor(existing, onSaved) {
    const data = {
      name: existing ? existing.raw_name : "",
      slots: existing ? existing.slots.map((slot) => ({
        optional: slot.items.some((item) => item.optional),
        items: slot.items.map((item) => ({ ingredient_id: item.ingredient_id, ingredient: item.ingredient, amount: item.amount, unit: item.unit, is_default: !!item.is_default, per_dish: !!item.per_dish })),
      })) : [],
    };
    const nameInput = h("input", { class: "input", placeholder: "Dish name, any language. For example loobia polo", value: data.name });
    const slotsHost = h("div", { class: "stack" });
    const adder = ingredientPicker({ placeholder: "Add an ingredient. Type in Persian, Finglish, German or English", onPick: (picked) => {
      data.slots.push({ optional: false, items: [{ ingredient_id: picked.ingredient_id, ingredient: picked.ingredient, name: picked.name, amount: "", unit: (picked.ingredient && picked.ingredient.unit) || "g", is_default: true }] });
      renderSlots();
      const inputs = slotsHost.querySelectorAll("input.amount");
      if (inputs.length) inputs[inputs.length - 1].focus();
    } });

    function renderSlots() {
      clear(slotsHost);
      if (!data.slots.length) {
        slotsHost.appendChild(h("p", { class: "muted" }, "Add each ingredient with the amount one person needs. The rest is filled in automatically."));
      }
      data.slots.forEach((slot, slotIndex) => {
        const card = h("div", { class: "slot-card" + (slot.optional ? " optional" : "") });
        slot.items.forEach((item, itemIndex) => {
          const amount = h("input", { class: "input num amount", inputmode: "decimal", placeholder: item.per_dish ? "whole dish" : "per person", value: item.amount === "" ? "" : String(item.amount) });
          amount.addEventListener("input", () => { item.amount = parseNumber(amount.value); });
          const label = item.ingredient ? names(item.ingredient) : h("span", null, item.name, " ", h("span", { class: "chip" }, "new"));
          const line = h("div", { class: "alt-line" },
            h("span", { class: "al-icon" }, item.ingredient ? ingredientIcon(item.ingredient) : icon("package", null, true)),
            h("div", { class: "stack tight al-name", style: { minWidth: 0 } },
              h("div", { class: "ellipsis" }, slot.items.length > 1 && itemIndex > 0 ? h("span", { class: "or" }, "or ") : null, label),
              slot.items.length > 1 ? h("label", { class: "row muted", style: { fontSize: "var(--s-1)", gap: "6px" } },
                h("input", { type: "radio", name: "default-" + slotIndex, checked: item.is_default, onchange: () => { slot.items.forEach((other) => { other.is_default = other === item; }); } }),
                "Planned by default") : null,
            ),
            h("span", { class: "al-amount" }, amount),
            h("span", { class: "al-unit" }, unitSelect(item.unit, (unit) => {
              item.unit = unit;
              const ingredient = item.ingredient || {};
              if (["jar", "can", "pack"].includes(unit) && !ingredient.package_amount) toast("Set how much one " + unit + " holds in this ingredient's details so the shopping list can count it", false);
            })),
            h("label", { class: "row muted al-whole", style: { fontSize: "var(--s-1)", gap: "4px", whiteSpace: "nowrap" }, title: "Use this amount for the whole dish, not per person" },
              h("input", { type: "checkbox", checked: item.per_dish, onchange: (event) => { item.per_dish = event.target.checked; amount.placeholder = item.per_dish ? "whole dish" : "per person"; } }),
              "Whole dish"),
            h("button", { class: "btn icon small ghost al-del", type: "button", "aria-label": "Remove", onclick: () => {
              slot.items.splice(itemIndex, 1);
              if (!slot.items.length) data.slots.splice(slotIndex, 1);
              else if (!slot.items.some((other) => other.is_default)) slot.items[0].is_default = true;
              renderSlots();
            } }, svg("trash")),
          );
          card.appendChild(line);
        });
        const altPicker = ingredientPicker({ placeholder: "Or use instead", onPick: (picked) => {
          slot.items.push({ ingredient_id: picked.ingredient_id, ingredient: picked.ingredient, name: picked.name, amount: "", unit: (picked.ingredient && picked.ingredient.unit) || "g", is_default: false });
          renderSlots();
        } });
        altPicker.classList.add("hidden");
        card.appendChild(h("div", { class: "row wrap" },
          h("label", { class: "row muted", style: { fontSize: "var(--s-1)", gap: "6px" } },
            h("input", { type: "checkbox", checked: slot.optional, onchange: (event) => { slot.optional = event.target.checked; card.classList.toggle("optional", slot.optional); } }),
            "Optional side"),
          h("button", { class: "btn small ghost", type: "button", onclick: () => { altPicker.classList.remove("hidden"); altPicker.input.focus(); } }, "Add an alternative"),
        ));
        card.appendChild(altPicker);
        slotsHost.appendChild(card);
      });
    }
    renderSlots();

    const saveButton = h("button", { class: "btn primary" }, existing ? "Save dish" : "Add dish");
    const sheet = openSheet({
      title: existing ? "Edit dish" : "New dish",
      subtitle: "Amounts are for one person. English name, Persian name, photo and nutrition are added for you.",
      wide: true,
      body: h("div", { class: "stack" },
        h("label", { class: "field" }, h("span", null, "Dish"), nameInput),
        h("div", { class: "field" }, h("span", null, "Ingredients"), slotsHost, adder),
      ),
      footer: [h("button", { class: "btn ghost", onclick: () => sheet.close() }, "Cancel"), saveButton],
    });
    saveButton.addEventListener("click", async () => {
      const payload = {
        name: nameInput.value.trim(),
        slots: data.slots.map((slot) => ({
          optional: slot.optional,
          items: slot.items.map((item) => ({ ingredient_id: item.ingredient_id, name: item.name, amount: item.amount, unit: item.unit, is_default: item.is_default, per_dish: !!item.per_dish })),
        })),
      };
      if (!payload.name) { toast("Give the dish a name", true); return; }
      if (!payload.slots.length) { toast("Add at least one ingredient", true); return; }
      if (payload.slots.some((slot) => slot.items.some((item) => !item.amount || item.amount <= 0))) { toast("Every ingredient needs an amount", true); return; }
      saveButton.disabled = true;
      try {
        const saved = existing
          ? await mutate("PUT", "/api/recipes/" + existing.id, payload)
          : await mutate("POST", "/api/recipes", payload);
        sheet.close();
        toast(existing ? "Dish saved" : "Dish added");
        emit("changed");
        if (onSaved) onSaved(saved);
      } catch (error) {
        saveButton.disabled = false;
      }
    });
  }

  function imageChooser(recipe, onDone) {
    const body = h("div", { class: "stack" });
    const sheet = openSheet({ title: "Pick a photo", subtitle: recipe.display, body, wide: true });
    function render(current) {
      clear(body);
      const candidates = current.image_candidates || [];
      if (current.image_status === "searching") {
        body.appendChild(h("div", { class: "empty" }, icon("fork-and-knife-with-plate"), "Looking for photos..."));
        return;
      }
      if (!candidates.length) {
        body.appendChild(h("div", { class: "empty" }, current.image_path ? "A photo is already chosen. Search again to see other options." : "No photos found yet."));
      } else {
        body.appendChild(h("div", { class: "image-grid" }, candidates.map((candidate, index) =>
          h("button", { type: "button", onclick: async () => {
            try {
              await mutate("POST", "/api/recipes/" + recipe.id + "/images/choose", { index });
              toast("Photo saved");
              sheet.close();
              emit("changed");
              if (onDone) onDone();
            } catch (error) {
              return;
            }
          } }, h("img", { src: candidate.thumb, alt: "", loading: "lazy" }), h("small", null, candidate.source)))));
      }
      body.appendChild(h("div", { class: "row" }, h("button", { class: "btn small", onclick: async () => {
        const updated = await mutate("POST", "/api/recipes/" + recipe.id + "/images/refresh");
        render(updated);
        poll();
      } }, svg("refresh"), "Search again")));
    }
    let timer = null;
    function poll() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!document.body.contains(body)) return;
        const fresh = await get("/api/recipes/" + recipe.id);
        render(fresh);
        if (fresh.image_status === "searching") poll();
      }, 4000);
    }
    render(recipe);
    if (recipe.image_status === "searching") poll();
  }

  async function cookSheet({ meal, recipeId, date, onDone }) {
    let preview;
    try {
      preview = await mutate("POST", "/api/cook/preview", { meal_id: meal && meal.id, recipe_id: recipeId || (meal && meal.recipe_id) });
    } catch (error) {
      return;
    }
    const recipe = preview.recipe;
    let servings = preview.servings;
    let choices = Object.assign({}, preview.choices);
    let optional = (preview.optional_items || []).map(Number);
    const overrides = {};
    const linesHost = h("div");
    const optionsHost = h("div", { class: "stack" });
    const servingsInput = h("input", { class: "input num", inputmode: "decimal", value: String(servings), style: { width: "90px" } });

    async function refresh() {
      const fresh = await mutate("POST", "/api/cook/preview", {
        meal_id: meal && meal.id, recipe_id: recipe.id, servings, choices, optional_items: optional,
      });
      preview = fresh;
      renderLines();
    }

    function renderOptions() {
      clear(optionsHost);
      for (const slot of recipe.slots) {
        if (slot.items.length > 1) {
          const selected = String(choices[slot.slot] || (slot.items.find((item) => item.is_default) || slot.items[0]).id);
          optionsHost.appendChild(h("div", { class: "row wrap" }, slot.items.map((item) =>
            h("button", { class: "chip" + (String(item.id) === selected ? " warn" : ""), type: "button", onclick: () => {
              choices[slot.slot] = item.id;
              renderOptions();
              refresh();
            } }, item.ingredient.display))));
        }
        const optionalItem = slot.items.find((item) => item.optional);
        if (optionalItem) {
          const isOn = optional.includes(optionalItem.id);
          optionsHost.appendChild(h("label", { class: "row" },
            h("input", { type: "checkbox", checked: isOn, onchange: (event) => {
              optional = event.target.checked ? optional.concat([optionalItem.id]) : optional.filter((id) => id !== optionalItem.id);
              refresh();
            } }), "Also made ", names(optionalItem.ingredient)));
        }
      }
    }

    function renderLines() {
      clear(linesHost);
      for (const line of preview.lines) {
        const input = h("input", { class: "input num", inputmode: "decimal", value: trim(overrides[line.ingredient_id] !== undefined ? overrides[line.ingredient_id] : line.qty, 1), style: { width: "96px" } });
        input.addEventListener("change", () => {
          const value = parseNumber(input.value);
          if (value === null) delete overrides[line.ingredient_id];
          else overrides[line.ingredient_id] = value;
        });
        const short = line.stock + 0.001 < (overrides[line.ingredient_id] !== undefined ? overrides[line.ingredient_id] : line.qty);
        linesHost.appendChild(h("div", { class: "list-row" },
          icon(line.icon), h("div", { class: "grow" }, names(line), h("div", { class: "muted num", style: { fontSize: "var(--s-1)" } }, "In pantry ", qty(line.stock, line.unit))),
          short ? h("span", { class: "chip bad" }, "short") : null,
          input, h("span", { class: "muted", style: { width: "28px" } }, line.unit)));
      }
      if (preview.unconvertible.length) linesHost.appendChild(h("p", { class: "muted" }, "Not counted yet: ", preview.unconvertible.join(", ")));
    }

    servingsInput.addEventListener("change", () => {
      const value = parseNumber(servingsInput.value);
      if (value && value > 0) { servings = value; refresh(); }
    });
    renderOptions();
    renderLines();
    const confirm = h("button", { class: "btn primary" }, svg("flame"), "Cooked it");
    const sheet = openSheet({
      title: h("div", { class: "row" }, plate(recipe, { size: "54px" }), h("div", null, h("h3", null, recipe.display), recipe.name_fa ? h("div", { class: "fa" }, recipe.name_fa) : null)),
      subtitle: null,
      body: h("div", { class: "stack" },
        h("div", { class: "row" }, h("span", { class: "soft" }, "People"), servingsInput),
        optionsHost,
        h("div", null, h("h4", { style: { marginBottom: "4px" } }, "Taken from the pantry"), h("p", { class: "muted", style: { fontSize: "var(--s-1)" } }, "Change an amount only if you used a different quantity."), linesHost),
      ),
      footer: [h("button", { class: "btn ghost", onclick: () => sheet.close() }, "Cancel"), confirm],
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const result = await mutate("POST", "/api/cook", {
          meal_id: meal && meal.id, recipe_id: recipe.id, date: date || (meal && meal.date) || today(), servings, choices, optional_items: optional,
          overrides: Object.keys(overrides).length ? overrides : undefined,
        });
        sheet.close();
        toast(result.shortfalls && result.shortfalls.length ? "Cooked. Some items were not in the pantry." : "Cooked and pantry updated");
        emit("changed");
        if (onDone) onDone(result);
      } catch (error) {
        confirm.disabled = false;
      }
    });
  }

  async function suggestSheet({ date, meal, onDone }) {
    const body = h("div", { class: "stack" }, h("p", { class: "muted" }, "Checking the pantry"));
    const servingsInput = h("input", { class: "input num", inputmode: "decimal", value: String((meal && meal.servings) || (state.boot && state.boot.default_servings) || 2), style: { width: "80px" } });
    const sheet = openSheet({
      title: meal ? "Change " + dayLabel(date).toLowerCase() + "'s dish" : "What to eat " + (date === today() ? "today" : dayLabel(date)),
      subtitle: "Dishes you can make with what is at home come first, and the ones that keep the rest of your plan intact before the others.",
      wide: true,
      body: h("div", { class: "stack" }, h("div", { class: "row" }, h("span", { class: "soft" }, "People"), servingsInput), body),
    });
    let servings = parseNumber(servingsInput.value) || 2;
    async function load() {
      const data = await get("/api/suggestions?date=" + date + "&servings=" + servings + (meal ? "&meal_id=" + meal.id : ""));
      clear(body);
      if (!data.suggestions.length) {
        body.appendChild(h("div", { class: "empty" }, icon("cooking"), "No dishes yet.", h("button", { class: "btn primary", onclick: () => { sheet.close(); recipeEditor(null); } }, "Add your first dish")));
        return;
      }
      let lastTier = -1;
      const titles = ["Ready to cook", "Possible, but takes from a later planned dish", "Missing something"];
      for (const entry of data.suggestions) {
        if (entry.tier !== lastTier) {
          body.appendChild(h("div", { class: "group-title" }, titles[entry.tier]));
          lastTier = entry.tier;
        }
        const plan = h("button", { class: "btn small" }, meal ? "Use this" : "Plan");
        const cookNow = h("button", { class: "btn small primary" }, svg("flame"), "Cook");
        plan.addEventListener("click", async () => {
          if (meal) await mutate("PATCH", "/api/meals/" + meal.id, { recipe_id: entry.recipe_id, servings });
          else await mutate("POST", "/api/meals", { date, recipe_id: entry.recipe_id, servings });
          sheet.close();
          toast("Planned for " + dayLabel(date).toLowerCase());
          emit("changed");
          if (onDone) onDone();
        });
        cookNow.addEventListener("click", async () => {
          sheet.close();
          if (meal) await mutate("PATCH", "/api/meals/" + meal.id, { recipe_id: entry.recipe_id, servings });
          cookSheet({ meal: meal ? Object.assign({}, meal, { recipe_id: entry.recipe_id }) : null, recipeId: entry.recipe_id, date, onDone });
        });
        body.appendChild(h("div", { class: "list-row" },
          plate(entry, { size: "52px", short: entry.tier === 2 }),
          h("div", { class: "grow" },
            h("div", null, names(entry)),
            h("div", { class: "row wrap", style: { marginTop: "4px", gap: "6px" } },
              entry.shortages.slice(0, 4).map((short) => h("span", { class: "chip bad" }, short.display, " ", qty(short.missing, short.unit))),
              entry.breaks ? h("span", { class: "chip warn" }, "Affects " + entry.breaks + " planned dish" + (entry.breaks > 1 ? "es" : "")) : null,
              entry.last_cooked ? h("span", { class: "chip" }, "Last cooked " + shortDate(entry.last_cooked)) : null,
            )),
          h("div", { class: "row" }, plan, date <= today() ? cookNow : null)));
      }
    }
    servingsInput.addEventListener("change", () => { servings = parseNumber(servingsInput.value) || 2; load(); });
    load().catch((error) => { clear(body).appendChild(h("p", { class: "bad" }, error.message)); });
  }

  async function ingredientSheet(id, onDone) {
    const ingredient = await get("/api/ingredients/" + id);
    const body = h("div", { class: "stack" });
    const fields = {};
    function field(label, key, type, extra) {
      const value = ingredient[key];
      let input;
      if (type === "select") {
        input = h("select", { class: "input" }, extra.map((option) => h("option", { value: option, selected: option === value }, option)));
      } else if (type === "check") {
        input = h("input", { type: "checkbox", checked: !!value });
      } else {
        input = h("input", { class: "input" + (type === "number" ? " num" : ""), inputmode: type === "number" ? "decimal" : null, value: value === null || value === undefined ? "" : String(value), dir: key === "name_fa" ? "rtl" : null });
      }
      fields[key] = { input, type };
      return h("label", { class: "field" }, h("span", null, label), input);
    }
    const nutritionUnit = ingredient.unit === "pcs" ? "per piece" : "per 100 " + ingredient.unit;
    const stockActions = h("div", { class: "row wrap" },
      h("button", { class: "btn small", onclick: async () => {
        await mutate("POST", "/api/inventory/" + id + "/used-up");
        toast("Marked as used up");
        sheet.close();
        emit("changed");
      } }, "Used up"),
      h("button", { class: "btn small", onclick: () => adjustSheet(ingredient, "waste", () => { sheet.close(); emit("changed"); }) }, "Threw some away"),
      h("button", { class: "btn small", onclick: () => adjustSheet(ingredient, "count", () => { sheet.close(); emit("changed"); }) }, "Set real amount"),
      h("button", { class: "btn small", onclick: () => adjustSheet(ingredient, "add", () => { sheet.close(); emit("changed"); }) }, "Add stock"),
    );
    append(body, [
      h("div", { class: "row" }, ingredientIcon(ingredient, "xl"), h("div", { class: "grow" },
        h("h3", null, ingredient.display), ingredient.name_fa ? h("div", { class: "fa" }, ingredient.name_fa) : null,
        h("div", { class: "row wrap", style: { marginTop: "6px" } },
          h("span", { class: "chip" }, ingredient.category), h("span", { class: "chip" }, ingredient.kind),
          ingredient.status === "pending" ? h("span", { class: "chip warn" }, "Details on the way") : null,
          ingredient.status === "unresolved" ? h("span", { class: "chip bad" }, "Not recognised, edit by hand") : null),
      )),
      ingredient.ai_error && ingredient.status !== "ready" ? h("p", { class: "muted" }, ingredient.ai_error) : null,
      h("div", { class: "panel", style: { padding: "14px" } },
        h("div", { class: "spread" }, h("div", null, h("div", { class: "muted" }, "In the pantry"), h("b", { class: "num", style: { fontSize: "var(--s2)", fontFamily: "var(--display)" } }, qty(ingredient.stock, ingredient.unit))), stockActions)),
    ]);
    if (ingredient.prices && ingredient.prices.length) {
      body.appendChild(h("div", null, h("h4", null, "Prices paid"), ingredient.prices.slice(-6).reverse().map((entry) =>
        h("div", { class: "list-row" }, h("span", { class: "grow" }, shortDate(entry.date), " ", h("span", { class: "muted" }, entry.store || "")),
          h("span", { class: "num soft" }, qty(entry.qty, ingredient.unit)), h("b", { class: "num" }, money(entry.price)),
          h("span", { class: "muted num" }, money(entry.unit_price), ingredient.unit === "pcs" ? "/pc" : (ingredient.unit === "g" ? "/kg" : "/l"))))));
    }
    const units = ["g", "ml", "pcs"];
    body.appendChild(h("details", null, h("summary", { class: "btn ghost small" }, "Edit details"),
      h("div", { class: "stack", style: { marginTop: "10px" } },
        h("div", { class: "row wrap" }, field("English", "name_en"), field("Persian", "name_fa"), field("German", "name_de")),
        h("div", { class: "row wrap" }, field("Category", "category", "select", state.boot.categories), field("Kind", "kind", "select", ["food", "snack", "staple", "household"]), field("Base unit", "unit", "select", units)),
        h("div", { class: "row wrap" }, field("Bought per piece", "sold_by_piece", "check"), field("Weight of one piece (g or ml)", "piece_amount", "number"), field("One jar, can or pack holds (base unit)", "package_amount", "number"), field("Extra to buy (%)", "tolerance_pct", "number"), field("Keeps for days", "shelf_days", "number")),
        h("div", { class: "muted" }, "Nutrition " + nutritionUnit),
        h("div", { class: "row wrap" }, field("kcal", "kcal", "number"), field("Protein g", "protein", "number"), field("Fat g", "fat", "number"), field("Carbs g", "carbs", "number"), field("Fiber g", "fiber", "number")),
        h("div", { class: "row" }, h("button", { class: "btn primary small", onclick: save }, "Save details"),
          ingredient.status !== "ready" ? h("button", { class: "btn small", onclick: async () => { await mutate("POST", "/api/ingredients/" + id + "/retry"); toast("Asked again"); sheet.close(); emit("changed"); } }, svg("refresh"), "Ask again") : null,
          h("button", { class: "btn small ghost danger", onclick: async () => {
            if (await confirmSheet("Archive " + ingredient.display + "?", "It disappears from lists and planning. Past records stay.", "Archive", true)) {
              await mutate("POST", "/api/ingredients/" + id + "/archive", { archived: true });
              sheet.close();
              emit("changed");
            }
          } }, "Archive")),
      )));
    async function save() {
      const payload = {};
      for (const [key, { input, type }] of Object.entries(fields)) {
        if (type === "check") payload[key] = input.checked ? 1 : 0;
        else if (type === "number") payload[key] = parseNumber(input.value);
        else payload[key] = input.value.trim() || null;
      }
      await mutate("PATCH", "/api/ingredients/" + id, payload);
      toast("Saved");
      sheet.close();
      emit("changed");
      if (onDone) onDone();
    }
    const sheet = openSheet({ title: "Ingredient", body, wide: true });
  }

  function adjustSheet(ingredient, mode, onDone) {
    const amount = h("input", { class: "input num", inputmode: "decimal", placeholder: mode === "waste" ? "all" : "", value: mode === "count" ? trim(ingredient.stock || 0, 1) : "" });
    let unit = ingredient.unit;
    const price = h("input", { class: "input num", inputmode: "decimal", placeholder: "optional" });
    const titles = { waste: "Threw away " + ingredient.display, count: "How much " + ingredient.display + " is really left?", add: "Add " + ingredient.display };
    const action = { waste: "Record waste", count: "Save amount", add: "Add to pantry" }[mode];
    const button = h("button", { class: "btn primary" }, action);
    const sheet = openSheet({
      title: titles[mode],
      body: h("div", { class: "stack" },
        h("div", { class: "row" }, amount, mode === "count" ? h("span", { class: "muted" }, ingredient.unit) : mode === "add" ? shopUnitSelect(unit, (value) => { unit = value; }) : unitToggle(unit, (value) => { unit = value; })),
        mode === "add" ? h("label", { class: "field" }, h("span", null, "Price in euro"), price) : null,
        mode === "waste" ? h("p", { class: "muted" }, "Leave empty to throw away everything that is left.") : null),
      footer: [h("button", { class: "btn ghost", onclick: () => sheet.close() }, "Cancel"), button],
    });
    button.addEventListener("click", async () => {
      const value = parseNumber(amount.value);
      try {
        if (mode === "waste") await mutate("POST", "/api/inventory/" + ingredient.id + "/waste", { qty: value, unit });
        else if (mode === "count") {
          if (value === null || value < 0) { toast("Enter an amount", true); return; }
          await mutate("POST", "/api/inventory/count", { entries: [{ ingredient_id: ingredient.id, qty: value }] });
        } else {
          if (!value) { toast("Enter an amount", true); return; }
          await mutate("POST", "/api/inventory/add", { ingredient_id: ingredient.id, qty: value, unit, price: parseNumber(price.value) });
        }
        sheet.close();
        toast("Pantry updated");
        if (onDone) onDone();
      } catch (error) {
        return;
      }
    });
  }

  function userChooser(onPicked) {
    const users = state.boot.users;
    const sheet = openSheet({
      title: "Who is using this device?",
      body: h("div", { class: "row wrap", style: { justifyContent: "center", gap: "18px", padding: "12px 0" } }, users.map((user) =>
        h("button", { class: "btn", style: { minHeight: "88px", minWidth: "140px", flexDirection: "column", borderColor: user.color }, onclick: () => {
          setUser(user);
          sheet.close();
          if (onPicked) onPicked(user);
        } }, h("span", { style: { width: "34px", height: "34px", borderRadius: "50%", background: user.color, display: "grid", placeItems: "center", color: "#1a1020", fontWeight: 800 } }, user.name[0]), user.name))),
    });
  }

  function setUser(user) {
    state.user = user;
    store("user", user.id);
    emit("user");
  }

  function userBadge() {
    const user = state.user;
    if (!user) return h("span");
    return h("button", { class: "btn ghost small", onclick: () => userChooser(), title: "Switch user" },
      h("span", { style: { width: "22px", height: "22px", borderRadius: "50%", background: user.color, display: "grid", placeItems: "center", color: "#1a1020", fontWeight: 800, fontSize: "12px" } }, user.name[0]), user.name);
  }

  async function boot(options) {
    state.mobile = !!(options && options.mobile);
    try {
      state.boot = await get("/api/bootstrap");
      store("boot", state.boot);
    } catch (error) {
      state.boot = store("boot");
      if (!state.boot) throw error;
    }
    const saved = store("user");
    state.user = state.boot.users.find((user) => user.id === saved) || null;
    renderOffline();
    flush();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
    return state;
  }

  async function refreshBoot() {
    try {
      state.boot = await get("/api/bootstrap");
      store("boot", state.boot);
      emit("boot");
    } catch (error) {
      return state.boot;
    }
    return state.boot;
  }

  function urlBase64ToUint8Array(text) {
    const padding = "=".repeat((4 - (text.length % 4)) % 4);
    const raw = atob((text + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
  }

  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("On iPhone, add Pantry to the home screen first, then turn on notifications from there.", true);
      return false;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast("Notifications were not allowed", true);
      return false;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.boot.vapid) });
    await mutate("POST", "/api/push/subscribe", subscription.toJSON());
    toast("Notifications are on");
    return true;
  }

  async function pushStatus() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return "off";
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? "on" : "off";
  }

  return {
    state, h, append, clear, svg, icon, ingredientIcon, names, qty, money, trim, parseNumber, iso, fromIso, addDays, monday, today,
    unitSelect, UNIT_LABELS, dayLabel, shortDate, uid, store, get, mutate, flush, queue, on, emit, toast, openSheet, confirmSheet, unitToggle,
    ingredientPicker, plate, recipeEditor, imageChooser, cookSheet, suggestSheet, ingredientSheet, adjustSheet, userChooser,
    userBadge, setUser, boot, refreshBoot, enablePush, pushStatus,
  };
})();
