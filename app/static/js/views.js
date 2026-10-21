const Views = (() => {
  const P = Pantry;
  const { h, clear, svg, icon, ingredientIcon, names, qty, money, trim, parseNumber, addDays, monday, today, dayLabel, shortDate, get, mutate, toast } = P;

  function errorBox(host, error) {
    clear(host).appendChild(h("div", { class: "empty" }, icon("package"), h("p", null, error.message || String(error))));
  }

  function pageHead(title, subtitle, actions) {
    return h("div", { class: "page-head" },
      h("div", { class: "grow" }, h("h1", null, title), subtitle ? h("p", { class: "soft lede" }, subtitle) : null),
      actions ? h("div", { class: "row wrap head-actions" }, actions) : null);
  }

  function mealMenu(meal, date) {
    const servingsInput = h("input", { class: "input num", inputmode: "decimal", value: trim(meal.servings, 1), style: { width: "90px" } });
    const dateInput = h("input", { class: "input", type: "date", value: meal.date, style: { width: "170px" } });
    const cooked = meal.status === "cooked";
    const sheet = P.openSheet({
      title: h("div", { class: "row" }, P.plate(meal.recipe, { size: "56px", cooked }), h("div", null, h("h3", null, meal.recipe.display), meal.recipe.name_fa ? h("div", { class: "fa" }, meal.recipe.name_fa) : null)),
      body: h("div", { class: "stack" },
        cooked
          ? h("div", { class: "stack tight" },
            h("p", { class: "soft" }, "Cooked ", meal.cooked_at ? "on " + shortDate(meal.cooked_at) : "", " for ", trim(meal.servings, 1), " people."),
            h("div", { class: "row wrap" },
              meal.cost !== null ? h("span", { class: "chip" }, money(meal.cost)) : null,
              meal.kcal !== null ? h("span", { class: "chip" }, Math.round(meal.kcal), " kcal") : null,
              meal.protein !== null ? h("span", { class: "chip" }, Math.round(meal.protein), " g protein") : null))
          : h("div", { class: "row wrap" },
            h("label", { class: "field" }, h("span", null, "People"), servingsInput),
            h("label", { class: "field" }, h("span", null, "Day"), dateInput)),
        !cooked && meal.shortages && meal.shortages.length ? h("div", { class: "row wrap" }, h("span", { class: "soft" }, "Will be short:"), meal.shortages.map((short) => h("span", { class: "chip bad" }, short.display, " ", qty(short.missing, short.unit)))) : null,
      ),
      footer: cooked
        ? [h("button", { class: "btn ghost", onclick: async () => {
          await mutate("POST", "/api/meals/" + meal.id + "/uncook");
          toast("Cooking undone, ingredients are back");
          sheet.close();
          P.emit("changed");
        } }, svg("undo"), "Undo cooking")]
        : [
          h("button", { class: "btn ghost danger", onclick: async () => {
            await mutate("DELETE", "/api/meals/" + meal.id);
            sheet.close();
            P.emit("changed");
          } }, svg("trash"), "Remove"),
          h("button", { class: "btn", onclick: () => { sheet.close(); P.suggestSheet({ date: meal.date, meal }); } }, "Change dish"),
          h("button", { class: "btn", onclick: async () => {
            const servings = parseNumber(servingsInput.value);
            if (!servings || servings <= 0) { toast("People must be more than zero", true); return; }
            await mutate("PATCH", "/api/meals/" + meal.id, { servings, date: dateInput.value });
            sheet.close();
            P.emit("changed");
          } }, "Save"),
          meal.date <= today() ? h("button", { class: "btn primary", onclick: () => { sheet.close(); P.cookSheet({ meal, date: meal.date }); } }, svg("flame"), "Cook") : null,
        ],
    });
  }

  function snackSheet() {
    let picked = null;
    const label = h("div", { class: "soft" }, "Nothing picked yet");
    const amount = h("input", { class: "input num", inputmode: "decimal", value: "1", style: { width: "110px" } });
    let unit = "pcs";
    const toggle = P.unitToggle(unit, (value) => { unit = value; });
    const picker = P.ingredientPicker({ placeholder: "Apple, yogurt, maast, Apfel", keepText: false, autofocus: true, onPick: (value) => {
      picked = value;
      P.clear(label).append(value.ingredient ? ingredientIcon(value.ingredient) : icon("package"), " ", value.ingredient ? names(value.ingredient) : value.name);
    } });
    const sheet = P.openSheet({
      title: "Log a snack",
      subtitle: "Snacks count for nutrition but never change your meal plan.",
      body: h("div", { class: "stack" }, picker, label, h("div", { class: "row" }, amount, toggle)),
      footer: [h("button", { class: "btn ghost", onclick: () => sheet.close() }, "Cancel"), h("button", { class: "btn primary", onclick: async () => {
        if (!picked) { toast("Pick what you ate", true); return; }
        const value = parseNumber(amount.value);
        if (!value) { toast("Enter an amount", true); return; }
        await mutate("POST", "/api/snacks", { ingredient_id: picked.ingredient_id, name: picked.name, qty: value, unit });
        sheet.close();
        toast("Snack logged");
        P.emit("changed");
      } }, "Log snack")],
    });
  }

  async function todayView(host, ctx) {
    const day = today();
    const [calendar, alerts, shopping, week] = await Promise.all([
      get("/api/calendar?start=" + day + "&end=" + addDays(day, 2)),
      get("/api/alerts"),
      get("/api/shopping"),
      get("/api/home/week").catch(() => null),
    ]);
    const cycleState = await get("/api/cycle").catch(() => null);
    clear(host);
    const greeting = new Date().getHours() < 11 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
    host.appendChild(pageHead(greeting + (P.state.user ? ", " + P.state.user.name : ""), new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
      [h("button", { class: "btn", onclick: snackSheet }, "Log a snack"), h("button", { class: "btn primary", onclick: () => P.suggestSheet({ date: day }) }, "What can I cook?")]));

    const todayData = calendar[0];
    const suggest = await get("/api/suggestions?date=" + day).catch(() => ({ suggestions: [] }));
    const cookedToday = todayData.meals.filter((meal) => meal.status === "cooked");
    const pool = suggest.suggestions.filter((entry) => entry.pool_meal_id);
    const cookPick = (entry) => P.cookSheet({ recipeId: entry.recipe_id, date: day, onDone: () => P.emit("changed") });
    const statusChip = (entry) => entry.tier === 0
      ? h("span", { class: "chip good" }, "ready to cook")
      : entry.tier === 1
        ? h("span", { class: "chip warn" }, "uses stock of another dish")
        : h("span", { class: "chip" }, "needs " + entry.shortages.length + " items");
    const stage = h("section", { class: "stage" });
    if (cookedToday.length) {
      stage.appendChild(h("div", { class: "stage-plates" }, cookedToday.map((meal) => h("button", { class: "stage-plate", onclick: () => mealMenu(meal, day) },
        P.plate(meal.recipe, { size: ctx.mobile ? "132px" : "190px", cooked: true }),
        h("div", { class: "stage-caption" },
          h("h3", null, meal.recipe.display),
          meal.recipe.name_fa ? h("div", { class: "fa" }, meal.recipe.name_fa) : null,
          h("div", { class: "row wrap", style: { justifyContent: "center", marginTop: "8px" } },
            h("span", { class: "chip" }, "for ", trim(meal.servings, 1)), h("span", { class: "chip warn" }, "cooked today"))))),
        h("button", { class: "stage-add", onclick: () => P.suggestSheet({ date: day }), "aria-label": "Cook something else" }, svg("plus"))));
    } else {
      stage.classList.add("stage-reel-host");
      stage.appendChild(cookableReel(suggest, cycleState, ctx, cookPick, statusChip, day));
    }
    host.appendChild(stage);
    if (cycleState && cycleState.cycle) host.appendChild(cycleCard(cycleState, ctx));

    const grid = h("div", { class: "today-grid" });
    if (week) grid.appendChild(weekCard(week));
    const upcoming = h("section", { class: "panel" }, h("h3", null, "On the shopping plan"),
      h("p", { class: "soft" }, "These dishes set the shopping list. Cook them in any order, or anything else the pantry allows."));
    if (!pool.length) upcoming.appendChild(h("p", { class: "muted" }, "Nothing left from this week's plan."));
    for (const entry of pool) {
      upcoming.appendChild(h("button", { class: "list-row", style: { width: "100%", background: "none", border: "0", color: "inherit", textAlign: "left" }, onclick: () => cookPick(entry) },
        P.plate({ image_path: entry.image_path, display: entry.name }, { size: "40px" }),
        h("div", { class: "grow" }, h("div", null, entry.name), entry.name_fa ? h("div", { class: "fa soft" }, entry.name_fa) : null),
        statusChip(entry)));
    }
    grid.appendChild(upcoming);

    const list = shopping.list;
    const toBuy = list ? list.items.filter((item) => !item.committed && !item.checked).length : 0;
    grid.appendChild(h("section", { class: "panel" },
      h("div", { class: "spread" }, h("h3", null, "Shopping"), h("button", { class: "btn small", onclick: () => ctx.navigate("shop") }, "Open list")),
      list ? h("p", { class: "soft" }, toBuy ? toBuy + " item" + (toBuy === 1 ? "" : "s") + " to buy" : "Everything on the list is bought.",
        list.range_start ? h("span", { class: "muted" }, " for " + shortDate(list.range_start) + " to " + shortDate(list.range_end)) : null)
        : h("p", { class: "soft" }, "No open list. Plan your meals, then build one from the planner."),
      list && list.active_session ? h("p", null, "Shopping at ", h("b", null, list.active_session.store), ", ", h("b", { class: "num" }, money(list.active_session.total)), " so far") : null));

    const alertBox = h("section", { class: "panel" }, h("div", { class: "spread" }, h("h3", null, "Notes"), alerts.length ? h("button", { class: "btn small", onclick: () => ctx.navigate("alerts") }, "See all") : null));
    if (!alerts.length) alertBox.appendChild(h("p", { class: "muted" }, "Nothing needs attention."));
    for (const alert of alerts.slice(0, 3)) alertBox.appendChild(h("div", { class: "list-row" }, h("span", { class: "dot " + alert.kind }), h("div", { class: "grow" }, h("div", null, alert.title), h("div", { class: "muted", style: { fontSize: "var(--s-1)" } }, alert.body))));
    grid.appendChild(alertBox);

    if (todayData.snacks.length) {
      grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Snacks today"), todayData.snacks.map((snack) =>
        h("div", { class: "list-row" }, icon(snack.icon, "sm"), h("span", { class: "grow" }, snack.display), h("span", { class: "muted num" }, qty(snack.qty, snack.unit)),
          h("button", { class: "btn icon small ghost", "aria-label": "Remove snack", onclick: async () => { await mutate("DELETE", "/api/snacks/" + snack.id); P.emit("changed"); } }, svg("trash"))))));
    }
    host.appendChild(grid);
  }

  function cookableReel(suggest, cycleState, ctx, cookPick, statusChip, day) {
    const ready = suggest.suggestions.filter((entry) => entry.tier === 0);
    const borrowing = suggest.suggestions.filter((entry) => entry.tier === 1);
    const deck = ready.concat(borrowing).slice(0, 12);
    const chooser = () => P.suggestSheet({ date: day });
    if (!deck.length) {
      const empty = cycleState && cycleState.empty_pantry;
      return h("div", { class: "reel-alarm", role: "alert" },
        h("div", { class: "alarm-cart" }, svg("cart")),
        h("div", { class: "alarm-copy" },
          h("div", { class: "eyebrow" }, empty ? "The pantry is empty" : "Nothing left to cook"),
          h("h2", null, "Time to go shopping"),
          h("p", { class: "soft" }, empty
            ? "Log what you have at home or do your next shop, and the dishes you can cook will show up here."
            : "With what is at home right now, no dish in your recipe book can be made. Build a list for the next " + ((cycleState && cycleState.default_days) || 14) + " days."),
          h("div", { class: "row wrap" },
            h("button", { class: "btn primary", onclick: () => ctx.navigate("shop") }, "Open shopping"),
            h("button", { class: "btn", onclick: chooser }, "Choose myself"))));
    }
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const size = ctx.mobile ? "150px" : "210px";
    let index = 0;
    let playing = !reduce && deck.length > 1;
    let timer = null;
    let held = false;
    const live = h("div", { class: "sr-only", "aria-live": "off" });
    const cards = deck.map((entry, position) => {
      const card = h("button", { type: "button", class: "reel-card", "aria-label": "Cook " + entry.name, onclick: () => cookPick(entry) },
        h("div", { class: "reel-halo" }),
        P.plate({ image_path: entry.image_path, display: entry.name }, { size }),
        h("div", { class: "stage-caption" },
          h("h3", null, entry.name),
          entry.name_fa ? h("div", { class: "fa" }, entry.name_fa) : null,
          h("div", { class: "row wrap", style: { justifyContent: "center", marginTop: "8px" } }, statusChip(entry))));
      card.style.setProperty("--n", position);
      return card;
    });
    const track = h("div", { class: "reel-track" }, cards);
    const dots = h("div", { class: "reel-dots" }, deck.map((entry, position) => h("button", { type: "button", class: "reel-dot", "aria-label": "Show " + entry.name, onclick: () => { stop(); go(position); } }, h("i"))));
    const toggle = h("button", { type: "button", class: "btn icon small ghost reel-toggle" });
    const counter = h("span", { class: "reel-count num" });
    function paint() {
      cards.forEach((card, position) => {
        let offset = position - index;
        const half = deck.length / 2;
        if (offset > half) offset -= deck.length;
        if (offset < -half) offset += deck.length;
        card.style.setProperty("--o", offset);
        card.classList.toggle("is-current", offset === 0);
        card.classList.toggle("is-near", Math.abs(offset) === 1);
        card.tabIndex = offset === 0 ? 0 : -1;
        card.setAttribute("aria-hidden", offset === 0 ? "false" : "true");
      });
      [...dots.children].forEach((dot, position) => dot.classList.toggle("on", position === index));
      counter.textContent = (index + 1) + " / " + deck.length;
      live.textContent = deck[index].name;
      clear(toggle).appendChild(svg(playing ? "pause" : "play"));
      toggle.setAttribute("aria-label", playing ? "Stop rotating dishes" : "Start rotating dishes");
      reel.classList.toggle("is-playing", playing && !held);
    }
    function go(target) {
      index = (target + deck.length) % deck.length;
      paint();
    }
    function schedule() {
      clearInterval(timer);
      if (playing && !held && deck.length > 1) timer = setInterval(() => { if (!document.hidden && reel.isConnected) go(index + 1); else if (!reel.isConnected) clearInterval(timer); }, 3400);
    }
    function stop() { playing = false; live.setAttribute("aria-live", "polite"); schedule(); paint(); }
    toggle.addEventListener("click", () => { playing = !playing; live.setAttribute("aria-live", playing ? "off" : "polite"); schedule(); paint(); });
    const hold = (value) => { held = value; schedule(); paint(); };
    let startX = null;
    track.addEventListener("pointerdown", (event) => { startX = event.clientX; });
    track.addEventListener("pointerup", (event) => {
      if (startX === null) return;
      const delta = event.clientX - startX;
      startX = null;
      if (Math.abs(delta) > 40) { stop(); go(index + (delta < 0 ? 1 : -1)); event.preventDefault(); }
    });
    const reel = h("div", { class: "reel", role: "region", "aria-roledescription": "carousel", "aria-label": "Dishes you can cook now" },
      h("div", { class: "reel-head" },
        h("div", null, h("div", { class: "eyebrow" }, ready.length ? ready.length + " dish" + (ready.length === 1 ? "" : "es") + " ready from your pantry" : "Possible, but uses food meant for other dishes"),
          h("div", { class: "soft", style: { fontSize: "var(--s-1)" } }, "Tap a plate to cook it")),
        h("div", { class: "row" }, counter, toggle)),
      track, dots, live,
      h("div", { class: "row reel-actions" },
        h("button", { class: "btn primary", onclick: chooser }, "Choose myself")));
    reel.addEventListener("mouseenter", () => hold(true));
    reel.addEventListener("mouseleave", () => hold(false));
    reel.addEventListener("focusin", () => hold(true));
    reel.addEventListener("focusout", () => hold(false));
    reel.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") { stop(); go(index + 1); }
      if (event.key === "ArrowLeft") { stop(); go(index - 1); }
    });
    paint();
    schedule();
    return reel;
  }

  function cycleCard(state, ctx) {
    const cycle = state.cycle;
    const radius = 52;
    const length = 2 * Math.PI * radius;
    const arc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const base = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgNode.setAttribute("viewBox", "0 0 120 120");
    svgNode.setAttribute("class", "cycle-ring");
    for (const node of [base, arc]) {
      node.setAttribute("cx", "60"); node.setAttribute("cy", "60"); node.setAttribute("r", String(radius));
      svgNode.appendChild(node);
    }
    base.setAttribute("class", "ring-base");
    arc.setAttribute("class", "ring-arc " + cycle.state);
    arc.style.strokeDasharray = String(length);
    arc.style.strokeDashoffset = String(length);
    requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = String(length * (1 - cycle.progress)); }));
    const dayNumber = h("b", { class: "num" }, "0");
    countUp(dayNumber, Math.max(0, cycle.elapsed_days));
    const center = h("div", { class: "ring-center" }, dayNumber, h("span", null, "of " + cycle.planned_days + " days"));
    const messages = {
      on_track: ["On track", "At this pace the food lasts the planned " + cycle.planned_days + " days."],
      ahead: ["Lasting longer", "At this pace the food lasts until " + shortDate(cycle.forecast_run_out) + ", about " + cycle.difference_days + " days more than planned" + (cycle.projected_saving ? ", worth about " + money(cycle.projected_saving) + "." : ".")],
      early: ["Runs out early", "At this pace the food runs out around " + shortDate(cycle.forecast_run_out) + ", " + Math.abs(cycle.difference_days) + " days before the plan ends" + (cycle.projected_extra_cost ? ". That is about " + money(cycle.projected_extra_cost) + " of extra shopping." : ".")],
      extended: ["Well done", cycle.extra_days_so_far + " days past the plan and you can still cook" + (cycle.saved_so_far ? ". You saved about " + money(cycle.saved_so_far) + " so far." : ".")],
    };
    const [title, body] = messages[cycle.state] || messages.on_track;
    const facts = h("div", { class: "cycle-facts" },
      h("span", { class: "chip" }, "shopped " + shortDate(cycle.start)),
      h("span", { class: "chip" }, state.meals_left >= 120 ? "plenty of meals left" : state.meals_left + " meals left"),
      cycle.spend ? h("span", { class: "chip" }, money(cycle.daily_spend) + " a day") : null);
    const last = (state.history || []).filter((entry) => entry.actual_days !== null).slice(-1)[0];
    return h("section", { class: "panel cycle-card state-" + cycle.state },
      h("div", { class: "cycle-ring-wrap" }, svgNode, center),
      h("div", { class: "cycle-copy" },
        h("div", { class: "eyebrow" }, "This shop"),
        h("h3", null, title),
        h("p", { class: "soft" }, body),
        facts,
        last ? h("p", { class: "muted", style: { fontSize: "var(--s-1)", marginTop: "8px" } },
          "Last time: planned " + last.planned_days + " days, lasted " + last.actual_days + (last.saved ? ", saved " + money(last.saved) : last.extra_cost ? ", " + money(last.extra_cost) + " extra" : "")) : null));
  }

  function countUp(node, target, suffix) {
    const start = performance.now();
    const duration = 900;
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = Math.round(target * eased).toLocaleString("en-GB") + (suffix || "");
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return node;
  }

  function weekCard(week) {
    const max = Math.max(1, ...week.days.map((entry) => Math.max(entry.eaten_kcal, entry.planned_kcal)));
    const detail = h("div", { class: "week-detail" });
    const todayEntry = week.days.find((entry) => entry.is_today);
    function describe(entry) {
      clear(detail);
      const label = P.fromIso(entry.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
      detail.appendChild(h("b", null, label));
      if (entry.eaten_kcal) {
        detail.appendChild(h("span", null, entry.eaten_kcal.toLocaleString("en-GB"), " kcal each, ", entry.eaten_protein, " g protein"));
        detail.appendChild(h("span", { class: "row wrap", style: { gap: "6px" } }, entry.people.map((person) => h("span", { class: "chip" }, person.name, " ", person.kcal.toLocaleString("en-GB")))));
      } else if (entry.planned_kcal) {
        detail.appendChild(h("span", { class: "muted" }, "Planned, about ", entry.planned_kcal.toLocaleString("en-GB"), " kcal each"));
      } else {
        detail.appendChild(h("span", { class: "muted" }, entry.is_future ? "Nothing planned yet" : "Nothing logged"));
      }
    }
    const columns = week.days.map((entry, index) => {
      const eaten = h("i", { class: "bar-eaten" });
      const planned = h("i", { class: "bar-planned" });
      const column = h("button", { type: "button", class: "week-col" + (entry.is_today ? " is-today" : "") + (entry.is_future ? " is-future" : ""), "aria-label": entry.date },
        h("span", { class: "bar-value num" }, entry.eaten_kcal ? (entry.eaten_kcal / 1000).toFixed(1) + "k" : entry.planned_kcal ? "~" + (entry.planned_kcal / 1000).toFixed(1) + "k" : ""),
        h("span", { class: "bar-track" }, planned, eaten),
        h("span", { class: "bar-day" }, P.fromIso(entry.date).toLocaleDateString("en-GB", { weekday: "narrow" })));
      column.style.setProperty("--i", index);
      column.addEventListener("click", () => {
        for (const other of columns) other.classList.toggle("active", other === column);
        describe(entry);
      });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        eaten.style.height = (entry.eaten_kcal / max * 100) + "%";
        planned.style.height = ((entry.eaten_kcal ? 0 : entry.planned_kcal) / max * 100) + "%";
      }));
      return column;
    });
    if (todayEntry) {
      columns[week.days.indexOf(todayEntry)].classList.add("active");
      describe(todayEntry);
    }
    const average = h("b", { class: "num" }, "0");
    const eatenKnown = week.average_kcal > 0;
    const averageLabel = eatenKnown ? "kcal a day eaten" : "kcal a day planned";
    const card = h("section", { class: "panel week-card" },
      h("div", { class: "spread" },
        h("div", null, h("h3", null, "This week"), h("div", { class: "muted", style: { fontSize: "var(--s-1)" } }, "Calories per person, eaten and planned")),
        h("div", { class: "kpi", style: { alignItems: "flex-end" } }, average, h("span", null, averageLabel))),
      h("div", { class: "week-bars" }, columns),
      h("div", { class: "week-legend" }, h("span", null, h("i", { class: "swatch eaten" }), "Eaten"), h("span", null, h("i", { class: "swatch planned" }), "Planned")),
      detail);
    countUp(average, eatenKnown ? week.average_kcal : (week.average_planned_kcal || 0));
    return card;
  }

  function enableMealDrag(board, onDrop) {
    let suppressClick = false;
    board.addEventListener("click", (event) => {
      if (suppressClick) { event.stopPropagation(); event.preventDefault(); suppressClick = false; }
    }, true);
    board.addEventListener("dragstart", (event) => event.preventDefault());
    board.addEventListener("contextmenu", (event) => { if (event.target.closest(".meal[data-meal-id]")) event.preventDefault(); });
    board.addEventListener("pointerdown", (event) => {
      const card = event.target.closest(".meal[data-meal-id]");
      if (!card || card.classList.contains("cooked") || event.button > 0) return;
      const touch = event.pointerType !== "mouse";
      const startX = event.clientX;
      const startY = event.clientY;
      let lastX = startX;
      let lastY = startY;
      let drag = null;
      let timer = null;
      let scrollFrame = null;
      const pointerId = event.pointerId;

      function blockScroll(touchEvent) { if (drag) touchEvent.preventDefault(); }

      function begin() {
        const rect = card.getBoundingClientRect();
        const ghost = card.cloneNode(true);
        ghost.classList.add("drag-ghost");
        Object.assign(ghost.style, { width: rect.width + "px", height: rect.height + "px", left: rect.left + "px", top: rect.top + "px" });
        document.body.appendChild(ghost);
        const slot = h("div", { class: "drop-slot" });
        slot.style.height = rect.height + "px";
        card.after(slot);
        card.classList.add("drag-source");
        document.body.classList.add("is-dragging");
        drag = { ghost, slot, offsetX: lastX - rect.left, offsetY: lastY - rect.top, list: card.parentElement };
        if (navigator.vibrate) navigator.vibrate(12);
        move(lastX, lastY);
        autoScroll();
      }

      function targetList(x, y) {
        drag.ghost.style.visibility = "hidden";
        const under = document.elementFromPoint(x, y);
        drag.ghost.style.visibility = "";
        const list = under && under.closest(".day-meals[data-date]");
        if (list) return list;
        const day = under && under.closest(".day");
        return day ? day.querySelector(".day-meals[data-date]") : null;
      }

      function move(x, y) {
        lastX = x;
        lastY = y;
        drag.ghost.style.transform = "translate(" + (x - drag.offsetX - parseFloat(drag.ghost.style.left)) + "px," + (y - drag.offsetY - parseFloat(drag.ghost.style.top)) + "px) rotate(-2deg) scale(1.04)";
        const list = targetList(x, y);
        if (!list) return;
        const cards = [...list.querySelectorAll(".meal[data-meal-id]")].filter((entry) => entry !== card);
        const before = cards.find((entry) => {
          const box = entry.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        const anchor = before || list.querySelector(".snack-line, .day-add");
        if (anchor) {
          if (drag.slot.nextSibling !== anchor || drag.slot.parentElement !== list) list.insertBefore(drag.slot, anchor);
        } else if (drag.slot.parentElement !== list || drag.slot.nextSibling) list.appendChild(drag.slot);
        for (const other of board.querySelectorAll(".day.drop-target")) if (other !== list.closest(".day")) other.classList.remove("drop-target");
        list.closest(".day").classList.add("drop-target");
      }

      function autoScroll() {
        if (!drag) return;
        const edge = 90;
        let speed = 0;
        if (lastY < edge) speed = -Math.ceil((edge - lastY) / 6);
        else if (lastY > window.innerHeight - edge - 40) speed = Math.ceil((lastY - (window.innerHeight - edge - 40)) / 6);
        if (speed) {
          window.scrollBy(0, speed);
          move(lastX, lastY);
        }
        scrollFrame = requestAnimationFrame(autoScroll);
      }

      function cleanup() {
        clearTimeout(timer);
        cancelAnimationFrame(scrollFrame);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("touchmove", blockScroll);
        document.body.classList.remove("is-dragging");
        for (const other of board.querySelectorAll(".day.drop-target")) other.classList.remove("drop-target");
      }

      function onMove(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        if (!drag) {
          const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (touch) { if (distance > 10) cleanup(); return; }
          lastX = moveEvent.clientX;
          lastY = moveEvent.clientY;
          if (distance > 6) begin();
          return;
        }
        moveEvent.preventDefault();
        move(moveEvent.clientX, moveEvent.clientY);
      }

      function finish(commit) {
        const { ghost, slot } = drag;
        const list = slot.parentElement;
        const date = list && list.dataset.date;
        const index = list ? [...list.children].filter((entry) => entry.matches(".meal[data-meal-id], .drop-slot") && entry !== card).indexOf(slot) : -1;
        const from = card.parentElement.dataset.date;
        const fromIndex = [...card.parentElement.querySelectorAll(".meal[data-meal-id]")].indexOf(card);
        const target = slot.getBoundingClientRect();
        ghost.classList.add("dropping");
        ghost.style.transform = "translate(" + (target.left - parseFloat(ghost.style.left)) + "px," + (target.top - parseFloat(ghost.style.top)) + "px)";
        const changed = commit && date && index >= 0 && !(date === from && index === fromIndex);
        setTimeout(() => {
          if (changed) slot.replaceWith(card);
          else slot.remove();
          card.classList.remove("drag-source");
          if (changed) card.classList.add("just-dropped");
          ghost.remove();
          if (changed) onDrop(card.dataset.mealId, date, index);
        }, 220);
        drag = null;
      }

      function onUp(upEvent) {
        if (upEvent.pointerId !== pointerId) return;
        const wasDragging = !!drag;
        if (drag) finish(true);
        cleanup();
        if (wasDragging) {
          suppressClick = true;
          setTimeout(() => { suppressClick = false; }, 400);
        }
      }

      function onCancel(cancelEvent) {
        if (cancelEvent.pointerId !== pointerId) return;
        if (drag) finish(false);
        cleanup();
      }

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      document.addEventListener("touchmove", blockScroll, { passive: false });
      if (touch) timer = setTimeout(() => { if (!drag) begin(); }, 360);
    });
  }

  const plannerState = { start: null, days: 14 };

  async function plannerView(host, ctx) {
    if (!plannerState.start) plannerState.start = monday(today());
    const start = plannerState.start;
    const end = addDays(start, plannerState.days - 1);
    const calendar = await get("/api/calendar?start=" + start + "&end=" + end);
    clear(host);
    const rangeLabel = shortDate(start) + " to " + shortDate(end);
    host.appendChild(pageHead("Plan", ctx.mobile ? "Hold a dish to move it to another day or change its order." : "Drag dishes between days or reorder them. The order inside a day is the meal order.", [
      h("div", { class: "row" },
        h("button", { class: "btn icon", "aria-label": "Earlier", onclick: () => { plannerState.start = addDays(start, -7); plannerView(host, ctx); } }, svg("left")),
        h("button", { class: "btn", onclick: () => { plannerState.start = monday(today()); plannerView(host, ctx); } }, rangeLabel),
        h("button", { class: "btn icon", "aria-label": "Later", onclick: () => { plannerState.start = addDays(start, 7); plannerView(host, ctx); } }, svg("right"))),
      h("button", { class: "btn primary", onclick: () => buildListSheet(ctx) }, svg("cart"), "Build shopping list"),
    ]));
    const board = h("div", { class: ctx.mobile ? "day-list" : "week-board" });
    for (const entry of calendar) {
      const isToday = entry.date === today();
      const past = entry.date < today();
      const column = h("div", { class: "day" + (isToday ? " is-today" : "") + (past ? " is-past" : "") },
        h("div", { class: "day-head" },
          h("span", { class: "day-name" }, P.fromIso(entry.date).toLocaleDateString("en-GB", { weekday: "short" })),
          h("span", { class: "day-num num" }, P.fromIso(entry.date).getDate())),
      );
      const meals = h("div", { class: "day-meals", "data-date": entry.date });
      entry.meals.forEach((meal, mealIndex) => {
        const cooked = meal.status === "cooked";
        const short = meal.shortages && meal.shortages.length;
        const plateNode = P.plate(meal.recipe, { size: ctx.mobile ? "44px" : "52px", cooked, short });
        const card = h("button", { class: "meal" + (cooked ? " cooked" : "") + (meal.overdue ? " overdue" : ""), "data-meal-id": meal.id, onclick: () => mealMenu(meal, entry.date) },
          h("span", { class: "meal-plate" }, plateNode, entry.meals.length > 1 ? h("span", { class: "meal-order num" }, mealIndex + 1) : null),
          h("span", { class: "meal-text" }, h("span", { class: "meal-name" }, meal.recipe.display, meal.source === "alexa" ? h("span", { class: "source-dot", title: "Added by Alexa" }, svg("mic")) : null), h("span", { class: "meal-meta" }, "for ", trim(meal.servings, 1),
            cooked ? ", cooked" : short ? ", short" : meal.overdue ? ", not cooked" : "")),
          cooked ? null : h("span", { class: "meal-grip", "aria-hidden": "true" }, svg("grip")));
        card.style.setProperty("--i", mealIndex);
        meals.appendChild(card);
      });
      for (const snack of entry.snacks) meals.appendChild(h("div", { class: "snack-line" }, icon(snack.icon, "sm"), snack.display));
      meals.appendChild(h("button", { class: "day-add", "aria-label": "Plan a meal on " + entry.date, onclick: () => P.suggestSheet({ date: entry.date }) }, svg("plus")));
      column.appendChild(meals);
      board.appendChild(column);
    }
    host.appendChild(board);
    enableMealDrag(board, async (mealId, date, index) => {
      try {
        await mutate("POST", "/api/meals/" + mealId + "/move", { date, index });
        toast("Moved to " + P.fromIso(date).toLocaleDateString("en-GB", { weekday: "long" }));
      } catch (error) {
        toast(error.message || "Could not move it", true);
      }
      P.emit("changed");
    });
    if (ctx.mobile && host.classList.contains("entering")) {
      requestAnimationFrame(() => {
        const current = host.querySelector(".day.is-today");
        if (current) window.scrollTo({ top: current.getBoundingClientRect().top + window.scrollY - 80 });
      });
    }
  }

  async function buildListSheet(ctx) {
    const startInput = h("input", { class: "input", type: "date", value: today() });
    const endInput = h("input", { class: "input", type: "date", value: addDays(today(), 13) });
    get("/api/cycle").then((state) => { if (state && state.default_days) { endInput.value = addDays(startInput.value, state.default_days - 1); loadReview().catch(() => null); } }).catch(() => null);
    const reviewHost = h("div", { class: "stack" });
    const entries = new Map();
    async function loadReview() {
      clear(reviewHost).appendChild(h("p", { class: "muted" }, "Loading"));
      const review = await get("/api/shopping/review?start=" + startInput.value + "&end=" + endInput.value);
      clear(reviewHost);
      entries.clear();
      if (!review.length) {
        reviewHost.appendChild(h("p", { class: "muted" }, "No planned dishes in this range."));
        return;
      }
      reviewHost.appendChild(h("p", { class: "soft" }, "Check what is really at home before the list is made. Fix any number that is off."));
      for (const line of review) {
        const input = h("input", { class: "input num", inputmode: "decimal", value: trim(line.stock, 1), style: { width: "96px" } });
        entries.set(line.ingredient_id, { input, original: line.stock });
        reviewHost.appendChild(h("div", { class: "list-row" }, icon(line.icon), h("div", { class: "grow" }, names(line), h("div", { class: "muted", style: { fontSize: "var(--s-1)" } }, "Plan needs ", qty(line.needed, line.unit))),
          h("span", { class: "muted" }, "at home"), input, h("span", { class: "muted", style: { width: "28px" } }, line.unit)));
      }
    }
    startInput.addEventListener("change", loadReview);
    endInput.addEventListener("change", loadReview);
    const build = h("button", { class: "btn primary" }, "Build list");
    const sheet = P.openSheet({
      title: "Build the shopping list",
      wide: true,
      body: h("div", { class: "stack" }, h("div", { class: "row wrap" }, h("label", { class: "field" }, h("span", null, "From"), startInput), h("label", { class: "field" }, h("span", null, "To"), endInput)), reviewHost),
      footer: [h("button", { class: "btn ghost", onclick: () => sheet.close() }, "Cancel"), build],
    });
    build.addEventListener("click", async () => {
      build.disabled = true;
      try {
        const changes = [];
        for (const [id, entry] of entries) {
          const value = parseNumber(entry.input.value);
          if (value !== null && Math.abs(value - entry.original) > 0.01) changes.push({ ingredient_id: id, qty: value });
        }
        if (changes.length) await mutate("POST", "/api/inventory/count", { entries: changes });
        await mutate("POST", "/api/shopping/build", { start: startInput.value, end: endInput.value });
        sheet.close();
        toast("Shopping list ready");
        P.emit("changed");
        ctx.navigate("shop");
      } catch (error) {
        build.disabled = false;
      }
    });
    loadReview().catch((error) => errorBox(reviewHost, error));
  }

  const recipeState = { query: "" };

  async function recipesView(host, ctx) {
    const recipes = await get("/api/recipes");
    clear(host);
    const search = h("input", { class: "input", placeholder: "Find a dish", value: recipeState.query, style: { maxWidth: "280px" } });
    host.appendChild(pageHead("Dishes", recipes.length + " dish" + (recipes.length === 1 ? "" : "es") + ". Each one stores what a single person needs.",
      [search, h("button", { class: "btn primary", onclick: () => P.recipeEditor(null) }, svg("plus"), "New dish")]));
    const gridHost = h("div", { class: "dish-grid" });
    function render() {
      clear(gridHost);
      const query = recipeState.query.toLowerCase();
      const shown = recipes.filter((recipe) => !query || [recipe.display, recipe.name_fa, recipe.raw_name].concat(recipe.tags).join(" ").toLowerCase().includes(query));
      if (!recipes.length) {
        gridHost.appendChild(h("div", { class: "empty" }, icon("cooking"), h("p", null, "Add the dishes you cook at home. Type the name the way you say it."),
          h("button", { class: "btn primary", onclick: () => P.recipeEditor(null) }, "Add a dish")));
        return;
      }
      for (const recipe of shown) {
        const kcal = recipe.nutrition_per_person.kcal;
        gridHost.appendChild(h("article", { class: "dish" },
          h("button", { class: "dish-plate", onclick: () => recipe.image_candidates.length || recipe.image_status === "searching" ? P.imageChooser(recipe) : P.recipeEditor(recipe), "aria-label": "Photo for " + recipe.display },
            P.plate(recipe, { size: ctx.mobile ? "88px" : "104px" }),
            recipe.image_status === "choosing" ? h("span", { class: "chip warn dish-badge" }, "pick a photo") : null),
          h("div", { class: "dish-body" },
            h("h3", null, recipe.display),
            recipe.name_fa ? h("div", { class: "fa" }, recipe.name_fa) : null,
            recipe.status === "pending" ? h("div", { class: "muted", style: { fontSize: "var(--s-1)" } }, "Name, photo and details on the way") : null,
            h("div", { class: "row wrap", style: { gap: "6px", marginTop: "8px" } },
              recipe.tags.slice(0, 3).map((tag) => h("span", { class: "chip" }, tag)),
              kcal ? h("span", { class: "chip" }, Math.round(kcal), " kcal each" + (recipe.nutrition_complete ? "" : " approx")) : null),
            h("div", { class: "dish-ingredients" }, recipe.slots.map((slot) => {
              const main = slot.items.find((item) => item.is_default) || slot.items[0];
              return h("span", { class: "ing-pill" + (main.optional ? " optional" : ""), title: slot.items.map((item) => item.ingredient.display).join(" or ") }, ingredientIcon(main.ingredient, "sm"), main.ingredient.display, slot.items.length > 1 ? " +" + (slot.items.length - 1) : "");
            })),
            h("div", { class: "row wrap dish-actions", style: { marginTop: "auto", paddingTop: "10px" } },
              h("button", { class: "btn small", onclick: () => P.recipeEditor(recipe) }, svg("edit"), "Edit"),
              h("button", { class: "btn small ghost", onclick: () => P.imageChooser(recipe) }, svg("image"), "Photo"),
              h("button", { class: "btn small ghost", onclick: async () => {
                if (await P.confirmSheet("Archive " + recipe.display + "?", "It stops showing up in suggestions. Future planned meals with it are removed.", "Archive", true)) {
                  await mutate("POST", "/api/recipes/" + recipe.id + "/archive", { archived: true });
                  P.emit("changed");
                }
              } }, "Archive")))));
      }
    }
    search.addEventListener("input", () => { recipeState.query = search.value; render(); });
    render();
    host.appendChild(gridHost);
  }

  const pantryState = { tab: "food" };

  async function pantryView(host, ctx) {
    const data = await get("/api/inventory");
    clear(host);
    const adder = P.ingredientPicker({ placeholder: "Add to the pantry: name in any language", onPick: async (picked) => {
      if (picked.ingredient) P.adjustSheet(Object.assign({ display: picked.ingredient.display }, picked.ingredient), "add", () => P.emit("changed"));
      else {
        const created = await mutate("POST", "/api/ingredients", { name: picked.name, kind: pantryState.tab === "household" ? "household" : undefined });
        P.adjustSheet(created, "add", () => P.emit("changed"));
      }
    } });
    host.appendChild(pageHead("Pantry", data.last_count ? "Last full check on " + shortDate(data.last_count) + "." : "No full check yet. Do one when you start.",
      [h("button", { class: "btn", onclick: () => countSheet(data.items) }, "Pantry check")]));
    host.appendChild(h("div", { class: "pantry-add" }, adder));
    const tabs = [["food", "Ingredients"], ["snack", "Snacks"], ["household", "Household"], ["staple", "Basics"], ["all", "Everything known"]];
    host.appendChild(h("div", { class: "tabs", role: "tablist" }, tabs.map(([key, label]) =>
      h("button", { role: "tab", "aria-selected": String(pantryState.tab === key), onclick: () => { pantryState.tab = key; pantryView(host, ctx); } }, label))));
    const shown = data.items.filter((item) => {
      if (pantryState.tab === "all") return true;
      if (item.kind !== pantryState.tab) return false;
      return item.stock > 0 || item.pending_stock.length;
    });
    const listHost = h("div", { class: "pantry-list" });
    if (!shown.length) {
      listHost.appendChild(h("div", { class: "empty" }, icon("basket"), pantryState.tab === "staple"
        ? "Salt, oil and spices live here. They are never counted in plans."
        : "Nothing here yet. Add what you have, or finish a shopping trip."));
    }
    let category = null;
    for (const item of shown) {
      if (item.category !== category) {
        category = item.category;
        listHost.appendChild(h("div", { class: "group-title" }, category));
      }
      listHost.appendChild(h("button", { class: "list-row pantry-row", onclick: () => P.ingredientSheet(item.id) },
        ingredientIcon(item, "lg"),
        h("div", { class: "grow", style: { textAlign: "left" } }, names(item),
          h("div", { class: "row wrap", style: { gap: "6px", marginTop: "2px" } },
            item.status === "pending" ? h("span", { class: "chip warn" }, "details on the way") : null,
            item.status === "unresolved" ? h("span", { class: "chip bad" }, "not recognised") : null,
            item.expiring_estimate ? h("span", { class: "chip warn" }, "use soon, roughly by " + shortDate(item.expiring_estimate)) : null,
            item.pending_stock.map((entry) => h("span", { class: "chip" }, trim(entry.qty, 1), " ", entry.unit, " waiting for conversion")))),
        h("span", { class: "stock num" + (item.stock > 0 ? "" : " muted") }, item.stock > 0 ? qty(item.stock, item.unit) : "none")));
    }
    host.appendChild(listHost);
  }

  function countSheet(items) {
    const rows = items.filter((item) => item.kind !== "staple" && (item.stock > 0 || item.kind === "food"));
    const inputs = new Map();
    const body = h("div", null, h("p", { class: "soft" }, "Go through the kitchen and fix any number that is wrong. Leave the rest."));
    let category = null;
    for (const item of rows) {
      if (item.category !== category) {
        category = item.category;
        body.appendChild(h("div", { class: "group-title" }, category));
      }
      const input = h("input", { class: "input num", inputmode: "decimal", value: trim(item.stock, 1), style: { width: "100px" } });
      inputs.set(item.id, { input, original: item.stock });
      body.appendChild(h("div", { class: "list-row" }, ingredientIcon(item), h("div", { class: "grow" }, names(item)), input, h("span", { class: "muted", style: { width: "28px" } }, item.unit)));
    }
    const save = h("button", { class: "btn primary" }, "Save check");
    const sheet = P.openSheet({ title: "Pantry check", body, wide: true, footer: [h("button", { class: "btn ghost", onclick: () => sheet.close() }, "Cancel"), save] });
    save.addEventListener("click", async () => {
      const entries = [];
      for (const [id, entry] of inputs) {
        const value = parseNumber(entry.input.value);
        if (value !== null && Math.abs(value - entry.original) > 0.01) entries.push({ ingredient_id: id, qty: value });
      }
      await mutate("POST", "/api/inventory/count", { entries, full: true });
      sheet.close();
      toast("Pantry check saved");
      P.emit("changed");
    });
  }

  const Shop = {
    list: null,
    async load() {
      const data = await get("/api/shopping");
      if (!P.queue().length) {
        Shop.list = data.list;
        P.store("shop", Shop.list);
      } else {
        Shop.list = P.store("shop") || data.list;
      }
      return Shop.list;
    },
    save() {
      P.store("shop", Shop.list);
    },
    accept(result) {
      if (result && result.list && !P.queue().length) {
        Shop.list = result.list;
        Shop.save();
      }
    },
    total(sessionId) {
      if (!Shop.list) return 0;
      return Shop.list.items.filter((item) => item.checked && (!sessionId || String(item.session_id) === String(sessionId))).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    },
    activeSession() {
      return Shop.list && Shop.list.active_session;
    },
  };

  function storeSheet(onStarted) {
    const stores = P.state.boot.stores || [];
    const input = h("input", { class: "input", placeholder: "Rewe, Aldi, Lidl, Persian shop", list: "pantry-stores" });
    const datalist = h("datalist", { id: "pantry-stores" }, stores.map((name) => h("option", { value: name })));
    const start = h("button", { class: "btn primary" }, "Start");
    const sheet = P.openSheet({
      title: "Where are you shopping?",
      body: h("div", { class: "stack" }, input, datalist, stores.length ? h("div", { class: "row wrap" }, stores.slice(0, 6).map((name) => h("button", { class: "chip", type: "button", onclick: () => { input.value = name; } }, name))) : null),
      footer: [h("button", { class: "btn ghost", onclick: () => sheet.close() }, "Cancel"), start],
    });
    start.addEventListener("click", async () => {
      const name = input.value.trim() || "Store";
      sheet.close();
      const temp = "tmp-s-" + P.uid();
      const result = await mutate("POST", "/api/shopping/sessions", { store: name }, { offline: true, temp });
      if (result.queued) {
        if (!Shop.list) Shop.list = { id: null, items: [], sessions: [], status: "open" };
        const session = { id: temp, store: name, status: "active", total: 0 };
        Shop.list.sessions = (Shop.list.sessions || []).map((entry) => Object.assign(entry, { status: entry.status === "active" ? "paused" : entry.status })).concat([session]);
        Shop.list.active_session = session;
        Shop.save();
      } else {
        Shop.accept(result);
      }
      if (onStarted) onStarted();
    });
  }

  async function shopView(host, ctx) {
    await Shop.load();
    renderShop(host, ctx);
  }

  function renderShop(host, ctx) {
    clear(host);
    const list = Shop.list;
    const session = Shop.activeSession();
    const subtitle = list && list.range_start ? "For meals from " + shortDate(list.range_start) + " to " + shortDate(list.range_end) + "." : "Add anything you need. Build from the planner to fill it from your meals.";
    host.appendChild(pageHead("Shopping", subtitle, [
      h("button", { class: "btn", onclick: () => buildListSheet(ctx) }, "Rebuild from plan"),
      session ? null : h("button", { class: "btn primary", onclick: () => storeSheet(() => renderShop(host, ctx)) }, svg("cart"), "Start shopping"),
    ]));
    const adder = P.ingredientPicker({ placeholder: "Add an item: panir, kiri, Milch, toilet paper", onPick: (picked) => addItem(picked, host, ctx) });
    host.appendChild(h("div", { class: "shop-add" }, adder));

    if (!list || !list.items.length) {
      host.appendChild(h("div", { class: "empty" }, icon("shopping-cart"), h("p", null, "The list is empty.")));
    } else {
      const open = list.items.filter((item) => !item.committed);
      const done = list.items.filter((item) => item.committed);
      const listHost = h("div", { class: "shop-list" });
      let category = null;
      for (const item of open) {
        if (item.ingredient.category !== category) {
          category = item.ingredient.category;
          listHost.appendChild(h("div", { class: "group-title" }, category));
        }
        listHost.appendChild(shopRow(item, host, ctx));
      }
      host.appendChild(listHost);
      if (done.length) {
        host.appendChild(h("details", { class: "done-block" }, h("summary", { class: "soft" }, done.length + " already in the pantry"),
          done.map((item) => h("div", { class: "list-row done" }, ingredientIcon(item.ingredient, "sm"), h("span", { class: "grow" }, item.ingredient.display), h("span", { class: "muted num" }, qty(item.bought_qty, item.bought_unit)), h("span", { class: "num" }, money(item.price))))));
      }
      if (list.sessions && list.sessions.length) {
        host.appendChild(h("div", { class: "panel sessions" }, h("h4", null, "Trips on this list"), list.sessions.map((entry) =>
          h("div", { class: "list-row" }, h("span", { class: "grow" }, entry.store, " ", h("span", { class: "muted" }, entry.status === "finished" ? "finished" : entry.status === "active" ? "now" : "paused")),
            h("b", { class: "num" }, money(entry.status === "finished" ? entry.total : Shop.total(entry.id))),
            entry.status === "paused" ? h("button", { class: "btn small", onclick: async () => { Shop.accept(await mutate("POST", "/api/shopping/sessions/" + entry.id + "/resume")); renderShop(host, ctx); } }, "Resume") : null))));
      }
      if (list.id) {
        host.appendChild(h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "18px" } }, h("button", { class: "btn ghost danger", onclick: async () => {
          const remaining = list.items.filter((item) => !item.committed && !item.checked).length;
          const ok = await P.confirmSheet("Close this list?", (remaining ? remaining + " item" + (remaining === 1 ? " was" : "s were") + " not bought and will be removed. You will get a note for any planned dish that now lacks something. " : "") + "Ticked items go into the pantry.", "Close list");
          if (!ok) return;
          await mutate("POST", "/api/shopping/" + list.id + "/close");
          toast("List closed");
          P.store("shop", null);
          P.emit("changed");
        } }, "Close list")));
      }
    }
    if (session) host.appendChild(sessionBar(session, host, ctx));
  }

  function sessionBar(session, host, ctx) {
    const total = Shop.total(session.id);
    const count = Shop.list.items.filter((item) => item.checked && !item.committed && String(item.session_id) === String(session.id)).length;
    return h("div", { class: "session-bar" },
      h("div", { class: "grow" }, h("div", { class: "muted" }, "At ", session.store, ", ", count, " item" + (count === 1 ? "" : "s")), h("div", { class: "session-total num" }, money(total))),
      h("button", { class: "btn", onclick: async () => {
        Shop.accept(await mutate("POST", "/api/shopping/sessions/" + session.id + "/pause", undefined, { offline: true }));
        Shop.list.active_session = null;
        Shop.save();
        renderShop(host, ctx);
      } }, "Pause"),
      h("button", { class: "btn primary", onclick: async () => {
        const result = await mutate("POST", "/api/shopping/sessions/" + session.id + "/finish", undefined, { offline: true });
        if (result.queued) {
          for (const item of Shop.list.items) if (item.checked && String(item.session_id) === String(session.id)) item.committed = 1;
          session.status = "finished";
          Shop.list.active_session = null;
          Shop.save();
          toast("Saved here. It will reach the pantry when you are back online.");
        } else {
          Shop.accept(result);
          toast("Trip saved to the pantry");
          P.emit("changed");
        }
        renderShop(host, ctx);
      } }, "Finish at this store"));
  }

  function shopRow(item, host, ctx) {
    const ingredient = item.ingredient;
    const unit = item.bought_unit || (item.packages ? "pack" : item.pieces || ingredient.unit === "pcs" || ingredient.kind === "household" || !item.needed_qty ? "pcs" : ingredient.unit === "g" && item.needed_qty >= 1000 ? "kg" : ingredient.unit === "ml" && item.needed_qty >= 1000 ? "l" : ingredient.unit);
    function hint(forUnit) {
      if (forUnit === "pack") return item.packages ? String(item.packages) : "1";
      if (forUnit === "pcs") return item.pieces ? String(item.pieces) : ingredient.unit === "pcs" && item.needed_qty ? trim(item.needed_qty, 0) : "1";
      if (!item.needed_qty) return "";
      if (forUnit === "kg" || forUnit === "l") return trim(item.needed_qty / 1000, 2);
      return trim(item.needed_qty, 0);
    }
    const amount = h("input", { class: "input num", inputmode: "decimal", placeholder: hint(unit), value: item.bought_qty ? trim(item.bought_qty, 2) : "", "aria-label": "Amount bought" });
    const price = h("input", { class: "input num", inputmode: "decimal", placeholder: "€", value: item.price !== null && item.price !== undefined ? String(item.price).replace(".", ",") : "", "aria-label": "Price" });
    let currentUnit = unit;
    const toggle = h("select", { class: "input unit-select shop-unit", "aria-label": "Unit" },
      ["g", "kg", "ml", "l", "pcs", "pack"].map((value) => h("option", { value, selected: value === currentUnit }, value === "pack" ? "pack" : value)));
    toggle.addEventListener("change", () => {
      currentUnit = toggle.value;
      amount.placeholder = hint(currentUnit);
      if (currentUnit === "pack" && !ingredient.package_amount) toast("Set how much one pack holds in the details of " + ingredient.display + " so the pantry can count it");
      patch({ bought_unit: currentUnit });
    });
    const check = h("button", { class: "check", role: "checkbox", "aria-checked": String(!!item.checked), "aria-label": "Bought " + ingredient.display }, svg("check"));
    const need = item.packages ? item.packages + " pack" + (item.packages === 1 ? "" : "s") + ", " + qty(item.needed_qty, ingredient.unit) : item.pieces ? item.pieces + " pcs, about " + qty(item.needed_qty, ingredient.unit) : item.needed_qty ? qty(item.needed_qty, ingredient.unit) : null;
    const row = h("div", { class: "shop-row" + (item.checked ? " is-checked" : "") },
      check,
      ingredientIcon(ingredient, "lg"),
      h("div", { class: "grow shop-name" },
        h("div", null, names(ingredient)),
        h("div", { class: "muted shop-meta" }, ingredient.name_de ? h("span", { class: "de" }, ingredient.name_de) : null, need ? h("span", null, "need ", need) : null, item.auto ? null : item.source === "alexa" ? h("span", { class: "chip source-chip alexa" }, svg("mic"), "Alexa") : item.source === "automation" ? h("span", { class: "chip source-chip" }, svg("link"), "Automation") : h("span", null, "added by hand"))),
      h("div", { class: "shop-inputs" }, amount, toggle, price),
      h("button", { class: "btn icon small ghost", "aria-label": "Remove " + ingredient.display, onclick: async () => {
        Shop.list.items = Shop.list.items.filter((entry) => entry !== item);
        Shop.save();
        renderShop(host, ctx);
        Shop.accept(await mutate("DELETE", "/api/shopping/items/" + item.id, undefined, { offline: true }));
      } }, svg("trash")));
    async function patch(data) {
      Object.assign(item, data);
      Shop.save();
      const result = await mutate("PATCH", "/api/shopping/items/" + item.id, data, { offline: true });
      if (!result.queued) {
        const fresh = result.list && result.list.items.find((entry) => entry.id === item.id);
        if (fresh) Object.assign(item, { session_id: fresh.session_id });
        if (result.list && !P.queue().length) {
          Shop.list.sessions = result.list.sessions;
          Shop.list.active_session = result.list.active_session;
        }
        Shop.save();
      }
      refreshBar();
    }
    function refreshBar() {
      const bar = host.querySelector(".session-bar");
      const session = Shop.activeSession();
      if (bar && session) bar.replaceWith(sessionBar(session, host, ctx));
    }
    check.addEventListener("click", () => {
      const session = Shop.activeSession();
      if (!item.checked && !session) {
        storeSheet(() => { renderShop(host, ctx); });
        return;
      }
      const next = !item.checked;
      check.setAttribute("aria-checked", String(next));
      row.classList.toggle("is-checked", next);
      const data = { checked: next };
      if (next) {
        data.session_id = session.id;
        item.session_id = session.id;
        if (!item.bought_qty) {
          const typed = parseNumber(amount.value);
          if (typed) { data.bought_qty = typed; data.bought_unit = currentUnit; }
        }
      } else {
        item.session_id = null;
      }
      patch(data);
    });
    amount.addEventListener("change", () => patch({ bought_qty: parseNumber(amount.value), bought_unit: currentUnit }));
    price.addEventListener("change", () => {
      const value = parseNumber(price.value);
      if (value !== null && value < 0) { toast("Price cannot be negative", true); return; }
      patch({ price: value });
    });
    return row;
  }

  async function addItem(picked, host, ctx) {
    const session = Shop.activeSession();
    const body = { ingredient_id: picked.ingredient_id, name: picked.name };
    if (session) { body.checked = true; body.session_id = session.id; }
    const temp = "tmp-i-" + P.uid();
    const result = await mutate("POST", "/api/shopping/items", body, { offline: true, temp });
    if (result.queued) {
      if (!Shop.list) Shop.list = { id: null, items: [], sessions: [], status: "open" };
      Shop.list.items.push({
        id: temp, auto: 0, checked: session ? 1 : 0, committed: 0, session_id: session ? session.id : null, needed_qty: null, price: null, bought_qty: null,
        ingredient: picked.ingredient || { display: picked.name, category: "other", status: "pending", unit: "g", kind: "food" },
      });
      Shop.save();
    } else {
      Shop.accept(result);
    }
    renderShop(host, ctx);
    const inputs = host.querySelectorAll(".shop-add input");
    if (inputs.length) inputs[0].focus();
  }

  const reportState = { tab: "money", period: "week", start: null, end: null };
  let chartLoader = null;
  function loadCharts() {
    if (window.Chart) return Promise.resolve();
    if (!chartLoader) chartLoader = new Promise((resolve, reject) => {
      const script = h("script", { src: "/static/vendor/chart.umd.min.js" });
      script.onload = () => {
        Chart.defaults.color = "#c9bcc9";
        Chart.defaults.font.family = "Manrope, system-ui, sans-serif";
        Chart.defaults.borderColor = "rgba(70, 55, 79, 0.6)";
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return chartLoader;
  }

  const SERIES = ["#f2a93b", "#a9cf83", "#e7a3c4", "#8fb8ea", "#ec5a6b", "#d9c27a", "#9f8fd6", "#6fc7b8"];

  function chartBox(config, height) {
    const canvas = h("canvas");
    const box = h("div", { class: "chart", style: { height: (height || 240) + "px" } }, canvas);
    loadCharts().then(() => {
      config.options = Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: config.data.datasets.length > 1, labels: { boxWidth: 12 } } } }, config.options || {});
      new Chart(canvas, config);
    });
    return box;
  }

  async function reportsView(host, ctx) {
    clear(host);
    host.appendChild(pageHead("Reports", "Money, prices, nutrition and how each plan went.", [
      h("a", { class: "btn", href: "/api/export.xlsx", download: "" }, svg("download"), "Excel"),
      h("select", { class: "input", style: { width: "auto" }, onchange: (event) => { if (event.target.value) location.href = "/api/export/" + event.target.value + ".csv"; event.target.value = ""; } },
        h("option", { value: "" }, "CSV export"), ["purchases", "meals", "snacks", "waste", "inventory", "recipes"].map((name) => h("option", { value: name }, name))),
    ]));
    const tabs = [["money", "Money"], ["prices", "Prices"], ["nutrition", "Nutrition"], ["plans", "Plans"]];
    host.appendChild(h("div", { class: "tabs", role: "tablist" }, tabs.map(([key, label]) =>
      h("button", { role: "tab", "aria-selected": String(reportState.tab === key), onclick: () => { reportState.tab = key; reportsView(host, ctx); } }, label))));
    const body = h("div", { class: "report-body" });
    host.appendChild(body);
    try {
      if (reportState.tab === "money") await moneyReport(body);
      else if (reportState.tab === "prices") await pricesReport(body);
      else if (reportState.tab === "nutrition") await nutritionReport(body);
      else await plansReport(body);
    } catch (error) {
      errorBox(body, error);
    }
  }

  function rangeControls(onChange, withPeriod) {
    const start = h("input", { class: "input", type: "date", value: reportState.start || addDays(today(), -89) });
    const end = h("input", { class: "input", type: "date", value: reportState.end || today() });
    const apply = () => { reportState.start = start.value; reportState.end = end.value; onChange(); };
    start.addEventListener("change", apply);
    end.addEventListener("change", apply);
    const controls = h("div", { class: "row wrap" }, h("label", { class: "field" }, h("span", null, "From"), start), h("label", { class: "field" }, h("span", null, "To"), end));
    if (withPeriod) {
      controls.appendChild(h("label", { class: "field" }, h("span", null, "Group by"), h("select", { class: "input", onchange: (event) => { reportState.period = event.target.value; onChange(); } },
        ["day", "week", "month"].map((value) => h("option", { value, selected: value === reportState.period }, value)))));
    }
    return controls;
  }

  async function moneyReport(body) {
    const params = "?period=" + reportState.period + (reportState.start ? "&start=" + reportState.start : "") + (reportState.end ? "&end=" + reportState.end : "");
    const data = await get("/api/reports/finance" + params);
    clear(body);
    body.appendChild(rangeControls(() => moneyReport(body), true));
    const s = data.summary;
    body.appendChild(h("div", { class: "kpis" },
      h("div", { class: "kpi" }, h("b", { class: "num" }, money(s.spent)), h("span", null, "spent")),
      h("div", { class: "kpi" }, h("b", { class: "num" }, money(s.per_day)), h("span", null, "per day")),
      h("div", { class: "kpi" }, h("b", { class: "num" }, money(s.avg_meal_cost)), h("span", null, "per cooked meal")),
      h("div", { class: "kpi" }, h("b", { class: "num" }, money(s.waste)), h("span", null, "thrown away, ", s.waste_share, "%")),
      h("div", { class: "kpi" }, h("b", { class: "num" }, s.trips), h("span", null, "shopping trips"))));
    const grid = h("div", { class: "report-grid" });
    grid.appendChild(h("section", { class: "panel span-2" }, h("h3", null, "Spending"), data.spending.length ? chartBox({
      type: "bar",
      data: { labels: data.spending.map((entry) => entry.bucket), datasets: [
        { label: "Spent", data: data.spending.map((entry) => entry.total), backgroundColor: SERIES[0], borderRadius: 6 },
        { label: "Cooked meals", data: data.spending.map((entry) => (data.meal_buckets.find((bucket) => bucket.bucket === entry.bucket) || {}).total || 0), backgroundColor: SERIES[1], borderRadius: 6 },
      ] },
      options: { scales: { y: { ticks: { callback: (value) => value + " €" } } } },
    }) : h("p", { class: "muted" }, "No purchases with prices in this range.")));
    grid.appendChild(h("section", { class: "panel" }, h("h3", null, "By store"), data.stores.map((entry) =>
      h("div", { class: "list-row" }, h("span", { class: "grow" }, entry.store, " ", h("span", { class: "muted" }, entry.trips, " trips")), h("b", { class: "num" }, money(entry.total))))));
    grid.appendChild(h("section", { class: "panel" }, h("h3", null, "By category"), data.categories.length ? chartBox({
      type: "doughnut",
      data: { labels: data.categories.map((entry) => entry.category), datasets: [{ data: data.categories.map((entry) => entry.total), backgroundColor: SERIES, borderWidth: 0 }] },
      options: { plugins: { legend: { display: true, position: "right" } }, cutout: "62%" },
    }, 220) : h("p", { class: "muted" }, "Nothing yet.")));
    grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Where the money goes"), data.top_items.map((entry) =>
      h("div", { class: "list-row" }, icon(entry.icon, "sm"), h("span", { class: "grow" }, names(entry)), h("span", { class: "muted" }, entry.purchases, "x"), h("b", { class: "num" }, money(entry.total))))));
    grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Cost per dish"), data.recipe_costs.length ? data.recipe_costs.map((entry) =>
      h("div", { class: "list-row" }, h("span", { class: "grow" }, entry.display, " ", h("span", { class: "muted" }, entry.times, "x")), h("span", { class: "num soft" }, money(entry.per_serving), " each"), h("b", { class: "num" }, money(entry.total)))) : h("p", { class: "muted" }, "Cook something to see this.")));
    grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Thrown away"), data.waste_items.length ? data.waste_items.map((entry) =>
      h("div", { class: "list-row" }, icon(entry.icon, "sm"), h("span", { class: "grow" }, entry.display), h("span", { class: "muted num" }, qty(entry.qty, entry.unit)), h("b", { class: "num bad" }, money(entry.total)))) : h("p", { class: "muted" }, "Nothing wasted in this range.")));
    grid.appendChild(h("section", { class: "panel span-2" }, h("h3", null, "Cooked meals"), data.meals.length ? data.meals.map((meal) =>
      h("div", { class: "list-row" }, h("span", { class: "day-tag" }, shortDate(meal.date)), h("span", { class: "grow" }, meal.display, " ", h("span", { class: "muted" }, "for ", trim(meal.servings, 1))),
        meal.kcal ? h("span", { class: "muted num" }, Math.round(meal.kcal), " kcal") : null, h("b", { class: "num" }, money(meal.cost)))) : h("p", { class: "muted" }, "No cooked meals yet.")));
    body.appendChild(grid);
  }

  async function pricesReport(body) {
    const data = await get("/api/reports/prices");
    clear(body);
    if (!data.length) {
      body.appendChild(h("div", { class: "empty" }, icon("shopping-cart"), "Prices appear after your first shopping trip with prices entered."));
      return;
    }
    const grid = h("div", { class: "report-grid" });
    for (const entry of data) {
      const change = entry.change_pct;
      grid.appendChild(h("section", { class: "panel" },
        h("div", { class: "row" }, icon(entry.icon), h("div", { class: "grow" }, names(entry)),
          change !== null ? h("span", { class: "chip " + (change > 0 ? "bad" : change < 0 ? "good" : "") }, (change > 0 ? "+" : "") + change + "%") : null),
        entry.history.length > 1 ? chartBox({
          type: "line",
          data: { labels: entry.history.map((point) => shortDate(point.date)), datasets: [{ label: entry.unit_label, data: entry.history.map((point) => point.unit_price), borderColor: SERIES[0], backgroundColor: SERIES[0], tension: 0.3, pointRadius: 3 }] },
          options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (value) => value + " €" } } } },
        }, 150) : h("p", { class: "soft num" }, money(entry.history[0].unit_price), " ", entry.unit_label),
        h("div", { class: "row wrap", style: { marginTop: "8px" } }, entry.stores.map((store) => h("span", { class: "chip" }, store.store, " ", money(store.avg), " ", entry.unit_label)))));
    }
    body.appendChild(grid);
  }

  async function nutritionReport(body) {
    const params = "?" + (reportState.start ? "start=" + reportState.start + "&" : "") + (reportState.end ? "end=" + reportState.end : "");
    const data = await get("/api/reports/nutrition" + params);
    clear(body);
    body.appendChild(rangeControls(() => nutritionReport(body), false));
    body.appendChild(h("p", { class: "muted" }, "Totals for everything cooked at home plus logged snacks, not per person.", data.incomplete_meals ? " " + data.incomplete_meals + " meals are missing some nutrition data." : ""));
    if (!data.days.length) {
      body.appendChild(h("div", { class: "empty" }, icon("green-salad"), "Cook a planned dish to start seeing this."));
      return;
    }
    const grid = h("div", { class: "report-grid" });
    grid.appendChild(h("section", { class: "panel span-2" }, h("h3", null, "Calories per day"), chartBox({
      type: "bar",
      data: { labels: data.days.map((day) => shortDate(day.date)), datasets: [
        { label: "Meals", data: data.days.map((day) => day.meal_kcal), backgroundColor: SERIES[0], borderRadius: 4, stack: "k" },
        { label: "Snacks", data: data.days.map((day) => day.snack_kcal), backgroundColor: SERIES[2], borderRadius: 4, stack: "k" },
      ] },
      options: { scales: { x: { stacked: true }, y: { stacked: true } } },
    })));
    grid.appendChild(h("section", { class: "panel span-2" }, h("h3", null, "Protein, fat and carbs per day"), chartBox({
      type: "line",
      data: { labels: data.days.map((day) => shortDate(day.date)), datasets: [
        { label: "Protein g", data: data.days.map((day) => day.protein), borderColor: SERIES[1], backgroundColor: SERIES[1], tension: 0.3 },
        { label: "Fat g", data: data.days.map((day) => day.fat), borderColor: SERIES[2], backgroundColor: SERIES[2], tension: 0.3 },
        { label: "Carbs g", data: data.days.map((day) => day.carbs), borderColor: SERIES[3], backgroundColor: SERIES[3], tension: 0.3 },
      ] },
    })));
    grid.appendChild(h("section", { class: "panel span-2" }, h("h3", null, "Weekly"), h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", null, h("tr", null, ["Week of", "Days", "kcal", "Protein", "Fat", "Carbs", "Fiber"].map((label) => h("th", null, label)))),
      h("tbody", null, data.weeks.map((week) => h("tr", null, h("td", null, shortDate(week.week)), h("td", { class: "num" }, week.days),
        ["kcal", "protein", "fat", "carbs", "fiber"].map((key) => h("td", { class: "num" }, Math.round(week[key]), key === "kcal" ? "" : " g")))))))));
    body.appendChild(grid);
  }

  async function plansReport(body) {
    const periods = await get("/api/reports/periods");
    clear(body);
    if (!periods.length) {
      body.appendChild(h("div", { class: "empty" }, icon("tear-off-calendar"), "Build a shopping list from a plan to get a report when it ends."));
      return;
    }
    const select = h("select", { class: "input", style: { maxWidth: "340px" } }, periods.map((period) => h("option", { value: period.id }, shortDate(period.range_start) + " to " + shortDate(period.range_end) + (period.status === "open" ? ", list open" : ""))));
    const detail = h("div");
    body.append(select, detail);
    async function show() {
      const report = await get("/api/reports/period/" + select.value);
      clear(detail);
      detail.appendChild(h("div", { class: "kpis" },
        h("div", { class: "kpi" }, h("b", { class: "num" }, report.cooked_meals, " of ", report.planned_meals), h("span", null, "planned meals cooked")),
        h("div", { class: "kpi" }, h("b", { class: "num" }, report.shortages.length), h("span", null, "items ran short")),
        h("div", { class: "kpi" }, h("b", { class: "num" }, report.surplus.length), h("span", null, "items left over"))));
      const grid = h("div", { class: "report-grid" });
      grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Ran short"), report.shortages.length ? report.shortages.map((line) =>
        h("div", { class: "list-row" }, icon(line.icon, "sm"), h("span", { class: "grow" }, line.display), h("span", { class: "bad num" }, qty(line.short, line.unit), " missing"))) : h("p", { class: "muted" }, "Nothing ran out.")));
      grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Left over"), report.surplus.length ? report.surplus.map((line) =>
        h("div", { class: "list-row" }, icon(line.icon, "sm"), h("span", { class: "grow" }, line.display), h("span", { class: "muted num" }, "bought ", qty(line.bought, line.unit)), h("span", { class: "num" }, qty(line.left, line.unit), " left"))) : h("p", { class: "muted" }, "Nothing left over.")));
      detail.appendChild(grid);
    }
    select.addEventListener("change", show);
    if (reportState.periodId) select.value = reportState.periodId;
    show();
  }

  async function alertsView(host, ctx) {
    const alerts = await get("/api/alerts");
    clear(host);
    host.appendChild(pageHead("Notes", "Things the pantry noticed. Dismissed notes do not come back."));
    if (!alerts.length) {
      host.appendChild(h("div", { class: "empty" }, icon("teacup-without-handle"), "All quiet."));
      return;
    }
    const listHost = h("div", { class: "stack" });
    for (const alert of alerts) {
      const actions = [];
      if (alert.kind === "missing") actions.push(h("button", { class: "btn small primary", onclick: async () => { await mutate("POST", "/api/alerts/" + alert.id + "/act"); toast("Added to the shopping list"); P.emit("changed"); } }, "Add to list"));
      if (alert.kind === "tomorrow") actions.push(h("button", { class: "btn small", onclick: () => ctx.navigate("plan") }, "Open plan"));
      if (alert.kind === "period") actions.push(h("button", { class: "btn small", onclick: () => { reportState.tab = "plans"; reportState.periodId = alert.payload.list_id; ctx.navigate("reports"); } }, "See report"));
      if (alert.kind === "stock_count") actions.push(h("button", { class: "btn small", onclick: () => ctx.navigate("pantry") }, "Open pantry"));
      if (alert.kind === "plan") actions.push(h("button", { class: "btn small", onclick: () => ctx.navigate("plan") }, "Plan meals"));
      if (alert.kind === "expiry" && alert.payload.ingredient_id) actions.push(h("button", { class: "btn small", onclick: () => P.ingredientSheet(alert.payload.ingredient_id) }, "Open item"));
      actions.push(h("button", { class: "btn small ghost", onclick: async () => { await mutate("POST", "/api/alerts/" + alert.id + "/dismiss"); P.emit("changed"); } }, "Dismiss"));
      listHost.appendChild(h("article", { class: "panel alert " + alert.kind },
        h("div", { class: "row" }, h("span", { class: "dot " + alert.kind }), h("h4", { class: "grow" }, alert.title), h("span", { class: "muted", style: { fontSize: "var(--s-1)" } }, shortDate(alert.created_at))),
        alert.body ? h("p", { class: "soft", style: { margin: "6px 0 10px 20px" } }, alert.body) : null,
        h("div", { class: "row wrap", style: { marginLeft: "20px" } }, actions)));
    }
    host.appendChild(listHost);
  }

  async function settingsView(host, ctx) {
    const [aiState, pushState] = await Promise.all([get("/api/ai"), P.pushStatus()]);
    await P.refreshBoot();
    clear(host);
    host.appendChild(pageHead("Settings"));
    const grid = h("div", { class: "report-grid" });
    grid.appendChild(h("section", { class: "panel" }, h("h3", null, "People"), P.state.boot.users.map((user) => {
      const input = h("input", { class: "input", value: user.name });
      const color = h("input", { type: "color", value: user.color, style: { width: "44px", height: "40px", border: "0", background: "transparent" } });
      return h("div", { class: "row", style: { marginTop: "10px" } }, color, input, h("button", { class: "btn small", onclick: async () => {
        await mutate("PATCH", "/api/users/" + user.id, { name: input.value, color: color.value });
        await P.refreshBoot();
        if (P.state.user && P.state.user.id === user.id) P.setUser(P.state.boot.users.find((entry) => entry.id === user.id));
        toast("Saved");
      } }, "Save"));
    }), h("div", { class: "row", style: { marginTop: "12px" } }, h("span", { class: "soft grow" }, "This device: ", P.state.user ? P.state.user.name : "nobody"), h("button", { class: "btn small", onclick: () => P.userChooser(() => settingsView(host, ctx)) }, "Switch"))));
    const servings = h("input", { class: "input num", inputmode: "decimal", value: trim(P.state.boot.default_servings, 1), style: { width: "90px" } });
    grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Planning"), h("div", { class: "row", style: { marginTop: "10px" } }, h("span", { class: "grow soft" }, "People per meal by default"), servings,
      h("button", { class: "btn small", onclick: async () => { await mutate("PATCH", "/api/settings", { default_servings: parseNumber(servings.value) }); await P.refreshBoot(); toast("Saved"); } }, "Save"))));
    grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Notifications on this device"),
      h("p", { class: "soft", style: { margin: "8px 0" } }, pushState === "on" ? "On." : pushState === "unsupported" ? "Not available here. On iPhone, open Pantry from the home screen icon." : "Off."),
      h("div", { class: "row" },
        pushState !== "on" && pushState !== "unsupported" ? h("button", { class: "btn primary small", onclick: async () => { if (await P.enablePush()) settingsView(host, ctx); } }, svg("bell"), "Turn on") : null,
        pushState === "on" ? h("button", { class: "btn small", onclick: async () => { const result = await mutate("POST", "/api/push/test"); toast("Sent to " + result.sent + " device" + (result.sent === 1 ? "" : "s")); } }, "Send a test") : null)));
    grid.appendChild(assistantPanel(aiState, () => settingsView(host, ctx)));
    grid.appendChild(alexaPanel());
    grid.appendChild(await automationPanel(() => settingsView(host, ctx)));
    if (false) grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Assistant"),
      h("div", { class: "row", style: { margin: "8px 0" } }, h("span", { class: "ai-dot " + (!aiState.key_set ? "off" : aiState.queued ? "busy" : "") }),
        h("span", { class: "soft" }, !aiState.key_set ? "No key set on the server." : aiState.queued ? aiState.queued + " task" + (aiState.queued === 1 ? "" : "s") + " waiting" : "Up to date")),
      aiState.last_error ? h("p", { class: "muted" }, "Last problem: ", aiState.last_error) : null,
      aiState.cooldown_seconds ? h("p", { class: "muted" }, "Free quota pause, retrying in about ", Math.ceil(aiState.cooldown_seconds / 60), " min.") : null,
      aiState.queued ? h("button", { class: "btn small", onclick: async () => { await mutate("POST", "/api/ai/wake"); toast("Retrying now"); settingsView(host, ctx); } }, svg("refresh"), "Retry now") : null));
    if (!ctx.mobile) {
      grid.appendChild(h("section", { class: "panel" }, h("h3", null, "Phone app"), h("p", { class: "soft", style: { marginTop: "8px" } }, "Open the mobile version on the iPhone through the Tailscale address, then Share, Add to Home Screen."),
        h("a", { class: "btn small", href: "/m/", style: { marginTop: "10px" } }, "Open mobile version")));
    }
    host.appendChild(grid);
  }

  function copyButton(value, label) {
    return h("button", { class: "btn small ghost", type: "button", onclick: async () => {
      try { await navigator.clipboard.writeText(value); toast("Copied"); } catch (error) { toast("Copy did not work, select it by hand", true); }
    } }, svg("copy"), label || "Copy");
  }

  function codeLine(value) {
    return h("div", { class: "code-line" }, h("code", null, value), copyButton(value));
  }

  function alexaPanel() {
    const boot = P.state.boot;
    const skillInput = h("input", { class: "input", placeholder: "amzn1.ask.skill...", value: boot.alexa_skill_id || "" });
    const ready = !!boot.alexa_skill_id;
    return h("section", { class: "panel" },
      h("div", { class: "spread" }, h("h3", null, "Alexa"), h("span", { class: "chip " + (ready ? "good" : "bad") }, ready ? "Connected" : "Skill ID missing")),
      h("p", { class: "soft", style: { margin: "8px 0" } }, ready
        ? "Alexa can read and fill the shopping list, plan dishes and tell you the plan, in English and German."
        : "Alexa requests are refused until the skill ID is saved here. Copy it from the Alexa developer console."),
      h("div", { class: "row" }, skillInput, h("button", { class: "btn small", type: "button", onclick: async () => {
        await mutate("PATCH", "/api/settings", { alexa_skill_id: skillInput.value.trim() });
        await P.refreshBoot();
        toast("Saved");
      } }, "Save")),
      h("h4", { style: { marginTop: "14px" } }, "Endpoint"),
      codeLine(boot.alexa_endpoint || ""),
      h("h4", { style: { marginTop: "14px" } }, "Language models"),
      h("p", { class: "muted", style: { fontSize: "var(--s-1)" } }, "Paste into the JSON editor of the skill. Download again after adding many dishes so Alexa recognises the new names."),
      h("div", { class: "row wrap" }, ["en-US", "en-GB", "de-DE"].map((locale) =>
        h("a", { class: "btn small", href: "/api/alexa/model/" + locale, download: "pantry-" + locale + ".json" }, svg("download"), locale))),
      h("details", { class: "muted", style: { marginTop: "12px", fontSize: "var(--s-1)" } }, h("summary", null, "What to say"),
        h("ul", { class: "say-list" },
          ["Alexa, open pantry home", "What is on the shopping list", "Add rice to the shopping list, then answer: two kilos",
           "Plan ghormeh sabzi for Friday", "What is planned for tomorrow", "Do we have eggs", "Alexa, öffne meine Speisekammer", "Setze Milch auf die Einkaufsliste"].map((line) => h("li", null, line)))));
  }

  async function automationPanel(rerender) {
    const data = await get("/api/integrations");
    const origin = location.origin;
    const panel = h("section", { class: "panel automation-panel" });
    const tokensHost = h("div", { class: "stack tight" });
    for (const token of data.tokens) {
      tokensHost.appendChild(h("div", { class: "list-row" }, svg("key"),
        h("div", { class: "grow" }, h("b", null, token.name), h("div", { class: "muted", style: { fontSize: "var(--s-1)" } }, "ends in ", token.hint, token.last_used ? ", last used " + shortDate(token.last_used.slice(0, 10)) : ", never used")),
        h("button", { class: "btn small ghost danger", type: "button", onclick: async () => {
          if (await P.confirmSheet("Revoke " + token.name + "?", "Anything using this key stops working right away.", "Revoke", true)) {
            await mutate("DELETE", "/api/integrations/tokens/" + token.id);
            rerender();
          }
        } }, "Revoke")));
    }
    if (!data.tokens.length) tokensHost.appendChild(h("p", { class: "muted" }, "No keys yet. The gym app and automations need one."));
    const tokenName = h("input", { class: "input", placeholder: "Name, for example Gym app" });
    const newTokenBox = h("div");
    const hooksHost = h("div", { class: "stack tight" });
    for (const hook of data.webhooks) {
      hooksHost.appendChild(h("div", { class: "list-row" }, svg("link"),
        h("div", { class: "grow", style: { minWidth: 0 } }, h("b", { class: "ellipsis", style: { display: "block" } }, hook.name),
          h("div", { class: "muted ellipsis", style: { fontSize: "var(--s-1)" } }, hook.events.join(", ")),
          hook.last_status ? h("span", { class: "chip " + (/^2/.test(hook.last_status) ? "good" : "bad") }, "Last: ", hook.last_status) : null),
        h("button", { class: "btn small ghost", type: "button", onclick: async () => {
          const result = await mutate("POST", "/api/integrations/webhooks/" + hook.id + "/test");
          toast(result.ok ? "Delivered" : "Failed: " + result.status, !result.ok);
          rerender();
        } }, "Test"),
        h("button", { class: "btn small ghost danger", type: "button", onclick: async () => {
          await mutate("DELETE", "/api/integrations/webhooks/" + hook.id);
          rerender();
        } }, "Remove")));
    }
    if (!data.webhooks.length) hooksHost.appendChild(h("p", { class: "muted" }, "No webhooks. Add one to push events to Home Assistant, n8n or your own service."));
    const hookUrl = h("input", { class: "input", placeholder: "https://..." });
    const hookEvents = h("select", { class: "input", multiple: true, size: 5 }, [h("option", { value: "*", selected: true }, "All events")].concat(data.event_types.map((type) => h("option", { value: type }, type))));
    [
      h("div", { class: "spread" }, h("h3", null, "Automation and export"), h("span", { class: "chip" }, data.last_export ? "Last export " + shortDate(data.last_export.slice(0, 10)) : "Export runs at 4:00")),
      h("p", { class: "soft", style: { margin: "8px 0" } }, "Every night at 4:00 the nutrition of the previous day is saved per person and announced as an event. Other services read it with an API key."),
      h("h4", null, "API keys"),
      tokensHost,
      h("div", { class: "row", style: { marginTop: "8px" } }, tokenName, h("button", { class: "btn small primary", type: "button", onclick: async () => {
        const created = await mutate("POST", "/api/integrations/tokens", { name: tokenName.value });
        clear(newTokenBox).appendChild(h("div", { class: "new-token" },
          h("b", null, "Copy this key now, it is shown only once."), codeLine(created.token)));
        tokenName.value = "";
      } }, svg("key"), "Create key")),
      newTokenBox,
      h("h4", { style: { marginTop: "16px" } }, "Endpoints"),
      h("div", { class: "endpoint-list" },
        h("div", null, h("span", { class: "muted" }, "Nutrition per day and person, live"), codeLine(origin + "/api/export/nutrition?date=YYYY-MM-DD")),
        h("div", null, h("span", { class: "muted" }, "Saved daily exports"), codeLine(origin + "/api/export/nutrition/daily?start=YYYY-MM-DD")),
        h("div", null, h("span", { class: "muted" }, "Event feed for polling"), codeLine(origin + "/api/automation/events?after=0")),
        h("div", null, h("span", { class: "muted" }, "Current state"), codeLine(origin + "/api/automation/state")),
        h("p", { class: "muted", style: { fontSize: "var(--s-1)" } }, "Send the key as a header: Authorization: Bearer KEY. POST /api/automation/shopping and /api/automation/meals add items and dishes.")),
      h("div", { class: "row", style: { marginTop: "8px" } }, h("button", { class: "btn small", type: "button", onclick: async () => { await mutate("POST", "/api/integrations/export-now"); toast("Exported"); rerender(); } }, svg("refresh"), "Export now")),
      h("h4", { style: { marginTop: "16px" } }, "Webhooks"),
      hooksHost,
      h("div", { class: "stack tight", style: { marginTop: "8px" } }, hookUrl, hookEvents,
        h("button", { class: "btn small primary", type: "button", style: { alignSelf: "flex-start" }, onclick: async () => {
          const events = [...hookEvents.selectedOptions].map((option) => option.value);
          const created = await mutate("POST", "/api/integrations/webhooks", { url: hookUrl.value, events: events.includes("*") || !events.length ? ["*"] : events });
          await P.openSheet({ title: "Webhook added", body: h("div", { class: "stack" }, h("p", { class: "soft" }, "Every call carries the header X-Pantry-Signature, an HMAC SHA256 of timestamp, a dot and the body, signed with this secret. It is shown only once."), codeLine(created.secret)) });
          rerender();
        } }, svg("link"), "Add webhook")),
    ].forEach((node) => { if (node) panel.appendChild(node); });
    return panel;
  }

  function assistantPanel(aiState, rerender) {
    const minutes = (seconds) => seconds >= 3600 ? Math.floor(seconds / 3600) + " h " + Math.ceil((seconds % 3600) / 60) + " min" : Math.ceil(seconds / 60) + " min";
    const panel = h("section", { class: "panel" });
    const toggle = h("input", { type: "checkbox", checked: aiState.enabled });
    toggle.addEventListener("change", async () => {
      await mutate("PATCH", "/api/ai/settings", { enabled: toggle.checked });
      toast(toggle.checked ? "Assistant on" : "Assistant paused");
      rerender();
    });
    const keyInput = h("input", { class: "input", type: "password", autocomplete: "off", placeholder: aiState.key_hint ? "Current key " + aiState.key_hint : "Paste a Gemini API key" });
    let order = aiState.models.map((entry) => entry.name);
    const modelHost = h("div", { class: "stack" });
    function renderModels() {
      clear(modelHost);
      order.forEach((name, index) => {
        const info = aiState.models.find((entry) => entry.name === name) || { name, ok_today: 0, limited_today: 0, failed_today: 0, blocked_seconds: 0 };
        const result = h("span", { class: "muted" });
        modelHost.appendChild(h("div", { class: "list-row", style: { alignItems: "flex-start" } },
          h("span", { class: "chip" }, index === 0 ? "first" : "backup " + index),
          h("div", { class: "grow stack tight", style: { minWidth: 0 } },
            h("b", { class: "ellipsis" }, name),
            h("span", { class: "muted", style: { fontSize: "var(--s-1)" } },
              "Today: ", info.ok_today, " answered, ", info.limited_today, " over limit, ", info.failed_today, " failed"),
            info.blocked_seconds ? h("span", { class: "chip warn" }, "Free quota used up, back in ", minutes(info.blocked_seconds)) : h("span", { class: "chip" }, "Available"),
            info.last_error ? h("span", { class: "muted ellipsis", style: { fontSize: "var(--s-1)" }, title: info.last_error }, "Last error ", info.last_error) : null,
            result),
          h("div", { class: "row" },
            h("button", { class: "btn small ghost", type: "button", disabled: index === 0, onclick: () => { order.splice(index - 1, 0, order.splice(index, 1)[0]); renderModels(); } }, "Up"),
            h("button", { class: "btn small ghost", type: "button", onclick: async () => {
              result.textContent = "Testing...";
              const answer = await mutate("POST", "/api/ai/test", { model: name });
              result.textContent = answer.ok ? "Works, answered in " + answer.seconds + " s" : "Failed: " + answer.error;
            } }, "Test"),
            h("button", { class: "btn small ghost danger", type: "button", disabled: order.length === 1, onclick: () => { order.splice(index, 1); renderModels(); } }, "Remove"))));
      });
    }
    renderModels();
    const addSelect = h("select", { class: "input grow" }, h("option", { value: "" }, "Add a model..."));
    const loadModels = h("button", { class: "btn small", type: "button", onclick: async () => {
      try {
        const answer = await get("/api/ai/models");
        clear(addSelect);
        addSelect.appendChild(h("option", { value: "" }, "Add a model..."));
        answer.models.forEach((entry) => addSelect.appendChild(h("option", { value: entry.name }, entry.label + " (" + entry.name + ")")));
        toast(answer.models.length + " models found");
      } catch (error) { toast("Could not load models", true); }
    } }, "Load models");
    addSelect.addEventListener("change", () => {
      if (addSelect.value && !order.includes(addSelect.value)) { order.push(addSelect.value); renderModels(); }
      addSelect.value = "";
    });
    [
      h("div", { class: "spread" }, h("h3", null, "Assistant"),
        h("label", { class: "row soft", style: { gap: "6px" } }, toggle, aiState.enabled ? "On" : "Paused")),
      h("div", { class: "row", style: { margin: "8px 0" } }, h("span", { class: "ai-dot " + (!aiState.enabled || !aiState.key_set ? "off" : aiState.queued ? "busy" : "") }),
        h("span", { class: "soft" }, !aiState.enabled ? "Paused, tasks wait until you turn it back on" : !aiState.key_set ? "No key set" : aiState.queued ? aiState.queued + " task" + (aiState.queued === 1 ? "" : "s") + " waiting" : "Up to date")),
      aiState.last_error ? h("p", { class: "muted" }, "Last problem: ", aiState.last_error) : null,
      aiState.cooldown_seconds ? h("p", { class: "muted" }, "All models over the free limit, retrying in about ", minutes(aiState.cooldown_seconds)) : null,
      h("h4", null, "Key"),
      h("p", { class: "muted", style: { fontSize: "var(--s-1)" } }, aiState.key_source === "settings" ? "Using the key saved here." : aiState.key_source === "server" ? "Using the key from the server configuration." : "No key yet."),
      h("div", { class: "row" }, keyInput,
        h("button", { class: "btn small", type: "button", onclick: async () => {
          if (!keyInput.value.trim()) { toast("Paste a key first", true); return; }
          await mutate("PATCH", "/api/ai/settings", { api_key: keyInput.value.trim() });
          toast("Key saved"); rerender();
        } }, "Save key"),
        aiState.key_source === "settings" ? h("button", { class: "btn small ghost", type: "button", onclick: async () => {
          await mutate("PATCH", "/api/ai/settings", { api_key: "" });
          toast("Back to the server key"); rerender();
        } }, "Use server key") : null),
      h("h4", null, "Models in order of use"),
      h("p", { class: "muted", style: { fontSize: "var(--s-1)" } }, "The first model is used until it hits its free limit, then the next one takes over. Google does not report the remaining quota, so the counts below are what this server sent today."),
      modelHost,
      h("div", { class: "row", style: { marginTop: "8px" } }, addSelect, loadModels),
      h("div", { class: "row", style: { marginTop: "10px" } },
        h("button", { class: "btn primary small", type: "button", onclick: async () => { await mutate("PATCH", "/api/ai/settings", { models: order }); toast("Models saved"); rerender(); } }, "Save models"),
        aiState.queued && aiState.enabled ? h("button", { class: "btn small", type: "button", onclick: async () => { await mutate("POST", "/api/ai/wake"); toast("Retrying now"); rerender(); } }, svg("refresh"), "Retry now") : null),
    ].forEach((node) => { if (node) panel.appendChild(node); });
    return panel;
  }

  return { today: todayView, plan: plannerView, recipes: recipesView, pantry: pantryView, shop: shopView, reports: reportsView, alerts: alertsView, settings: settingsView, errorBox, snackSheet, Shop };
})();
