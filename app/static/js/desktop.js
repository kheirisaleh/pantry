(async () => {
  const P = Pantry;
  const { h, clear } = P;
  if (window.matchMedia("(max-width: 760px)").matches && !sessionStorage.getItem("pantry:stay-desktop") && /iPhone|Android/i.test(navigator.userAgent)) {
    location.replace("/m/");
    return;
  }
  const NAV = [
    ["today", "Today"], ["plan", "Plan"], ["recipes", "Dishes"], ["pantry", "Pantry"], ["shop", "Shopping"], ["reports", "Reports"], ["alerts", "Notes"], ["settings", "Settings"],
  ];
  const rail = document.getElementById("rail");
  const main = document.getElementById("main");
  try {
    await P.boot({ mobile: false });
  } catch (error) {
    main.appendChild(h("div", { class: "empty" }, "Pantry could not load: ", error.message));
    return;
  }
  const links = {};
  const userSlot = h("div", { class: "rail-user" });
  const aiSlot = h("div", { class: "rail-ai" });
  clear(rail).append(
    h("a", { class: "brand", href: "#today" }, h("img", { class: "brand-mark brand-logo", src: "/static/logo.svg", alt: "" }), h("span", { class: "brand-word" }, "Pantry")),
    h("nav", { class: "rail-nav" }, NAV.map(([key, label]) => {
      const link = h("a", { href: "#" + key, class: "rail-link" }, Shell.navIcon(key), h("span", null, label), h("span", { class: "badge hidden" }));
      links[key] = link;
      return link;
    })),
    h("div", { class: "rail-foot" }, aiSlot, userSlot),
  );
  const chrome = {
    setActive(route) {
      for (const [key, link] of Object.entries(links)) link.classList.toggle("active", key === route);
    },
    refreshUser() {
      clear(userSlot).appendChild(P.userBadge());
    },
    refreshBadges() {
      const boot = P.state.boot;
      const badge = links.alerts.querySelector(".badge");
      badge.textContent = boot.alerts || "";
      badge.classList.toggle("hidden", !boot.alerts);
      const ai = boot.ai;
      clear(aiSlot).append(h("span", { class: "ai-dot " + (!ai.key_set ? "off" : ai.queued ? "busy" : "") }),
        h("span", null, !ai.key_set ? "Assistant offline" : ai.queued ? "Assistant working on " + ai.queued : "Assistant idle"));
    },
  };
  chrome.refreshUser();
  P.on((event) => { if (event === "boot") chrome.refreshBadges(); if (event === "changed") P.refreshBoot(); });
  if (!P.state.user) P.userChooser();
  Shell.start({ mobile: false, routes: NAV.map(([key]) => key), mount: main, chrome });
  setInterval(() => P.refreshBoot(), 30000);
})();
