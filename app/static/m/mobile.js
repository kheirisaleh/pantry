(async () => {
  const P = Pantry;
  const { h, clear } = P;
  const TABS = [["today", "Today"], ["plan", "Plan"], ["shop", "Shop"], ["pantry", "Pantry"]];
  const MORE = [["recipes", "Dishes"], ["reports", "Reports"], ["alerts", "Notes"], ["settings", "Settings"]];
  const topbar = document.getElementById("topbar");
  const tabbar = document.getElementById("tabbar");
  const main = document.getElementById("main");
  try {
    await P.boot({ mobile: true });
  } catch (error) {
    main.appendChild(h("div", { class: "empty" }, "Pantry could not load: ", error.message));
    return;
  }
  const links = {};
  for (const [key, label] of TABS) {
    links[key] = h("a", { href: "#" + key, class: "tab" }, Shell.navIcon(key), h("span", null, label));
    tabbar.appendChild(links[key]);
  }
  const moreBadge = h("span", { class: "badge hidden" });
  const moreButton = h("button", { class: "tab", type: "button" }, Shell.navIcon("more"), h("span", null, "More"), moreBadge);
  tabbar.appendChild(moreButton);
  moreButton.addEventListener("click", () => {
    const sheet = P.openSheet({
      title: "More",
      body: h("div", { class: "more-grid" }, MORE.map(([key, label]) => h("a", { href: "#" + key, class: "more-item", onclick: () => sheet.close() }, Shell.navIcon(key), h("span", null, label),
        key === "alerts" && P.state.boot.alerts ? h("span", { class: "badge" }, P.state.boot.alerts) : null)),
        h("a", { href: "/", class: "more-item", onclick: () => sessionStorage.setItem("pantry:stay-desktop", "1") }, Shell.navIcon("today"), h("span", null, "Desktop view"))),
    });
  });
  const userSlot = h("div");
  const bell = h("a", { href: "#alerts", class: "btn icon ghost bell", "aria-label": "Notes" }, P.svg("bell"), h("span", { class: "badge hidden" }));
  topbar.append(h("div", { class: "brand-small" }, h("img", { class: "brand-mark brand-logo", src: "/static/logo.svg", alt: "" }), "Pantry"), h("div", { class: "row" }, bell, userSlot));
  const chrome = {
    setActive(route) {
      for (const [key, link] of Object.entries(links)) link.classList.toggle("active", key === route);
      moreButton.classList.toggle("active", MORE.some(([key]) => key === route));
    },
    refreshUser() {
      clear(userSlot).appendChild(P.userBadge());
    },
    refreshBadges() {
      const count = P.state.boot.alerts;
      for (const badge of [moreBadge, bell.querySelector(".badge")]) {
        badge.textContent = count || "";
        badge.classList.toggle("hidden", !count);
      }
    },
  };
  chrome.refreshUser();
  P.on((event) => { if (event === "boot") chrome.refreshBadges(); if (event === "changed") P.refreshBoot(); });
  if (!P.state.user) P.userChooser();
  Shell.start({ mobile: true, routes: TABS.map(([key]) => key).concat(MORE.map(([key]) => key)), mount: main, chrome });
})();
