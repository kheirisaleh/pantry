const Shell = (() => {
  const P = Pantry;
  const { h, clear } = P;

  const NAV_ICONS = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><circle cx="12" cy="13" r="3.5"/><path d="M3 4v5M5 4v5M4 9v11M21 4c-2 1-2.5 3-2.5 5h2.5v11"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/><circle cx="9" cy="15" r="1.3"/><circle cx="15" cy="15" r="1.3"/></svg>',
    recipes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16a8 8 0 01-16 0zM12 4v3M8 5.5l1 2M16 5.5l-1 2"/></svg>',
    pantry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10M8 3v3l-2 3v11a1 1 0 001 1h10a1 1 0 001-1V9l-2-3V3"/><path d="M6 13h12"/></svg>',
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 002 1.6h7.7a2 2 0 002-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    alerts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  };

  function navIcon(name) {
    const span = document.createElement("span");
    span.className = "nav-icon";
    span.innerHTML = NAV_ICONS[name];
    return span;
  }

  function start({ mobile, routes, nav, mount, chrome }) {
    const ctx = { mobile, navigate };
    let current = null;
    let renderSeq = 0;

    function busy() {
      const active = document.activeElement;
      return !!document.querySelector(".overlay") || !!(active && active !== document.body && mount.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
    }

    function routeFromHash() {
      const key = location.hash.replace("#", "");
      return routes.includes(key) ? key : routes[0];
    }

    function navigate(route) {
      if (location.hash !== "#" + route) location.hash = route;
      else render();
    }

    async function render(soft) {
      const route = routeFromHash();
      const changed = route !== current;
      current = route;
      chrome.setActive(route);
      const seq = ++renderSeq;
      const host = h("div", { class: "view view-" + route + (changed && !soft ? " entering" : "") });
      try {
        await Views[route](host, ctx);
      } catch (error) {
        Views.errorBox(host, error);
      }
      if (seq !== renderSeq) return;
      const scroll = soft ? mount.scrollTop || window.scrollY : 0;
      clear(mount).appendChild(host);
      if (soft) {
        if (mount.scrollTop !== undefined && mount.scrollHeight > mount.clientHeight) mount.scrollTop = scroll;
        else window.scrollTo(0, scroll);
      } else window.scrollTo(0, 0);
      chrome.refreshBadges();
    }

    window.addEventListener("hashchange", () => render());
    P.on((event) => {
      if (event === "changed" || event === "synced") {
        if (busy()) {
          pendingSoft = true;
          return;
        }
        render(true);
      }
      if (event === "user") chrome.refreshUser();
    });
    let pendingSoft = false;
    const observer = new MutationObserver(() => {
      if (pendingSoft && !busy()) {
        pendingSoft = false;
        render(true);
      }
    });
    observer.observe(document.body, { childList: true });
    document.addEventListener("focusout", () => setTimeout(() => {
      if (pendingSoft && !busy()) {
        pendingSoft = false;
        render(true);
      }
    }, 0));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { P.refreshBoot(); if (busy()) pendingSoft = true; else render(true); } });
    setInterval(() => { if (document.visibilityState === "visible" && !busy() && current !== "shop") render(true); }, 60000);
    render();
    return ctx;
  }

  return { start, navIcon };
})();
