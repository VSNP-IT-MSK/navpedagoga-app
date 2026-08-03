/* ============================================================
   НавигаторПедагога — приложение (роутинг + рендер), на реальном API
   ============================================================ */
(function () {
  "use strict";
  const API = window.API;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (children || []).forEach(c => { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  };
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function mdLite(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\s)_([^_\n]+?)_(?=\s|$)/g, "$1<em>$2</em>").replace(/\n/g, "<br>"); }
  function toast(msg, isError) {
    const t = el("div", { class: "toast", style: isError ? "background:var(--magenta-ink);" : "" }, [msg]);
    $("#toastWrap").appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }
  function apiErr(e) { toast(e.message || "Что-то пошло не так", true); console.error(e); }
  const COLOR_HEX = { purple: "var(--purple)", magenta: "var(--magenta)", yellow: "var(--yellow)", green: "var(--green)" };

  /* =========================== LANDING =========================== */
  function renderLandingStatics() {
    const grid = $("#compGrid");
    grid.innerHTML = "";
    API.COMPETENCIES.forEach(c => {
      grid.appendChild(el("div", { class: "comp-pill" }, [el("div", { class: "ic" }, [c.icon]), el("h5", {}, [c.label]), el("p", {}, [c.desc])]));
    });

    const accWrap = $("#demoAccounts");
    accWrap.innerHTML = "";
    const demo = [
      { email: "user@np.ru", role: "Педагог", badge: "badge-magenta", name: "Молодой педагог", desc: "Диалог с ИИ, дорожная карта, мероприятия" },
      { email: "mentor@np.ru", role: "Наставник", badge: "badge-purple", name: "Наставник", desc: "Ведение подопечных, чат, заметки" },
      { email: "admin@np.ru", role: "Администратор", badge: "badge-yellow", name: "Администратор", desc: "Управление педагогами и мероприятиями" },
    ];
    demo.forEach(d => {
      const card = el("div", { class: "account-card" }, [
        el("span", { class: "badge " + d.badge }, [d.role]),
        el("h5", {}, [d.name]),
        el("p", {}, [d.email + " · 123456"]),
        el("p", { style: "margin-top:8px; font-family:var(--font-body); color:var(--ink-soft);" }, [d.desc]),
      ]);
      card.addEventListener("click", () => quickLogin(d.email));
      accWrap.appendChild(card);
    });

    const sample = { subject: 3, pedagogy: 2, method: 3, digital: 2, communication: 3, personal: 4 };
    const routeWrap = $("#heroRoute");
    routeWrap.innerHTML = "";
    API.COMPETENCIES.forEach((c, i) => {
      const score = sample[c.id];
      const weak = score <= 2;
      const cls = weak ? "current" : score >= 4 ? "done" : "";
      routeWrap.appendChild(el("div", { class: "route-node " + cls }, [
        el("div", { class: "route-dot " + cls }, [weak ? "!" : score >= 4 ? "✓" : String(i + 1)]),
        el("div", { class: "label" }, [`${c.icon} ${c.label} — ${score}/5${weak ? " · приоритет" : ""}`]),
      ]));
    });
  }

  async function quickLogin(email) {
    try { await API.login(email, "123456"); await enterApp(); }
    catch (e) { apiErr(e); }
  }

  function openAuth(tab) { $("#authModal").classList.remove("hidden"); setAuthTab(tab || "login"); }
  function closeAuth() { $("#authModal").classList.add("hidden"); $("#authError").innerHTML = ""; }
  function setAuthTab(tab) {
    $("#tabLogin").classList.toggle("active", tab === "login");
    $("#tabRegister").classList.toggle("active", tab === "register");
    $("#loginForm").classList.toggle("hidden", tab !== "login");
    $("#registerForm").classList.toggle("hidden", tab !== "register");
    $("#authError").innerHTML = "";
  }

  function bindLanding() {
    renderLandingStatics();
    $("#btnOpenLogin").addEventListener("click", () => openAuth("login"));
    $("#btnOpenRegister").addEventListener("click", () => openAuth("register"));
    $("#btnHeroStart").addEventListener("click", () => openAuth("register"));
    $("#btnAiShowcase").addEventListener("click", () => openAuth("register"));
    $("#btnHeroDemo").addEventListener("click", () => document.getElementById("demo").scrollIntoView({ behavior: "smooth" }));
    $("#authClose").addEventListener("click", closeAuth);
    $("#tabLogin").addEventListener("click", () => setAuthTab("login"));
    $("#tabRegister").addEventListener("click", () => setAuthTab("register"));
    $("#authModal").addEventListener("click", (e) => { if (e.target.id === "authModal") closeAuth(); });

    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await API.login($("#loginEmail").value.trim(), $("#loginPass").value);
        closeAuth(); await enterApp();
      } catch (err) { $("#authError").innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
    });

    $("#registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        fullName: $("#regName").value.trim(), email: $("#regEmail").value.trim(), password: $("#regPass").value,
        subject: $("#regSubject").value.trim(), yearsExperience: parseInt($("#regYears").value || "0", 10),
        school: $("#regSchool").value.trim(), region: $("#regRegion").value.trim(), role: $("#regRole").value,
      };
      if (payload.password.length < 4) { $("#authError").innerHTML = '<div class="form-error">Пароль должен быть не короче 4 символов.</div>'; return; }
      if (!payload.region) { $("#authError").innerHTML = '<div class="form-error">Укажите регион — по нему ИИ будет искать мероприятия.</div>'; return; }
      try {
        await API.register(payload);
        closeAuth(); await enterApp();
      } catch (err) { $("#authError").innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
    });
  }

  /* =========================== APP SHELL / ROUTER =========================== */
  const NAV = {
    user: [
      { id: "dashboard", label: "Дашборд", icon: "🏠" }, { id: "assistant", label: "ИИ-наставник", icon: "🤖" },
      { id: "roadmap", label: "Дорожная карта", icon: "🗺️" }, { id: "events", label: "Мероприятия", icon: "📅" },
      { id: "assignments", label: "Задания", icon: "📮" },
      { id: "mentor", label: "Мой наставник", icon: "🤝" }, { id: "notes", label: "Заметки", icon: "📝" }, { id: "profile", label: "Профиль", icon: "⚙️" },
    ],
    mentor: [
      { id: "dashboard", label: "Дашборд", icon: "🏠" }, { id: "mentees", label: "Мои педагоги", icon: "🎓" },
      { id: "groups", label: "Группы", icon: "👨‍👩‍👧‍👦" }, { id: "assignments", label: "Задания", icon: "📮" }, { id: "tests", label: "Конструктор тестов", icon: "🧩" },
      { id: "events", label: "Мероприятия", icon: "📅" }, { id: "notes", label: "Заметки", icon: "📝" }, { id: "profile", label: "Профиль", icon: "⚙️" },
    ],
    admin: [
      { id: "dashboard", label: "Дашборд", icon: "🏠" }, { id: "users", label: "Педагоги и наставники", icon: "👥" },
      { id: "events", label: "Мероприятия", icon: "📅" }, { id: "notes", label: "Заметки", icon: "📝" }, { id: "profile", label: "Профиль", icon: "⚙️" },
    ],
  };

  let currentView = "dashboard";
  let currentSub = null;
  let AI_LIVE = false;

  async function enterApp() {
    $("#landing").classList.add("hidden");
    $("#shell").classList.remove("hidden");
    const hash = location.hash.replace("#/", "");
    currentView = hash.split("/")[0] || "dashboard";
    currentSub = hash.split("/")[1] || null;
    try { const st = await API.aiStatus(); AI_LIVE = st.liveMode; } catch (e) { AI_LIVE = false; }
    await renderShell();
  }

  function logout() {
    API.logout();
    $("#shell").classList.add("hidden");
    $("#landing").classList.remove("hidden");
    location.hash = "";
  }

  async function go(view, sub) {
    currentView = view; currentSub = sub || null;
    location.hash = "/" + view + (sub ? "/" + sub : "");
    $$(".nav-link").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    document.getElementById("sidebar")?.classList.remove("open");
    await renderMain();
  }

  async function renderShell() {
    const user = API.getCurUser();
    if (!user) { logout(); return; }
    const shell = $("#shell");
    shell.innerHTML = "";
    const navItems = NAV[user.role] || NAV.user;

    const sidebar = el("div", { class: "sidebar", id: "sidebar" });
    sidebar.appendChild(el("div", { class: "brand" }, [el("span", { class: "brand-mark" }, ["🧭"]), " НавигаторПедагога"]));
    const su = el("div", { class: "side-user" });
    su.appendChild(avatarNode(user));
    su.appendChild(el("div", { class: "info" }, [el("b", {}, [user.fullName]), el("span", {}, [API.roleLabel(user.role)])]));
    sidebar.appendChild(su);

    if (user.role === "user") sidebar.appendChild(coinWidget(user));

    if (!AI_LIVE) {
      sidebar.appendChild(el("div", { class: "badge badge-yellow", style: "margin-bottom:14px; width:100%; box-sizing:border-box; text-align:center; padding:8px;" }, ["⚠️ Офлайн-режим ИИ"]));
    }

    navItems.forEach(n => {
      const link = el("div", { class: "nav-link" + (n.id === currentView ? " active" : ""), "data-view": n.id }, [el("span", { class: "ic" }, [n.icon]), n.label]);
      link.addEventListener("click", () => go(n.id));
      sidebar.appendChild(link);
    });
    sidebar.appendChild(el("div", { class: "nav-spacer" }));
    const foot = el("div", { class: "nav-foot" });
    const logoutLink = el("div", { class: "nav-link" }, [el("span", { class: "ic" }, ["🚪"]), "Выйти"]);
    logoutLink.addEventListener("click", logout);
    foot.appendChild(logoutLink);
    sidebar.appendChild(foot);

    const mobileTop = el("div", { class: "mobile-topbar" }, [el("div", { class: "brand", style: "font-size:16px;" }, [el("span", { class: "brand-mark", style: "width:30px;height:30px;font-size:14px;" }, ["🧭"]), "Навигатор"])]);
    const burger = el("button", { class: "btn btn-secondary btn-sm" }, ["☰ Меню"]);
    burger.addEventListener("click", () => sidebar.classList.toggle("open"));
    mobileTop.appendChild(burger);

    const main = el("div", { class: "main", id: "mainArea" });
    shell.appendChild(sidebar);
    shell.appendChild(el("div", {}, [mobileTop, main]));

    await renderMain();
  }

  function coinWidget(user) {
    const xp = user.xp || 0;
    const level = Math.floor(xp / 100) + 1;
    const pct = xp % 100;
    return el("div", { class: "coin-widget" }, [
      el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;" }, [
        el("span", { style: "font-weight:700; font-size:13px;" }, ["🪙 " + (user.coins || 0)]),
        el("span", { style: "font-size:11px; color:var(--ink-faint); font-weight:700;" }, ["Уровень " + level]),
      ]),
      el("div", { class: "xp-bar" }, [el("div", { class: "xp-bar-fill", style: `width:${pct}%;` })]),
    ]);
  }

  function avatarNode(user, size) {
    const a = el("div", { class: "avatar" + (size ? " " + size : "") }, [API.initials(user)]);
    a.style.background = COLOR_HEX[user.avatarColor || "purple"];
    return a;
  }

  async function renderMain() {
    const main = $("#mainArea");
    if (!main) return;
    const user = API.getCurUser();
    if (!user) { logout(); return; }
    main.innerHTML = "";
    main.appendChild(el("div", { class: "empty-state" }, [el("div", { class: "typing-dots" }, [el("span"), el("span"), el("span")])]));

    try {
      const view = currentView;
      main.innerHTML = "";
      if (view === "dashboard") return await renderDashboard(main, user);
      if (view === "assistant") return await renderAssistant(main, user);
      if (view === "roadmap") return await renderRoadmap(main, user);
      if (view === "events") return await renderEvents(main, user);
      if (view === "notes") return await renderNotes(main, user);
      if (view === "mentor") return await renderMentorView(main, user);
      if (view === "mentees") return await renderMenteesView(main, user);
      if (view === "groups") return await renderGroupsView(main, user);
      if (view === "tests") return await renderTestsView(main, user);
      if (view === "assignments") return await renderAssignmentsView(main, user);
      if (view === "users") return await renderUsersView(main, user);
      if (view === "profile") return await renderProfile(main, user);
      await renderDashboard(main, user);
    } catch (e) { main.innerHTML = ""; apiErr(e); main.appendChild(emptyState("⚠️", "Не удалось загрузить данные", e.message)); }
  }

  function topbar(main, title, sub, actions) {
    const bar = el("div", { class: "topbar" }, [el("div", {}, [el("h1", {}, [title]), sub ? el("div", { class: "sub" }, [sub]) : null])]);
    if (actions) { const a = el("div", { style: "display:flex; gap:10px;" }); actions.forEach(x => a.appendChild(x)); bar.appendChild(a); }
    main.appendChild(bar);
  }

  /* =========================== DASHBOARD =========================== */
  async function renderDashboard(main, user) {
    if (user.role === "admin") return renderAdminDashboard(main, user);
    if (user.role === "mentor") return renderMentorDashboard(main, user);

    topbar(main, `Привет, ${user.fullName.split(" ")[0]} 👋`, `${user.subject} · ${API.roleLabel(user.role)} · стаж ${user.yearsExperience} лет · ${user.region || "регион не указан"}`);

    const has = API.hasScores(user);
    const grid = el("div", { class: "grid-4" });
    grid.appendChild(statTile("purple", "Средний балл", has ? API.avgScore(user).toFixed(1) + "/5" : "—"));
    grid.appendChild(statTile("magenta", "Этап алгоритма", (user.currentStage || 1) + "/6"));
    const events = await API.listEvents();
    grid.appendChild(statTile("yellow", "Мероприятий доступно", String(events.filter(e => !e.completed).length)));
    const mentor = user.mentorId ? await API.getUser(user.mentorId).catch(() => null) : null;
    grid.appendChild(statTile("green", "Наставник", mentor ? mentor.fullName.split(" ")[0] : "не назначен"));
    main.appendChild(grid);

    const nudge = await API.getNudge();
    if (nudge.suggestion) {
      main.appendChild(el("div", { class: "card", style: "margin-top:16px; border-color:var(--yellow-pastel-2); display:flex; gap:12px; align-items:center;" }, [
        el("span", { style: "font-size:22px;" }, ["👋"]),
        el("p", { style: "font-size:13.5px; color:var(--ink-soft);" }, [nudge.suggestion]),
      ]));
    }
    if (has) {
      const digestCard = el("div", { class: "card", style: "margin-top:16px; background:var(--gradient-brand); color:#fff;" }, [
        el("div", { style: "font-size:12px; font-weight:700; opacity:.85; margin-bottom:6px;" }, ["🤖 ИИ-НАСТАВНИК · ЧТО ДАЛЬШЕ"]),
      ]);
      const digestText = el("p", { style: "font-size:14px; line-height:1.4;" }, ["Загружаю…"]);
      digestCard.appendChild(digestText);
      main.appendChild(digestCard);
      API.getDigest().then(d => { digestText.textContent = d.text; }).catch(() => { digestText.textContent = "Не удалось загрузить дайджест."; });
    }

    const cols = el("div", { class: "grid-2", style: "margin-top:18px; align-items:start;" });
    const aiCta = el("div", { class: "roadmap-cta" }, [
      el("div", { class: "big" }, ["🤖"]),
      el("h4", {}, [has ? "Поговорить с ИИ-наставником" : "Пройти диалоговую диагностику"]),
      el("p", {}, [has ? "Задайте вопрос или найдите новые мероприятия" : "5 минут разговора вместо теста"]),
    ]);
    aiCta.addEventListener("click", () => go("assistant"));
    const leftCol = el("div", {}, [aiCta]);
    const compCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📊 Компетенции"])]);
    if (!has) compCard.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Пока нет данных — пройдите диагностику с ИИ-наставником."]));
    else API.COMPETENCIES.forEach(c => compCard.appendChild(miniScoreRow(c, user.scores[c.id])));
    leftCol.appendChild(compCard);
    cols.appendChild(leftCol);

    const rightCol = el("div", {});
    const evCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📅 Ближайшие мероприятия"])]);
    const upcoming = events.filter(e => !e.completed).slice(0, 3);
    if (!upcoming.length) evCard.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Мероприятий пока нет."]));
    upcoming.forEach(e => evCard.appendChild(smallEventRow(e)));
    const evAllBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:6px;" }, ["Все мероприятия →"]);
    evAllBtn.addEventListener("click", () => go("events"));
    evCard.appendChild(evAllBtn);
    rightCol.appendChild(evCard);

    const notes = await API.listNotes();
    const noteCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📝 Последние заметки"])]);
    if (!notes.length) noteCard.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Заметок ещё нет."]));
    notes.slice(0, 3).forEach(n => noteCard.appendChild(el("div", { style: "padding:10px 0; border-bottom:1px solid var(--border);" }, [el("b", { style: "font-size:13.5px;" }, [n.title]), el("div", { style: "font-size:12px; color:var(--ink-faint); margin-top:2px;" }, [n.category])])));
    rightCol.appendChild(noteCard);
    cols.appendChild(rightCol);
    main.appendChild(cols);
  }

  function statTile(color, label, value) {
    return el("div", { class: "stat-tile", style: `background:var(--${color}-pastel); color:var(--${color}-ink);` }, [el("b", {}, [value]), el("span", {}, [label.toUpperCase()])]);
  }
  function miniScoreRow(c, score) {
    const pct = score ? (score / 5) * 100 : 0;
    return el("div", { style: "margin-bottom:12px;" }, [
      el("div", { style: "display:flex; justify-content:space-between; font-size:13px; margin-bottom:5px;" }, [el("span", {}, [c.icon + " " + c.label]), el("span", { class: "mono", style: "color:var(--ink-faint);" }, [score ? score + "/5" : "—"])]),
      el("div", { class: "progress-track" }, [el("div", { class: "progress-fill", style: `width:${pct}%;` })]),
    ]);
  }
  function smallEventRow(e) {
    const comp = API.competency(e.area);
    return el("div", { style: "padding:9px 0; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; gap:10px; align-items:center;" }, [
      el("div", {}, [el("div", { style: "font-size:13.5px; font-weight:700;" }, [e.title]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [`${e.date} · ${e.time || ""}`])]),
      el("span", { class: "badge badge-" + comp.color }, [comp.icon]),
    ]);
  }

  async function renderMentorDashboard(main, user) {
    topbar(main, `Здравствуйте, ${user.fullName.split(" ")[0]} 👋`, `Наставник · ${user.subject}`);
    const mentees = await API.listUsers("user");
    const pending = await API.pendingMentees();
    const grid = el("div", { class: "grid-4" });
    grid.appendChild(statTile("purple", "Подопечных", String(mentees.length)));
    const avgAll = mentees.length ? (mentees.reduce((s, m) => s + API.avgScore(m), 0) / mentees.length).toFixed(1) : "—";
    grid.appendChild(statTile("magenta", "Средний балл группы", avgAll === "—" ? "—" : avgAll + "/5"));
    const weakCount = mentees.reduce((s, m) => s + API.COMPETENCIES.filter(c => (m.scores[c.id] || 0) > 0 && m.scores[c.id] <= 2).length, 0);
    grid.appendChild(statTile("yellow", "Точек роста всего", String(weakCount)));
    const events = await API.listEvents();
    grid.appendChild(statTile("green", "Мероприятий в каталоге", String(events.length)));
    main.appendChild(grid);

    if (pending.length) {
      const pCard = el("div", { class: "card", style: "margin-top:18px; border-color:var(--yellow-pastel-2);" }, [el("div", { class: "card-title" }, [`⏳ Заявки на наставничество (${pending.length})`])]);
      pending.forEach(p => {
        const row = el("div", { style: "display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border);" }, [
          avatarNode(p, "sm"),
          el("div", { style: "flex:1;" }, [el("b", { style: "font-size:14px;" }, [p.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [p.subject + " · " + (p.region || "без региона")])]),
        ]);
        const ok = el("button", { class: "btn btn-primary btn-sm" }, ["Принять"]);
        ok.addEventListener("click", async () => { await API.confirmMentee(p.id); renderMain(); toast("Пара создана"); });
        const no = el("button", { class: "btn btn-ghost btn-sm" }, ["Отклонить"]);
        no.addEventListener("click", async () => { await API.declineMentee(p.id); renderMain(); });
        row.appendChild(ok); row.appendChild(no);
        pCard.appendChild(row);
      });
      main.appendChild(pCard);
    }

    const card = el("div", { class: "card", style: "margin-top:18px;" }, [el("div", { class: "card-title" }, ["🎓 Мои подопечные"])]);
    if (!mentees.length) card.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Педагоги пока не закреплены за вами."]));
    mentees.forEach(m => card.appendChild(menteeRow(m, () => go("mentees", m.id))));
    main.appendChild(card);
  }

  function menteeRow(m, onClick) {
    const row = el("div", { style: "display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); cursor:pointer;" });
    row.appendChild(avatarNode(m, "sm"));
    row.appendChild(el("div", { style: "flex:1;" }, [el("div", { style: "font-weight:700; font-size:14px;" }, [m.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [`${m.subject} · ${m.region || "без региона"} · балл ${API.hasScores(m) ? API.avgScore(m).toFixed(1) : "—"}`])]));
    row.appendChild(el("span", { class: "badge badge-purple" }, ["Открыть →"]));
    row.addEventListener("click", onClick);
    return row;
  }

  async function renderAdminDashboard(main, user) {
    topbar(main, "Панель администратора", user.school || "");
    const [teachers, mentors, events] = await Promise.all([API.listUsers("user"), API.listUsers("mentor"), API.listEvents()]);
    const grid = el("div", { class: "grid-4" });
    grid.appendChild(statTile("purple", "Молодых педагогов", String(teachers.length)));
    grid.appendChild(statTile("magenta", "Наставников", String(mentors.length)));
    grid.appendChild(statTile("yellow", "Мероприятий", String(events.length)));
    grid.appendChild(statTile("green", "Без наставника", String(teachers.filter(t => !t.mentorId).length)));
    main.appendChild(grid);
    if (!AI_LIVE) {
      main.appendChild(el("div", { class: "card", style: "margin-top:18px; border-color:var(--yellow-pastel-2);" }, [
        el("div", { class: "card-title" }, ["⚠️ ИИ работает в офлайн-режиме"]),
        el("p", { style: "font-size:13.5px; color:var(--ink-soft);" }, ["Поиск реальных мероприятий по регионам недоступен. На сервере бэкенда задайте переменную окружения GEMINI_API_KEY и перезапустите сервер — см. README."]),
      ]));
    }
    const card = el("div", { class: "card", style: "margin-top:18px;" }, [el("div", { class: "card-title" }, ["👥 Молодые педагоги"])]);
    if (!teachers.length) card.appendChild(el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["Педагогов пока нет."]));
    teachers.forEach(t => card.appendChild(menteeRow(t, () => go("users", t.id))));
    main.appendChild(card);
  }

  /* =========================== AI ASSISTANT =========================== */
  let diagnosticActiveFlag = false;

  async function renderAssistant(main, user) {
    topbar(main, "🤖 ИИ-наставник", AI_LIVE ? "Диалог вместо теста + поиск реальных мероприятий в интернете" : "Диалог вместо теста (офлайн-режим — без поиска в интернете)");

    const shellDiv = el("div", { class: "chat-shell" });
    const scroll = el("div", { class: "chat-scroll", id: "chatScroll" });
    shellDiv.appendChild(scroll);
    main.appendChild(shellDiv);

    const chatData = await API.getAiChat();
    let history = chatData.messages || [];
    const diagActive = chatData.diagnosticActive;
    diagnosticActiveFlag = diagActive;

    if (!history.length && !API.hasScores(user) && !diagActive) {
      scroll.appendChild(introCard(user));
    } else {
      if (!history.length) {
        const st = await API.aiStatus();
        history = [{ role: "ai", text: `С возвращением, ${user.fullName.split(" ")[0]}! 👋 Выберите быстрое действие ниже или напишите, что вас беспокоит.` }];
      }
      history.forEach(m => scroll.appendChild(renderMsg(m)));
    }

    const quickRow = el("div", { class: "chat-quick", id: "chatQuick" });
    if (!diagActive && API.hasScores(user)) {
      const actions = await API.quickActions();
      actions.forEach(q => {
        const chip = el("button", { class: "chip" }, [q.label]);
        chip.addEventListener("click", () => sendFromUser(user, q.prompt, scroll, q.id === "map"));
        quickRow.appendChild(chip);
      });
      const redo = el("button", { class: "chip" }, ["🔁 Пройти диагностику заново"]);
      redo.addEventListener("click", () => beginDiagnostic(user, scroll));
      quickRow.appendChild(redo);
    }
    shellDiv.appendChild(quickRow);

    const inputBar = el("div", { class: "chat-input-bar" });
    const input = el("input", { type: "text", placeholder: diagActive ? "Ответьте своими словами…" : "Спросите что угодно, например: как справиться с шумным классом?" });
    const sendBtn = el("button", { class: "chat-send" }, ["➤"]);
    const doSend = () => { const v = input.value.trim(); if (!v) return; input.value = ""; sendFromUser(user, v, scroll); };
    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
    inputBar.appendChild(input); inputBar.appendChild(sendBtn);
    shellDiv.appendChild(inputBar);
    scroll.scrollTop = scroll.scrollHeight;
  }

  function introCard(user) {
    const card = el("div", { class: "card", style: "max-width:560px;" }, [
      el("div", { style: "font-size:38px; margin-bottom:10px;" }, ["🤖"]),
      el("h3", { style: "margin-bottom:8px;" }, ["Здравствуйте, " + user.fullName.split(" ")[0] + "!"]),
      el("p", { style: "color:var(--ink-soft); font-size:14.5px; margin-bottom:18px;" }, [
        `Я — ваш ИИ-наставник. Поговорим о 6 направлениях компетенций, а по итогам я ${AI_LIVE ? "найду для вас реальные мероприятия в интернете (регион: " + (user.region || "не указан") + ") и " : ""}соберу дорожную карту.`,
      ]),
    ]);
    const btn = el("button", { class: "btn btn-primary" }, ["Начать диагностику 💬"]);
    btn.addEventListener("click", () => beginDiagnostic(user, $("#chatScroll")));
    card.appendChild(btn);
    return card;
  }

  async function beginDiagnostic(user, scroll) {
    scroll.innerHTML = "";
    try {
      const msgs = await API.startDiagnostic();
      diagnosticActiveFlag = true;
      msgs.forEach(m => scroll.appendChild(renderMsg(m)));
      scroll.scrollTop = scroll.scrollHeight;
      await renderMain();
    } catch (e) { apiErr(e); }
  }

  function renderMsg(m) {
    const row = el("div", { class: "msg-row " + (m.role === "user" ? "me" : "ai") });
    if (m.role !== "user") row.appendChild(el("div", { class: "msg-avatar ai" }, ["🤖"]));
    row.appendChild(el("div", { class: "msg-bubble", html: mdLite(m.text) }));
    const wrap = el("div", {}, [row]);
    if (m.chips && m.chips.length) {
      const chipsWrap = el("div", { class: "msg-chips" });
      m.chips.forEach(c => {
        const chip = el("button", { class: "chip reply-chip" }, [c]);
        chip.addEventListener("click", () => { chipsWrap.querySelectorAll(".chip").forEach(b => b.disabled = true); sendFromUser(API.getCurUser(), c, $("#chatScroll")); });
        chipsWrap.appendChild(chip);
      });
      wrap.appendChild(chipsWrap);
    }
    return wrap;
  }

  function typingBubble(text) {
    return el("div", { class: "msg-row ai" }, [
      el("div", { class: "msg-avatar ai" }, ["🤖"]),
      el("div", { class: "msg-bubble" }, [text ? text + " " : "", el("span", { class: "typing-dots" }, [el("span"), el("span"), el("span")])]),
    ]);
  }

  async function sendFromUser(user, text, scroll, isRoadmapAction) {
    scroll.appendChild(renderMsg({ role: "user", text }));
    scroll.scrollTop = scroll.scrollHeight;

    const wasDiagnosticActive = diagnosticActiveFlag;
    const typing = typingBubble(wasDiagnosticActive ? "" : (isRoadmapAction ? "🔎 Ищу мероприятия в интернете, это может занять до минуты…" : ""));
    scroll.appendChild(typing);
    scroll.scrollTop = scroll.scrollHeight;

    try {
      if (wasDiagnosticActive) {
        const res = await API.replyDiagnostic(text);
        diagnosticActiveFlag = res.diagnosticActive;
        typing.remove();
        res.messages.forEach(m => scroll.appendChild(renderMsg(m)));
        scroll.scrollTop = scroll.scrollHeight;
        if (!res.diagnosticActive) {
          // diagnostic just finished -> auto-generate roadmap
          await autoGenerateRoadmap(user, scroll);
          await renderMain();
        }
      } else if (isRoadmapAction) {
        const rm = await API.generateRoadmap(user.region);
        typing.remove();
        const summary = rm.mode === "live" ? `✅ Готово! Нашёл мероприятия для региона «${rm.region}». Подробности — на вкладке «Дорожная карта».` : `⚠️ ${rm.summary}`;
        scroll.appendChild(renderMsg({ role: "ai", text: summary }));
        scroll.scrollTop = scroll.scrollHeight;
      } else {
        const msgs = await API.chatWithAi(text);
        typing.remove();
        msgs.forEach(m => scroll.appendChild(renderMsg(m)));
        scroll.scrollTop = scroll.scrollHeight;
      }
    } catch (e) {
      typing.remove();
      scroll.appendChild(renderMsg({ role: "ai", text: "Не удалось получить ответ: " + e.message }));
    }
  }

  async function autoGenerateRoadmap(user, scroll) {
    const typing = typingBubble("🔎 Ищу реальные мероприятия для региона «" + (user.region || "—") + "»…");
    scroll.appendChild(typing);
    scroll.scrollTop = scroll.scrollHeight;
    try {
      const rm = await API.generateRoadmap(user.region);
      typing.remove();
      const text = rm.mode === "live"
        ? `🗺️ Дорожная карта готова! Нашёл мероприятия для региона «${rm.region}». Откройте вкладку «Дорожная карта», чтобы посмотреть.`
        : `🗺️ Дорожная карта готова (офлайн-режим — мероприятия из общего каталога). ${rm.summary}`;
      scroll.appendChild(renderMsg({ role: "ai", text }));
      scroll.scrollTop = scroll.scrollHeight;
    } catch (e) {
      typing.remove();
      scroll.appendChild(renderMsg({ role: "ai", text: "Не удалось построить карту: " + e.message }));
    }
  }

  /* =========================== ROADMAP =========================== */
  async function renderRoadmap(main, user) {
    topbar(main, "🗺️ Дорожная карта", `Регион: ${user.region || "не указан"}`, [
      (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["🔎 Обновить (поиск в интернете)"]); b.addEventListener("click", () => regenerateRoadmap(user)); return b; })(),
    ]);
    if (!API.hasScores(user)) {
      main.appendChild(emptyState("🗺️", "Дорожная карта не сформирована", "Пройдите диалоговую диагностику с ИИ-наставником — маршрут соберётся автоматически.", "Начать диагностику", () => go("assistant")));
      return;
    }
    const rm = await API.getRoadmap();
    if (!rm) {
      main.appendChild(emptyState("🗺️", "Карта ещё не построена", "Нажмите «Обновить», чтобы ИИ нашёл мероприятия под ваши баллы.", "Построить карту", () => regenerateRoadmap(user)));
      return;
    }
    const progress = await API.listProgress();
    renderRoadmapContent(main, rm, progress, user.currentStage);

    // "постоянно обновляющийся список мероприятий": если карта старше 4 дней, тихо обновляем в фоне,
    // не более раза в сутки на клиенте (basePath + дата в ключе, чтобы не спамить бесплатную квоту Gemini).
    const todayKey = "np-auto-refresh-" + new Date().toISOString().slice(0, 10);
    if (rm.stale && !localStorage.getItem(todayKey)) {
      localStorage.setItem(todayKey, "1");
      const badge = el("div", { class: "mode-badge offline", style: "margin-bottom:10px;" }, ["🔄 Карта могла устареть — обновляю в фоне…"]);
      main.insertBefore(badge, main.firstChild);
      API.generateRoadmap(user.region).then(async (fresh) => {
        if (currentView !== "roadmap") return; // пользователь уже ушёл со страницы — не перерисовываем поверх другого экрана
        const freshProgress = await API.listProgress();
        main.innerHTML = "";
        topbar(main, "🗺️ Дорожная карта", `Регион: ${fresh.region}`, [
          (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["🔎 Обновить (поиск в интернете)"]); b.addEventListener("click", () => regenerateRoadmap(user)); return b; })(),
        ]);
        renderRoadmapContent(main, fresh, freshProgress, user.currentStage);
      }).catch(() => badge.remove());
    }
  }

  async function regenerateRoadmap(user) {
    const main = $("#mainArea");
    main.innerHTML = "";
    topbar(main, "🗺️ Дорожная карта", `Регион: ${user.region || "не указан"}`);
    main.appendChild(el("div", { class: "card empty-state" }, [
      el("div", { class: "typing-dots", style: "justify-content:center;" }, [el("span"), el("span"), el("span")]),
      el("p", { style: "margin-top:14px;" }, [AI_LIVE ? "Ищу реальные мероприятия в интернете — это может занять до минуты…" : "Строю карту из общего каталога…"]),
    ]));
    try {
      const rm = await API.generateRoadmap(user.region);
      const progress = await API.listProgress();
      main.innerHTML = "";
      topbar(main, "🗺️ Дорожная карта", `Регион: ${rm.region}`, [
        (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["🔎 Обновить (поиск в интернете)"]); b.addEventListener("click", () => regenerateRoadmap(user)); return b; })(),
      ]);
      renderRoadmapContent(main, rm, progress, user.currentStage);
    } catch (e) { apiErr(e); await renderMain(); }
  }

  function renderRoadmapContent(main, rm, progress, currentStage) {
    progress = progress || [];
    main.appendChild(el("div", { class: "mode-badge " + (rm.mode === "live" ? "live" : "offline") }, [rm.mode === "live" ? "✅ Найдено в интернете" : "⚠️ Офлайн-каталог"]));

    if (rm.summary) main.appendChild(el("div", { class: "card" }, [el("div", { class: "card-title" }, ["💬 Комментарий ИИ-наставника"]), el("p", { style: "font-size:14px; color:var(--ink-soft);" }, [rm.summary])]));

    const algoCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📋 Этапы алгоритма (методология Поляковой Г.Д.)"])]);
    const diagram = el("div", { class: "route-diagram" });
    const stageIdx = (currentStage || 1) - 1;
    API.ALGO_STAGES.forEach((s, i) => {
      diagram.appendChild(el("div", { class: "route-node " + (i === stageIdx ? "current" : i < stageIdx ? "done" : "") }, [
        el("div", { class: "route-dot " + (i === stageIdx ? "current" : i < stageIdx ? "done" : "") }, [i < stageIdx ? "✓" : String(i + 1)]),
        el("div", { class: "label" }, [s]),
      ]));
    });
    algoCard.appendChild(diagram);
    main.appendChild(algoCard);

    main.appendChild(el("h3", { style: "margin:26px 0 4px; font-size:18px; text-align:center;" }, ["Ваш путь обучения"]));
    main.appendChild(renderJourneyMap(rm, progress));

    main.appendChild(el("h3", { style: "margin:30px 0 4px; font-size:18px;" }, ["Мероприятия по компетенциям"]));
    (rm.priorities || []).forEach(p => main.appendChild(roadmapCompCard(p)));

    if (rm.sources && rm.sources.length) {
      const srcCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["🔗 Источники поиска"])]);
      rm.sources.slice(0, 12).forEach(u => srcCard.appendChild(el("a", { class: "source-link", href: u, target: "_blank", rel: "noopener" }, [u])));
      main.appendChild(srcCard);
    }
  }

  // Карта пути в стиле Duolingo: каждый шаг = одно мероприятие дорожной карты, в порядке
  // приоритета (сначала самые слабые компетенции). Состояние узла берётся из roadmap_progress
  // пользователя (отчёт сдан/оценён = пройдено, взято в работу = текущий, иначе — следующий шаг).
  function renderJourneyMap(rm, progress) {
    const steps = [];
    (rm.priorities || []).forEach(p => (p.events || []).forEach(ev => steps.push({ competency: p.competency, ev })));
    const map = el("div", { class: "journey-map" });
    if (!steps.length) { map.appendChild(el("p", { style: "text-align:center; color:var(--ink-faint); font-size:13.5px;" }, ["Мероприятия появятся здесь после обновления карты."])); return map; }

    const byTitle = new Map(progress.map(p => [p.event_title.trim().toLowerCase(), p]));
    let currentAssigned = false;
    steps.forEach((step, i) => {
      const match = byTitle.get(step.ev.title.trim().toLowerCase());
      let state = "locked";
      if (match && (match.status === "reported" || match.status === "rated")) state = "done";
      else if (match && match.status === "open") { state = "current"; currentAssigned = true; }
      if (state === "locked" && !currentAssigned) { state = "current"; currentAssigned = true; }

      const comp = API.competency(step.competency) || { icon: "❓", label: step.competency };
      const row = el("div", { class: "journey-row pos-" + (i % 4) });
      const node = el("div", { class: "journey-node " + state }, [state === "done" ? "✅" : comp.icon]);
      if (state === "done") node.appendChild(el("span", { class: "check-badge" }, ["✓"]));
      node.addEventListener("click", () => openJourneyNodeModal(step.competency, step.ev, match));
      const col = el("div", { class: "journey-node-col" }, [
        node,
        el("span", { class: "journey-comp-tag" }, [comp.label]),
        el("span", { class: "journey-label" }, [step.ev.title]),
      ]);
      row.appendChild(col);
      map.appendChild(row);
    });
    return map;
  }

  function openJourneyNodeModal(competencyId, ev, existing) {
    if (!existing) return openProgressReportModal(competencyId, ev);
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" }, [
      el("h3", { style: "margin-bottom:10px;" }, [ev.title]),
      el("div", { class: "chip", style: "cursor:default; margin-bottom:12px;" }, [existing.status === "rated" ? "✅ Оценено наставником" : existing.status === "reported" ? "📝 Отчёт на проверке" : "📌 В работе"]),
    ]);
    if (existing.report_text) modal.appendChild(el("p", { style: "font-size:13.5px; color:var(--ink-soft); margin-bottom:8px;" }, [existing.report_text]));
    if (existing.usefulness_rating) modal.appendChild(el("p", { style: "font-size:12.5px; color:var(--ink-faint);" }, [`Ваша оценка полезности: ${existing.usefulness_rating}/5`]));
    if (existing.mentor_rating) modal.appendChild(el("p", { style: "font-size:12.5px; color:var(--ink-faint);" }, [`Оценка наставника: ${existing.mentor_rating}/5`]));
    if (ev.url) modal.appendChild(el("a", { href: ev.url, target: "_blank", rel: "noopener", style: "display:block; margin-top:8px; font-size:12.5px; color:var(--purple-ink); font-weight:700;" }, ["Открыть источник →"]));
    const close = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:14px;" }, ["Закрыть"]);
    close.addEventListener("click", () => backdrop.remove());
    modal.appendChild(close);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function roadmapCompCard(p) {
    const comp = API.competency(p.competency) || { icon: "❓", label: p.competency, color: "purple" };
    const weak = p.score > 0 && p.score <= 2;
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { style: "display:flex; align-items:center; gap:12px; margin-bottom:12px;" }, [
      el("div", { style: "font-size:24px;" }, [comp.icon]),
      el("div", { style: "flex:1;" }, [el("div", { style: "font-weight:800; font-size:15px;" }, [comp.label]), weak ? el("span", { class: "badge badge-warn" }, ["⚠️ Дефицит — приоритет"]) : null]),
      el("div", { class: "mono", style: `font-size:19px; font-weight:700; color:${weak ? "var(--magenta-ink)" : "var(--purple-ink)"};` }, [p.score ? p.score + "/5" : "—"]),
    ]));
    const tipsBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:12px;" }, ["💡 Советы Минпросвещения по этому направлению"]);
    const tipsBox = el("div", { style: "display:none; font-size:12.5px; color:var(--ink-soft); background:var(--bg-alt); padding:10px 14px; border-radius:12px; margin-bottom:12px; white-space:pre-line;" });
    tipsBtn.addEventListener("click", async () => {
      if (tipsBox.style.display === "block") { tipsBox.style.display = "none"; return; }
      tipsBox.style.display = "block"; tipsBox.textContent = "Загружаю…";
      const t = await API.getTips(p.competency);
      tipsBox.textContent = t.text;
    });
    card.appendChild(tipsBtn);
    card.appendChild(tipsBox);
    if (!p.events || !p.events.length) {
      card.appendChild(el("p", { style: "font-size:13px; color:var(--ink-faint);" }, ["Мероприятий по этому направлению в регионе не найдено."]));
    } else {
      p.events.forEach(ev => {
        const row = el("div", { style: "padding:10px 0; border-bottom:1px solid var(--border);" }, [
          el("div", { style: "font-weight:700; font-size:13.5px;" }, [ev.title]),
          el("div", { style: "font-size:12px; color:var(--ink-faint); margin:3px 0;" }, [[ev.date, ev.source].filter(Boolean).join(" · ")]),
          ev.description ? el("div", { style: "font-size:12.5px; color:var(--ink-soft);" }, [ev.description]) : null,
        ]);
        if (ev.url) { const a = el("a", { href: ev.url, target: "_blank", rel: "noopener", style: "font-size:12px; color:var(--purple-ink); font-weight:700;" }, ["Открыть источник →"]); row.appendChild(a); }
        const takeBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:6px;" }, ["📌 Взять в работу и отчитаться"]);
        takeBtn.addEventListener("click", () => openProgressReportModal(p.competency, ev));
        row.appendChild(takeBtn);
        card.appendChild(row);
      });
    }
    return card;
  }

  // Наставляемый берёт мероприятие в работу и сразу может написать отчёт (или сохранить как "в работе" и вернуться позже).
  async function openQuizModal(ev) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" }, [
      el("h3", { style: "margin-bottom:4px;" }, ["🧠 Тест: " + ev.title]),
      el("p", { style: "font-size:12px; color:var(--ink-faint); margin-bottom:14px;" }, ["Вопросы сгенерированы ИИ на основе мероприятия и методических рекомендаций."]),
      el("div", { class: "typing-dots" }, [el("span"), el("span"), el("span")]),
    ]);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);

    let data;
    try { data = await API.getQuiz(ev.id); } catch (e) { modal.querySelector(".typing-dots").replaceWith(el("p", {}, ["Не удалось загрузить тест."])); return; }

    modal.innerHTML = "";
    modal.appendChild(el("h3", { style: "margin-bottom:4px;" }, ["🧠 Тест: " + ev.title]));
    modal.appendChild(el("div", { class: "mode-badge " + (data.mode === "live" ? "live" : "offline"), style: "margin-bottom:14px;" }, [data.mode === "live" ? "✅ По материалам мероприятия" : "⚠️ Общий тест по компетенции"]));

    const inputs = [];
    data.questions.forEach((q, qi) => {
      const block = el("div", { style: "margin-bottom:16px;" }, [el("p", { style: "font-weight:700; font-size:13.5px; margin-bottom:8px;" }, [`${qi + 1}. ${q.q}`])]);
      const group = [];
      q.options.forEach((opt, oi) => {
        const label = el("label", { style: "display:flex; gap:8px; align-items:center; font-size:13px; padding:6px 0; cursor:pointer;" });
        const radio = document.createElement("input");
        radio.type = "radio"; radio.name = "q" + qi; radio.value = String(oi);
        label.appendChild(radio); label.appendChild(document.createTextNode(opt));
        block.appendChild(label);
        group.push(radio);
      });
      inputs.push(group);
      modal.appendChild(block);
    });

    const submit = el("button", { class: "btn btn-primary btn-sm" }, ["Проверить"]);
    submit.addEventListener("click", async () => {
      const answers = inputs.map(group => { const picked = group.find(r => r.checked); return picked ? parseInt(picked.value, 10) : -1; });
      const result = await API.submitQuiz(ev.id, answers);
      modal.innerHTML = "";
      modal.appendChild(el("h3", { style: "margin-bottom:10px;" }, [`Результат: ${result.score} из ${result.total}`]));
      result.details.forEach((d, i) => {
        const ok = d.yourAnswer === d.correctIndex;
        modal.appendChild(el("div", { style: "margin-bottom:12px; padding:10px; border-radius:10px; background:" + (ok ? "var(--green-pastel)" : "var(--yellow-pastel)") }, [
          el("p", { style: "font-weight:700; font-size:13px; margin-bottom:4px;" }, [(ok ? "✅ " : "❌ ") + d.q]),
          el("p", { style: "font-size:12px; color:var(--ink-soft);" }, [d.explain]),
        ]));
      });
      const close = el("button", { class: "btn btn-ghost btn-sm" }, ["Закрыть"]);
      close.addEventListener("click", () => backdrop.remove());
      modal.appendChild(close);
    });
    modal.appendChild(submit);
  }

  async function openProgressReportModal(competencyId, ev) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" }, [
      el("h3", { style: "margin-bottom:4px;" }, ["📌 " + ev.title]),
      el("p", { style: "font-size:12.5px; color:var(--ink-faint); margin-bottom:14px;" }, ["Отчёт увидит ваш наставник и сможет оценить его."]),
    ]);
    const report = document.createElement("textarea");
    report.placeholder = "Что узнали нового? Что будете использовать в работе? (можно оставить пустым и заполнить позже)";
    report.style.cssText = "width:100%; min-height:90px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); font-family:var(--font-body); margin-bottom:10px;";
    modal.appendChild(report);
    const reviewBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:10px;" }, ["🤖 Проверить отчёт с ИИ"]);
    const reviewOut = el("p", { style: "font-size:12.5px; color:var(--purple-ink); margin-bottom:10px; display:none;" });
    reviewBtn.addEventListener("click", async () => {
      if (!report.value.trim()) { toast("Сначала напишите черновик отчёта"); return; }
      reviewBtn.disabled = true; reviewBtn.textContent = "Проверяю…";
      const { feedback } = await API.reviewReport(report.value.trim());
      reviewOut.textContent = "💡 " + feedback;
      reviewOut.style.display = "block";
      reviewBtn.disabled = false; reviewBtn.textContent = "🤖 Проверить отчёт с ИИ";
    });
    modal.appendChild(reviewBtn);
    modal.appendChild(reviewOut);
    modal.appendChild(el("label", { style: "font-size:12.5px; color:var(--ink-soft);" }, ["Оцените полезность (1-5)"]));
    const rating = document.createElement("select");
    [1, 2, 3, 4, 5].forEach(v => rating.appendChild(new Option(String(v), v, v === 5, v === 5)));
    rating.style.cssText = "padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin:6px 0 14px; display:block;";
    modal.appendChild(rating);
    const row = el("div", { style: "display:flex; gap:10px; justify-content:flex-end;" });
    const cancel = el("button", { class: "btn btn-ghost btn-sm" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-sm" }, ["Сохранить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      const item = await API.addProgress({ competencyId, eventTitle: ev.title, eventUrl: ev.url, weight: 1 });
      if (report.value.trim()) await API.reportProgress(item.id, report.value.trim(), parseInt(rating.value, 10));
      backdrop.remove();
      toast("Сохранено — наставник увидит отчёт");
    });
    row.appendChild(cancel); row.appendChild(save);
    modal.appendChild(row);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function emptyState(emoji, title, desc, btnLabel, onClick) {
    const es = el("div", { class: "card empty-state" }, [el("div", { class: "emoji" }, [emoji]), el("h3", {}, [title]), el("p", {}, [desc])]);
    if (btnLabel) { const btn = el("button", { class: "btn btn-primary" }, [btnLabel]); btn.addEventListener("click", onClick); es.appendChild(btn); }
    return es;
  }

  /* =========================== EVENTS =========================== */
  let eventFilter = "all";
  async function renderEvents(main, user) {
    const isAdmin = user.role === "admin";
    topbar(main, "📅 Мероприятия", "Каталог платформы (общие мероприятия для всех регионов)", isAdmin ? [addBtn("+ Добавить", () => openEventModal(null))] : null);

    const filters = ["all", ...API.COMPETENCIES.map(c => c.id)];
    const chipRow = el("div", { class: "chip-row", style: "margin-bottom:18px;" });
    filters.forEach(f => {
      const comp = f === "all" ? null : API.competency(f);
      const chip = el("button", { class: "chip" + (eventFilter === f ? " active" : "") }, [f === "all" ? "Все" : comp.icon + " " + comp.short]);
      chip.addEventListener("click", () => { eventFilter = f; renderMain(); });
      chipRow.appendChild(chip);
    });
    main.appendChild(chipRow);

    const list = await API.listEvents(eventFilter);
    if (!list.length) { main.appendChild(emptyState("📅", "Мероприятий нет", "В этой категории пока ничего не запланировано.")); return; }
    list.forEach(e => main.appendChild(eventCard(e, user)));
  }

  function addBtn(label, onClick) { const b = el("button", { class: "btn btn-primary btn-sm" }, [label]); b.addEventListener("click", onClick); return b; }

  function eventCard(e, user) {
    const comp = API.competency(e.area);
    const parts = (e.date || "").split(" ");
    const card = el("div", { class: "card event-card" });
    card.appendChild(el("div", { class: "event-date" }, [el("div", { class: "d" }, [parts[0] || "?"]), el("div", { class: "m" }, [parts[1] || ""])]));
    const body = el("div", { class: "event-body" }, [
      el("h4", {}, [e.title]),
      el("p", { class: "desc" }, [e.description]),
      el("div", { class: "event-meta" }, [
        el("span", { class: "badge badge-" + comp.color }, [comp.icon + " " + comp.label]),
        el("span", { class: "badge badge-purple" }, [e.type === "online" ? "🌐 Онлайн" : "📍 Очно"]),
        el("span", {}, [e.time || ""]),
        e.completed ? el("span", { class: "badge badge-green" }, ["✓ Пройдено"]) : null,
      ]),
    ]);
    if (e.url) body.appendChild(el("a", { href: e.url, target: "_blank", rel: "noopener", style: "font-size:12px; color:var(--purple-ink); font-weight:700; display:inline-block; margin-top:6px;" }, ["Открыть →"]));
    card.appendChild(body);
    const actions = el("div", { class: "event-actions" });
    if (user.role === "user" || user.role === "mentor") {
      const btn = el("button", { class: "btn " + (e.completed ? "btn-secondary" : "btn-primary") + " btn-sm" }, [e.completed ? "Отменить" : "Отметить пройденным"]);
      btn.addEventListener("click", async () => {
        if (!e.completed) openReflectionModal(e);
        else { await API.completeEvent(e.id, false, ""); renderMain(); }
      });
      actions.appendChild(btn);
      if (e.completed) {
        const quizBtn = el("button", { class: "btn btn-primary btn-sm", style: "margin-left:8px;" }, ["🧠 Пройти тест"]);
        quizBtn.addEventListener("click", () => openQuizModal(e));
        actions.appendChild(quizBtn);
      }
    }
    if (user.role === "admin") {
      const editBtn = el("button", { class: "btn btn-secondary btn-sm" }, ["✏️"]);
      editBtn.addEventListener("click", () => openEventModal(e));
      const delBtn = el("button", { class: "btn btn-danger btn-sm", style: "margin-left:8px;" }, ["🗑️"]);
      delBtn.addEventListener("click", async () => { if (confirm("Удалить мероприятие?")) { await API.deleteEvent(e.id); renderMain(); } });
      actions.appendChild(editBtn); actions.appendChild(delBtn);
    }
    card.appendChild(actions);
    return card;
  }

  function openReflectionModal(e) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const card = el("div", { class: "modal-card" }, [
      el("h3", {}, ["Отметить как пройденное"]),
      el("p", { style: "font-size:13.5px; color:var(--ink-soft); margin-bottom:14px;" }, [e.title]),
      el("div", { class: "field" }, [el("label", {}, ["Короткая рефлексия (необязательно)"]), el("textarea", { id: "reflInput", rows: "3" })]),
    ]);
    const btns = el("div", { style: "display:flex; gap:10px; margin-top:6px;" });
    const cancel = el("button", { class: "btn btn-secondary btn-block" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-block" }, ["Сохранить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => { await API.completeEvent(e.id, true, $("#reflInput").value.trim()); backdrop.remove(); renderMain(); toast("Мероприятие отмечено пройденным"); });
    btns.appendChild(cancel); btns.appendChild(save);
    card.appendChild(btns);
    backdrop.appendChild(card);
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function openEventModal(existing) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const card = el("div", { class: "modal-card" });
    card.appendChild(el("h3", {}, [existing ? "Редактировать мероприятие" : "Новое мероприятие"]));
    const title = fieldInput("Название", existing?.title || "");
    const desc = fieldInput("Описание", existing?.description || "", "textarea");
    const date = fieldInput("Дата (например «12 октября»)", existing?.date || "");
    const time = fieldInput("Время", existing?.time || "18:00");
    const region = fieldInput("Регион (или «Все регионы»)", existing?.region || "Все регионы");
    const url = fieldInput("Ссылка (необязательно)", existing?.url || "");
    const typeSel = fieldSelect("Формат", [["online", "Онлайн"], ["offline", "Очно"]], existing?.type || "online");
    const areaSel = fieldSelect("Направление", API.COMPETENCIES.map(c => [c.id, c.icon + " " + c.label]), existing?.area || "subject");
    [title, desc, date, time, region, url, typeSel, areaSel].forEach(f => card.appendChild(f.wrap));
    const btns = el("div", { style: "display:flex; gap:10px; margin-top:10px;" });
    const cancel = el("button", { class: "btn btn-secondary btn-block" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-block" }, ["Сохранить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      const payload = { title: title.input.value.trim(), description: desc.input.value.trim(), date: date.input.value.trim(), time: time.input.value.trim(), region: region.input.value.trim(), url: url.input.value.trim(), type: typeSel.input.value, area: areaSel.input.value };
      if (!payload.title || !payload.date) { toast("Заполните название и дату", true); return; }
      try {
        if (existing) await API.updateEvent(existing.id, payload); else await API.createEvent(payload);
        backdrop.remove(); renderMain(); toast(existing ? "Мероприятие обновлено" : "Мероприятие добавлено");
      } catch (e) { apiErr(e); }
    });
    btns.appendChild(cancel); btns.appendChild(save);
    card.appendChild(btns);
    backdrop.appendChild(card);
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function fieldInput(label, value, tag) {
    const wrap = el("div", { class: "field" }, [el("label", {}, [label])]);
    const input = document.createElement(tag === "textarea" ? "textarea" : "input");
    if (tag !== "textarea") input.type = "text";
    input.value = value || "";
    if (tag === "textarea") input.rows = 3;
    wrap.appendChild(input);
    return { wrap, input };
  }
  function fieldSelect(label, options, value) {
    const wrap = el("div", { class: "field" }, [el("label", {}, [label])]);
    const input = document.createElement("select");
    options.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === value) o.selected = true; input.appendChild(o); });
    wrap.appendChild(input);
    return { wrap, input };
  }

  /* =========================== NOTES =========================== */
  async function renderNotes(main, user) {
    topbar(main, "📝 Заметки", "Личные записи, рефлексия, наблюдения", [addBtn("+ Новая заметка", () => openNoteModal(null))]);
    const notes = await API.listNotes();
    if (!notes.length) { main.appendChild(emptyState("📝", "Заметок пока нет", "Записывайте мысли после уроков и мероприятий.")); return; }
    const grid = el("div", { class: "grid-2" });
    notes.forEach(n => {
      const catColor = { "Личное": "purple", "Урок": "green", "Наставничество": "magenta", "Мероприятие": "yellow", "Рефлексия": "purple", "Администрирование": "magenta" }[n.category] || "purple";
      const card = el("div", { class: "card note-card" }, [
        el("h4", {}, [n.title]), el("p", {}, [n.content]),
        el("div", { class: "note-meta" }, [el("span", { class: "badge badge-" + catColor }, [n.category]), el("span", { style: "font-size:11.5px; color:var(--ink-faint);" }, [new Date(n.updatedAt).toLocaleDateString("ru-RU")])]),
      ]);
      card.addEventListener("click", () => openNoteModal(n));
      grid.appendChild(card);
    });
    main.appendChild(grid);
  }

  function openNoteModal(existing) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const card = el("div", { class: "modal-card" });
    card.appendChild(el("h3", {}, [existing ? "Редактировать заметку" : "Новая заметка"]));
    const title = fieldInput("Заголовок", existing?.title || "");
    const cat = fieldSelect("Категория", API.NOTE_CATS.map(c => [c, c]), existing?.category || "Личное");
    const content = fieldInput("Текст", existing?.content || "", "textarea");
    content.input.rows = 5;
    [title, cat, content].forEach(f => card.appendChild(f.wrap));
    const btns = el("div", { style: "display:flex; gap:10px; margin-top:10px;" });
    const cancel = el("button", { class: "btn btn-secondary btn-block" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-block" }, ["Сохранить"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      const payload = { title: title.input.value.trim(), category: cat.input.value, content: content.input.value.trim() };
      if (!payload.title) { toast("Введите заголовок", true); return; }
      try {
        if (existing) await API.updateNote(existing.id, payload); else await API.createNote(payload);
        backdrop.remove(); renderMain(); toast("Заметка сохранена");
      } catch (e) { apiErr(e); }
    });
    btns.appendChild(cancel); btns.appendChild(save);
    card.appendChild(btns);
    if (existing) {
      const del = el("button", { class: "btn btn-danger btn-block", style: "margin-top:8px;" }, ["Удалить заметку"]);
      del.addEventListener("click", async () => { await API.deleteNote(existing.id); backdrop.remove(); renderMain(); });
      card.appendChild(del);
    }
    backdrop.appendChild(card);
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  /* =========================== MENTOR (for user role) =========================== */
  async function renderMentorView(main, user) {
    topbar(main, "🤝 Мой наставник");
    const mentor = user.mentorId ? await API.getUser(user.mentorId).catch(() => null) : null;

    if (mentor && user.mentorStatus === "pending") {
      main.appendChild(el("div", { class: "card", style: "border-color:var(--yellow-pastel-2);" }, [
        el("div", { style: "display:flex; gap:14px; align-items:center;" }, [avatarNode(mentor, "lg"), el("div", {}, [
          el("h3", { style: "font-size:18px;" }, [mentor.fullName]),
          el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, ["⏳ Заявка отправлена — ждём подтверждения наставника."]),
        ])]),
      ]));
      return;
    }

    if (!mentor) {
      main.appendChild(emptyState("🤝", "Наставник ещё не назначен", "Выберите наставника из списка ниже — он должен подтвердить пару."));
      const mentors = await API.listUsers("mentor");
      const list = el("div", { class: "grid-2", style: "margin-top:16px;" });
      mentors.forEach(m => {
        const card = el("div", { class: "card" }, [el("div", { style: "display:flex; gap:12px; align-items:center; margin-bottom:10px;" }, [avatarNode(m), el("div", {}, [el("b", {}, [m.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [m.subject + " · стаж " + m.yearsExperience + " лет"])])])]);
        const btn = el("button", { class: "btn btn-primary btn-sm" }, ["Отправить заявку"]);
        btn.addEventListener("click", async () => { const u = await API.requestMentor(m.id); Object.assign(user, u); renderMain(); toast("Заявка отправлена наставнику"); });
        card.appendChild(btn);
        list.appendChild(card);
      });
      main.appendChild(list);
      return;
    }
    main.appendChild(el("div", { class: "card" }, [el("div", { style: "display:flex; gap:14px; align-items:center;" }, [avatarNode(mentor, "lg"), el("div", {}, [el("h3", { style: "font-size:18px;" }, [mentor.fullName]), el("p", { style: "color:var(--ink-soft); font-size:13.5px;" }, [`${mentor.subject} · стаж ${mentor.yearsExperience} лет`])])])]));
    main.appendChild(await chatCard(mentor));
  }

  async function chatCard(otherUser) {
    const card = el("div", { class: "card", style: "margin-top:16px; padding:0; overflow:hidden;" });
    card.appendChild(el("div", { class: "card-title", style: "padding:18px 18px 0;" }, ["💬 Чат с " + otherUser.fullName.split(" ")[0]]));
    const scroll = el("div", { style: "max-height:360px; overflow-y:auto; padding:14px 18px;" });
    const msgs = await API.listMessages(otherUser.id);
    const myId = API.getCurUser().id;
    if (!msgs.length) scroll.appendChild(el("p", { style: "color:var(--ink-faint); font-size:13px;" }, ["Сообщений пока нет — начните разговор."]));
    msgs.forEach(m => {
      const mine = m.from === myId;
      scroll.appendChild(el("div", { class: "msg-row " + (mine ? "me" : "ai"), style: "margin-bottom:10px;" }, [el("div", { class: "msg-bubble", style: mine ? "" : "background:var(--bg-alt); border:1px solid var(--border);" }, [m.text])]));
    });
    card.appendChild(scroll);
    const bar = el("div", { style: "display:flex; gap:8px; padding:14px 18px; border-top:1px solid var(--border);" });
    const input = el("input", { type: "text", placeholder: "Написать сообщение…", style: "flex:1; border:1.5px solid var(--border); border-radius:12px; padding:10px 14px; font-family:var(--font-body);" });
    const send = el("button", { class: "btn btn-primary btn-sm" }, ["Отправить"]);
    const doSend = async () => { const v = input.value.trim(); if (!v) return; await API.sendMessage(otherUser.id, v); input.value = ""; renderMain(); };
    send.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
    bar.appendChild(input); bar.appendChild(send);
    card.appendChild(bar);
    setTimeout(() => { scroll.scrollTop = scroll.scrollHeight; }, 0);
    return card;
  }

  /* =========================== MENTEES (for mentor role) =========================== */
  async function renderMenteesView(main, user) {
    const mentees = await API.listUsers("user");
    if (currentSub) {
      const m = await API.getUser(currentSub).catch(() => null);
      if (m) return renderMenteeDetail(main, m);
    }
    topbar(main, "🎓 Мои педагоги", `${mentees.length} подопечных`);

    const reports = await API.menteeReports();
    if (reports.length) {
      const rCard = el("div", { class: "card", style: "margin-bottom:18px; border-color:var(--yellow-pastel-2);" }, [el("div", { class: "card-title" }, [`📝 Отчёты на проверку (${reports.length})`])]);
      reports.forEach(r => {
        const row = el("div", { style: "padding:10px 0; border-bottom:1px solid var(--border);" }, [
          el("div", { style: "font-weight:700; font-size:13.5px;" }, [r.mentee_name + " — " + r.event_title]),
          el("div", { style: "font-size:12.5px; color:var(--ink-soft); margin:4px 0;" }, [r.report_text || "(без текста)"]),
          el("div", { style: "font-size:12px; color:var(--ink-faint);" }, ["Полезность по мнению педагога: " + (r.usefulness_rating || "—") + "/5"]),
        ]);
        const rateRow = el("div", { style: "display:flex; gap:8px; align-items:center; margin-top:6px;" });
        const sel = document.createElement("select");
        [1, 2, 3, 4, 5].forEach(v => sel.appendChild(new Option(String(v), v, v === 5, v === 5)));
        sel.style.cssText = "padding:6px 10px; border-radius:8px; border:1.5px solid var(--border);";
        const btn = el("button", { class: "btn btn-primary btn-sm" }, ["Оценить"]);
        btn.addEventListener("click", async () => { await API.mentorRateProgress(r.id, parseInt(sel.value, 10)); renderMain(); toast("Оценка сохранена"); });
        rateRow.appendChild(sel); rateRow.appendChild(btn);
        row.appendChild(rateRow);
        rCard.appendChild(row);
      });
      main.appendChild(rCard);
    }

    if (!mentees.length) { main.appendChild(emptyState("🎓", "Пока нет подопечных", "Педагоги появятся здесь после подтверждения заявки на наставничество.")); return; }
    const grid = el("div", { class: "grid-2" });
    mentees.forEach(m => {
      const card = el("div", { class: "card", style: "cursor:pointer;" }, [el("div", { style: "display:flex; gap:12px; align-items:center; margin-bottom:12px;" }, [avatarNode(m), el("div", {}, [el("b", {}, [m.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [m.subject + " · этап " + m.currentStage + "/6"])])])]);
      if (API.hasScores(m)) API.COMPETENCIES.forEach(c => card.appendChild(miniScoreRow(c, m.scores[c.id])));
      else card.appendChild(el("p", { style: "font-size:12.5px; color:var(--ink-faint);" }, ["Диагностика ещё не пройдена"]));
      card.addEventListener("click", () => go("mentees", m.id));
      grid.appendChild(card);
    });
    main.appendChild(grid);
  }

  async function renderMenteeDetail(main, m) {
    const back = el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:12px;" }, ["← Все педагоги"]);
    back.addEventListener("click", () => go("mentees"));
    main.appendChild(back);
    topbar(main, m.fullName, `${m.subject} · стаж ${m.yearsExperience} лет · этап ${m.currentStage}/6 · ${m.region || "без региона"}`);
    if (API.hasScores(m)) {
      const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📊 Компетенции"])]);
      API.COMPETENCIES.forEach(c => card.appendChild(miniScoreRow(c, m.scores[c.id])));
      main.appendChild(card);
    } else main.appendChild(emptyState("📊", "Диагностика ещё не пройдена", "Педагог пока не прошёл диалог с ИИ-наставником."));
    main.appendChild(await chatCard(m));
  }

  /* =========================== MENTOR: GROUPS =========================== */
  async function renderGroupsView(main, user) {
    if (currentSub) {
      const g = await API.getGroup(currentSub).catch(() => null);
      if (g) return renderGroupDetail(main, user, g);
    }
    const groups = await API.listGroups();
    topbar(main, "👨‍👩‍👧‍👦 Группы", `${groups.length} групп`, [
      (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["+ Новая группа"]); b.addEventListener("click", () => openCreateGroupModal()); return b; })(),
    ]);
    if (!groups.length) { main.appendChild(emptyState("👨‍👩‍👧‍👦", "Групп пока нет", "Объедините подопечных в группу, чтобы выдавать им задания и тесты сразу всем.")); return; }
    const grid = el("div", { class: "grid-2" });
    groups.forEach(g => {
      const card = el("div", { class: "card", style: "cursor:pointer;" }, [
        el("b", {}, [g.name]),
        el("p", { style: "font-size:12.5px; color:var(--ink-faint); margin:6px 0;" }, [g.description || "Без описания"]),
        el("div", { class: "chip", style: "cursor:default;" }, [`${g.memberCount} педагогов`]),
      ]);
      card.addEventListener("click", () => go("groups", g.id));
      grid.appendChild(card);
    });
    main.appendChild(grid);
  }

  function openCreateGroupModal() {
    const backdrop = el("div", { class: "modal-backdrop" });
    const name = document.createElement("input");
    name.placeholder = "Название группы";
    name.style.cssText = "width:100%; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:10px;";
    const desc = document.createElement("textarea");
    desc.placeholder = "Описание (необязательно)";
    desc.style.cssText = "width:100%; min-height:70px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:14px;";
    const modal = el("div", { class: "modal" }, [el("h3", { style: "margin-bottom:12px;" }, ["Новая группа"]), name, desc]);
    const row = el("div", { style: "display:flex; gap:10px; justify-content:flex-end;" });
    const cancel = el("button", { class: "btn btn-ghost btn-sm" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-sm" }, ["Создать"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      if (!name.value.trim()) { toast("Введите название"); return; }
      const g = await API.createGroup(name.value.trim(), desc.value.trim());
      backdrop.remove();
      go("groups", g.id);
    });
    row.appendChild(cancel); row.appendChild(save);
    modal.appendChild(row);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  async function renderGroupDetail(main, user, g) {
    topbar(main, "👨‍👩‍👧‍👦 " + g.group.name, g.group.description, [
      (() => { const b = el("button", { class: "btn btn-ghost btn-sm" }, ["← Назад"]); b.addEventListener("click", () => go("groups")); return b; })(),
    ]);
    const mentees = await API.listUsers("user");
    const memberIds = new Set(g.members.map(m => m.id));

    const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, [`Участники (${g.members.length})`])]);
    if (!g.members.length) card.appendChild(el("p", { style: "font-size:13px; color:var(--ink-faint);" }, ["Пока никого нет — добавьте подопечных ниже."]));
    g.members.forEach(m => {
      const row = el("div", { style: "display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border);" }, [avatarNode(m, "sm"), el("div", { style: "flex:1; font-size:13.5px; font-weight:700;" }, [m.fullName])]);
      const rm = el("button", { class: "btn btn-ghost btn-sm" }, ["Убрать"]);
      rm.addEventListener("click", async () => { await API.removeGroupMember(g.group.id, m.id); renderMain(); });
      row.appendChild(rm);
      card.appendChild(row);
    });
    main.appendChild(card);

    const addable = mentees.filter(m => !memberIds.has(m.id));
    if (addable.length) {
      const addCard = el("div", { class: "card", style: "margin-top:14px;" }, [el("div", { class: "card-title" }, ["Добавить подопечного"])]);
      addable.forEach(m => {
        const row = el("div", { style: "display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border);" }, [avatarNode(m, "sm"), el("div", { style: "flex:1; font-size:13.5px;" }, [m.fullName])]);
        const add = el("button", { class: "btn btn-primary btn-sm" }, ["Добавить"]);
        add.addEventListener("click", async () => { await API.addGroupMember(g.group.id, m.id); renderMain(); });
        row.appendChild(add);
        addCard.appendChild(row);
      });
      main.appendChild(addCard);
    }
    const del = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:16px; color:var(--magenta-ink);" }, ["Удалить группу"]);
    del.addEventListener("click", async () => { if (confirm("Удалить группу? Задания останутся у уже назначенных педагогов.")) { await API.deleteGroup(g.group.id); go("groups"); } });
    main.appendChild(del);
  }

  /* =========================== MENTOR: TEST CONSTRUCTOR =========================== */
  async function renderTestsView(main, user) {
    if (currentSub === "new") return renderTestBuilder(main, null);
    if (currentSub) {
      const t = await API.getTest(currentSub).catch(() => null);
      if (t) return renderTestBuilder(main, t);
    }
    const tests = await API.listTests();
    topbar(main, "🧩 Конструктор тестов", `${tests.length} тестов`, [
      (() => { const b = el("button", { class: "btn btn-primary btn-sm" }, ["+ Новый тест"]); b.addEventListener("click", () => go("tests", "new")); return b; })(),
    ]);
    if (!tests.length) { main.appendChild(emptyState("🧩", "Тестов пока нет", "Соберите тест из вопросов с вариантами ответа — потом назначите его как задание.")); return; }
    tests.forEach(t => {
      const card = el("div", { class: "card" }, [
        el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [
          el("b", {}, [t.title]),
          el("span", { style: "font-size:12px; color:var(--ink-faint);" }, [(t.questions?.length || 0) + " вопросов"]),
        ]),
      ]);
      const editBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:8px;" }, ["Изменить"]);
      editBtn.addEventListener("click", () => go("tests", t.id));
      const delBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:8px; margin-left:8px; color:var(--magenta-ink);" }, ["Удалить"]);
      delBtn.addEventListener("click", async () => { if (confirm("Удалить тест?")) { await API.deleteTest(t.id); renderMain(); } });
      card.appendChild(editBtn); card.appendChild(delBtn);
      main.appendChild(card);
    });
  }

  function renderTestBuilder(main, existing) {
    topbar(main, existing ? "✏️ Изменить тест" : "🧩 Новый тест", "", [
      (() => { const b = el("button", { class: "btn btn-ghost btn-sm" }, ["← Назад"]); b.addEventListener("click", () => go("tests")); return b; })(),
    ]);
    const title = document.createElement("input");
    title.placeholder = "Название теста"; title.value = existing?.title || "";
    title.style.cssText = "width:100%; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:10px; font-weight:700;";
    const desc = document.createElement("textarea");
    desc.placeholder = "Описание (необязательно)"; desc.value = existing?.description || "";
    desc.style.cssText = "width:100%; min-height:56px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border);";
    main.appendChild(el("div", { class: "card" }, [title, desc]));

    const qList = el("div", {});
    main.appendChild(qList);
    const questions = [];

    function addQuestionRow(existingQ) {
      const radioName = "correct" + Date.now() + Math.random().toString(36).slice(2);
      const qInput = document.createElement("input");
      qInput.placeholder = "Текст вопроса"; qInput.value = existingQ?.q || "";
      qInput.style.cssText = "width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin-bottom:8px; font-weight:700;";
      const optWrap = el("div", {});
      const optInputs = [], correctRadios = [];
      const opts = existingQ?.options?.length ? existingQ.options : ["", "", "", ""];
      opts.forEach((optVal, oi) => {
        const row = el("div", { style: "display:flex; gap:8px; align-items:center; margin-bottom:6px;" });
        const radio = document.createElement("input"); radio.type = "radio"; radio.name = radioName; radio.value = String(oi);
        if (existingQ && existingQ.correctIndex === oi) radio.checked = true;
        const optInput = document.createElement("input"); optInput.placeholder = "Вариант " + (oi + 1); optInput.value = optVal || "";
        optInput.style.cssText = "flex:1; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border);";
        row.appendChild(radio); row.appendChild(optInput);
        optWrap.appendChild(row);
        optInputs.push(optInput); correctRadios.push(radio);
      });
      const points = document.createElement("input");
      points.type = "number"; points.min = "1"; points.value = existingQ?.points || 1;
      points.style.cssText = "width:70px; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border);";
      const pointsLabel = el("label", { style: "font-size:11.5px; color:var(--ink-faint); display:block; margin-top:6px;" }, ["Баллов за вопрос: "]);
      pointsLabel.appendChild(points);
      const removeBtn = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:6px; color:var(--magenta-ink);" }, ["Удалить вопрос"]);
      const block = el("div", { class: "card", style: "margin-bottom:12px;" }, [qInput, optWrap, pointsLabel, removeBtn]);
      removeBtn.addEventListener("click", () => { block.remove(); const i = questions.findIndex(x => x.block === block); if (i >= 0) questions.splice(i, 1); });
      qList.appendChild(block);
      questions.push({ block, qInput, optInputs, correctRadios, points });
    }

    (existing?.questions?.length ? existing.questions : [null]).forEach(q => addQuestionRow(q));

    const addBtn = el("button", { class: "btn btn-ghost btn-sm" }, ["+ Добавить вопрос"]);
    addBtn.addEventListener("click", () => addQuestionRow(null));
    main.appendChild(addBtn);

    const saveBtn = el("button", { class: "btn btn-primary btn-sm", style: "margin-left:10px;" }, [existing ? "Сохранить" : "Создать тест"]);
    saveBtn.addEventListener("click", async () => {
      if (!title.value.trim()) { toast("Введите название теста"); return; }
      const payload = questions.map(q => {
        const correct = q.correctRadios.find(r => r.checked);
        return { q: q.qInput.value.trim(), options: q.optInputs.map(o => o.value.trim()).filter(Boolean), correctIndex: correct ? parseInt(correct.value, 10) : -1, points: parseInt(q.points.value, 10) || 1 };
      });
      if (payload.some(q => !q.q || q.options.length < 2 || q.correctIndex < 0)) { toast("В каждом вопросе: текст, минимум 2 варианта и отмеченный верный ответ"); return; }
      try {
        if (existing) await API.updateTest(existing.id, { title: title.value.trim(), description: desc.value.trim(), questions: payload });
        else await API.createTest(title.value.trim(), desc.value.trim(), payload);
        toast("Сохранено"); go("tests");
      } catch (e) { apiErr(e); }
    });
    main.appendChild(saveBtn);
  }

  /* =========================== ЗАДАНИЯ (наставник создаёт/оценивает, педагог сдаёт) =========================== */
  function statusLabel(status, score, total) {
    if (status === "assigned") return "⏳ Не сдано";
    if (status === "submitted") return "📤 На проверке";
    if (status === "graded") return `✅ Оценено${score != null ? `: ${score}/${total}` : ""}`;
    return "";
  }

  async function renderAssignmentsView(main, user) {
    if (currentSub) {
      const data = await API.getAssignment(currentSub).catch(() => null);
      if (data) return renderAssignmentDetail(main, user, data);
    }
    const list = await API.listAssignments();
    const actions = [];
    if (user.role === "mentor") {
      const b = el("button", { class: "btn btn-primary btn-sm" }, ["+ Новое задание"]);
      b.addEventListener("click", () => openCreateAssignmentModal());
      actions.push(b);
    }
    topbar(main, "📮 Задания", `${list.length}`, actions);
    if (!list.length) {
      main.appendChild(emptyState("📮", "Заданий пока нет", user.role === "mentor" ? "Создайте задание или тест и назначьте группе или отдельным педагогам." : "Наставник ещё не назначил вам заданий."));
      return;
    }
    list.forEach(a => {
      const card = el("div", { class: "card", style: "cursor:pointer;" }, [
        el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [
          el("b", {}, [a.title]),
          el("span", { class: "chip", style: "cursor:default;" }, [a.testId ? "🧩 Тест" : "📝 Задание"]),
        ]),
        el("p", { style: "font-size:12.5px; color:var(--ink-faint); margin-top:6px;" }, [
          user.role === "mentor" ? `Сдали: ${a.submittedCount}/${a.targetCount}` : statusLabel(a.myStatus, a.myScore, a.myTotal),
        ]),
      ]);
      card.addEventListener("click", () => go("assignments", a.id));
      main.appendChild(card);
    });
  }

  async function openCreateAssignmentModal() {
    const [tests, groups, mentees] = await Promise.all([API.listTests(), API.listGroups(), API.listUsers("user")]);
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" }, [el("h3", { style: "margin-bottom:12px;" }, ["Новое задание"])]);
    const title = document.createElement("input");
    title.placeholder = "Название"; title.style.cssText = "width:100%; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:10px;";
    const desc = document.createElement("textarea");
    desc.placeholder = "Описание / инструкция"; desc.style.cssText = "width:100%; min-height:60px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:10px;";
    modal.appendChild(title); modal.appendChild(desc);

    modal.appendChild(el("label", { style: "font-size:12px; color:var(--ink-soft);" }, ["Тест (необязательно — иначе свободный текстовый ответ)"]));
    const testSel = document.createElement("select");
    testSel.style.cssText = "width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin:6px 0 12px;";
    testSel.appendChild(new Option("— Без теста (свободный ответ) —", ""));
    tests.forEach(t => testSel.appendChild(new Option(t.title, t.id)));
    modal.appendChild(testSel);

    modal.appendChild(el("label", { style: "font-size:12px; color:var(--ink-soft);" }, ["Группа (необязательно)"]));
    const groupSel = document.createElement("select");
    groupSel.style.cssText = "width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin:6px 0 12px;";
    groupSel.appendChild(new Option("— Без группы —", ""));
    groups.forEach(g => groupSel.appendChild(new Option(g.name, g.id)));
    modal.appendChild(groupSel);

    modal.appendChild(el("label", { style: "font-size:12px; color:var(--ink-soft);" }, ["Или выберите педагогов вручную"]));
    const checks = [];
    const menteeBox = el("div", { style: "max-height:120px; overflow-y:auto; margin:6px 0 12px;" });
    mentees.forEach(m => {
      const label = el("label", { style: "display:flex; gap:8px; align-items:center; font-size:13px; padding:4px 0;" });
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = m.id;
      label.appendChild(cb); label.appendChild(document.createTextNode(m.fullName));
      menteeBox.appendChild(label);
      checks.push(cb);
    });
    modal.appendChild(menteeBox);

    modal.appendChild(el("label", { style: "font-size:12px; color:var(--ink-soft);" }, ["🪙 Награда в монетах"]));
    const coins = document.createElement("input");
    coins.type = "number"; coins.value = "10"; coins.style.cssText = "width:100%; padding:8px 12px; border-radius:10px; border:1.5px solid var(--border); margin:6px 0 14px;";
    modal.appendChild(coins);

    const row = el("div", { style: "display:flex; gap:10px; justify-content:flex-end;" });
    const cancel = el("button", { class: "btn btn-ghost btn-sm" }, ["Отмена"]);
    const save = el("button", { class: "btn btn-primary btn-sm" }, ["Создать"]);
    cancel.addEventListener("click", () => backdrop.remove());
    save.addEventListener("click", async () => {
      if (!title.value.trim()) { toast("Введите название"); return; }
      const userIds = checks.filter(c => c.checked).map(c => c.value);
      if (!groupSel.value && !userIds.length) { toast("Выберите группу или хотя бы одного педагога"); return; }
      try {
        const a = await API.createAssignment({ title: title.value.trim(), description: desc.value.trim(), testId: testSel.value || null, groupId: groupSel.value || null, userIds, coinReward: parseInt(coins.value, 10) || 10 });
        backdrop.remove();
        go("assignments", a.id);
      } catch (e) { apiErr(e); }
    });
    row.appendChild(cancel); row.appendChild(save);
    modal.appendChild(row);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  async function renderAssignmentDetail(main, user, data) {
    const a = data.assignment;
    topbar(main, "📮 " + a.title, a.description, [
      (() => { const b = el("button", { class: "btn btn-ghost btn-sm" }, ["← Назад"]); b.addEventListener("click", () => go("assignments")); return b; })(),
    ]);

    if (user.role === "mentor") {
      const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, [`Сдачи (${data.targets.length})`])]);
      if (!data.targets.length) card.appendChild(el("p", { style: "font-size:13px; color:var(--ink-faint);" }, ["Пока никто не назначен."]));
      data.targets.forEach(t => {
        const row = el("div", { style: "padding:10px 0; border-bottom:1px solid var(--border);" }, [
          el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [el("b", { style: "font-size:13.5px;" }, [t.userName]), el("span", { class: "chip", style: "cursor:default;" }, [statusLabel(t.status, t.score, t.total)])]),
        ]);
        if (t.answerText) row.appendChild(el("p", { style: "font-size:12.5px; color:var(--ink-soft); margin-top:6px;" }, [t.answerText]));
        if (t.status === "submitted" && !a.testId) {
          const scoreInput = document.createElement("input"); scoreInput.type = "number"; scoreInput.placeholder = "балл";
          scoreInput.style.cssText = "width:60px; padding:6px; border-radius:8px; border:1.5px solid var(--border); margin-top:6px;";
          const totalInput = document.createElement("input"); totalInput.type = "number"; totalInput.placeholder = "из"; totalInput.value = "10";
          totalInput.style.cssText = "width:60px; padding:6px; border-radius:8px; border:1.5px solid var(--border); margin-top:6px; margin-left:6px;";
          const fb = document.createElement("input"); fb.placeholder = "Комментарий";
          fb.style.cssText = "width:100%; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border); margin-top:6px;";
          const gradeBtn = el("button", { class: "btn btn-primary btn-sm", style: "margin-top:6px;" }, ["Оценить"]);
          gradeBtn.addEventListener("click", async () => { await API.gradeAssignment(a.id, t.userId, parseInt(scoreInput.value, 10) || 0, parseInt(totalInput.value, 10) || 10, fb.value); renderMain(); });
          row.appendChild(scoreInput); row.appendChild(totalInput); row.appendChild(fb); row.appendChild(gradeBtn);
        }
        if (t.mentorFeedback) row.appendChild(el("p", { style: "font-size:12px; color:var(--purple-ink); margin-top:6px;" }, ["💬 " + t.mentorFeedback]));
        card.appendChild(row);
      });
      main.appendChild(card);
      return;
    }

    const mt = data.myTarget;
    if (mt.status !== "assigned") {
      main.appendChild(el("div", { class: "card" }, [
        el("div", { class: "chip", style: "cursor:default; margin-bottom:10px;" }, [statusLabel(mt.status, mt.score, mt.total)]),
        mt.answerText ? el("p", { style: "font-size:13.5px; color:var(--ink-soft);" }, [mt.answerText]) : null,
        mt.mentorFeedback ? el("p", { style: "font-size:12.5px; color:var(--purple-ink); margin-top:8px;" }, ["💬 " + mt.mentorFeedback]) : null,
      ]));
      return;
    }

    if (data.questions) {
      const inputs = [];
      const card = el("div", { class: "card" });
      data.questions.forEach((q, qi) => {
        const block = el("div", { style: "margin-bottom:14px;" }, [el("p", { style: "font-weight:700; font-size:13.5px; margin-bottom:6px;" }, [`${qi + 1}. ${q.q}`])]);
        const group = [];
        q.options.forEach((opt, oi) => {
          const label = el("label", { style: "display:flex; gap:8px; align-items:center; font-size:13px; padding:4px 0;" });
          const radio = document.createElement("input"); radio.type = "radio"; radio.name = "aq" + qi; radio.value = String(oi);
          label.appendChild(radio); label.appendChild(document.createTextNode(opt));
          block.appendChild(label); group.push(radio);
        });
        inputs.push(group);
        card.appendChild(block);
      });
      const submitBtn = el("button", { class: "btn btn-primary btn-sm" }, ["Сдать тест"]);
      submitBtn.addEventListener("click", async () => {
        const answers = inputs.map(g => { const p = g.find(r => r.checked); return p ? parseInt(p.value, 10) : -1; });
        await API.submitAssignment(a.id, { testAnswers: answers });
        toast("Сдано!"); renderMain();
      });
      card.appendChild(submitBtn);
      main.appendChild(card);
    } else {
      const ta = document.createElement("textarea");
      ta.placeholder = "Ваш ответ"; ta.style.cssText = "width:100%; min-height:120px; padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); margin-bottom:12px;";
      const submitBtn = el("button", { class: "btn btn-primary btn-sm" }, ["Сдать"]);
      submitBtn.addEventListener("click", async () => {
        if (!ta.value.trim()) { toast("Введите ответ"); return; }
        await API.submitAssignment(a.id, { answerText: ta.value.trim() });
        toast("Сдано!"); renderMain();
      });
      main.appendChild(el("div", { class: "card" }, [ta, submitBtn]));
    }
  }

  /* =========================== ADMIN: USERS =========================== */
  let userRoleFilter = "user";
  async function renderUsersView(main, admin) {
    if (currentSub) {
      const u = await API.getUser(currentSub).catch(() => null);
      if (u) return renderUserDetail(main, u);
    }
    topbar(main, "👥 Педагоги и наставники");
    const chipRow = el("div", { class: "chip-row", style: "margin-bottom:18px;" });
    [["user", "Педагоги"], ["mentor", "Наставники"]].forEach(([v, l]) => {
      const chip = el("button", { class: "chip" + (userRoleFilter === v ? " active" : "") }, [l]);
      chip.addEventListener("click", () => { userRoleFilter = v; renderMain(); });
      chipRow.appendChild(chip);
    });
    main.appendChild(chipRow);

    const list = await API.listUsers(userRoleFilter);
    if (!list.length) { main.appendChild(emptyState("👥", "Никого нет", "Пока в этой категории нет пользователей.")); return; }
    for (const u of list) {
      const row = el("div", { class: "card", style: "display:flex; align-items:center; gap:14px; cursor:pointer;" });
      row.appendChild(avatarNode(u));
      const info = el("div", { style: "flex:1;" }, [el("b", {}, [u.fullName]), el("div", { style: "font-size:12px; color:var(--ink-faint);" }, [`${u.subject} · ${u.email} · ${u.region || "без региона"}` + (userRoleFilter === "user" ? ` · балл ${API.hasScores(u) ? API.avgScore(u).toFixed(1) : "—"}` : "")])]);
      row.appendChild(info);
      if (userRoleFilter === "user") {
        const mentorName = u.mentorId ? (await API.getUser(u.mentorId).catch(() => null))?.fullName || "—" : "не назначен";
        row.appendChild(el("span", { class: "badge badge-purple" }, ["Наставник: " + mentorName.split(" ")[0]]));
      }
      row.addEventListener("click", () => go("users", u.id));
      main.appendChild(row);
    }
  }

  async function renderUserDetail(main, u) {
    const back = el("button", { class: "btn btn-ghost btn-sm", style: "margin-bottom:12px;" }, ["← Все пользователи"]);
    back.addEventListener("click", () => go("users"));
    main.appendChild(back);
    topbar(main, u.fullName, `${API.roleLabel(u.role)} · ${u.subject} · ${u.email} · ${u.region || "без региона"}`);

    if (u.role === "user") {
      const mentorCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["🤝 Наставник"])]);
      const sel = document.createElement("select");
      sel.appendChild(new Option("— не назначен —", ""));
      const mentors = await API.listUsers("mentor");
      mentors.forEach(m => sel.appendChild(new Option(m.fullName, m.id, m.id === u.mentorId, m.id === u.mentorId)));
      sel.style.cssText = "padding:10px 14px; border-radius:12px; border:1.5px solid var(--border); font-family:var(--font-body); width:100%; margin-bottom:10px;";
      const saveBtn = el("button", { class: "btn btn-primary btn-sm" }, ["Сохранить"]);
      saveBtn.addEventListener("click", async () => { await API.setMentor(u.id, sel.value || null); toast("Наставник обновлён"); renderMain(); });
      mentorCard.appendChild(sel); mentorCard.appendChild(saveBtn);
      main.appendChild(mentorCard);
      if (API.hasScores(u)) {
        const compCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["📊 Компетенции"])]);
        API.COMPETENCIES.forEach(c => compCard.appendChild(miniScoreRow(c, u.scores[c.id])));
        main.appendChild(compCard);
      }
    }
    const delCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, ["⚠️ Опасная зона"]), el("p", { style: "font-size:13px; color:var(--ink-soft); margin-bottom:12px;" }, ["Удаление аккаунта необратимо."])]);
    const delBtn = el("button", { class: "btn btn-danger btn-sm" }, ["Удалить пользователя"]);
    delBtn.addEventListener("click", async () => { if (confirm("Удалить " + u.fullName + "?")) { await API.deleteUser(u.id); go("users"); toast("Пользователь удалён"); } });
    delCard.appendChild(delBtn);
    main.appendChild(delCard);
  }

  /* =========================== PROFILE =========================== */
  async function renderProfile(main, user) {
    topbar(main, "⚙️ Профиль");
    const card = el("div", { class: "card" }, [el("div", { style: "display:flex; align-items:center; gap:14px; margin-bottom:18px;" }, [avatarNode(user, "lg"), el("div", {}, [el("h3", { style: "font-size:18px;" }, [user.fullName]), el("p", { style: "color:var(--ink-soft); font-size:13px;" }, [API.roleLabel(user.role) + " · " + user.email])])])]);
    const name = fieldInput("Полное имя", user.fullName);
    const subject = fieldInput("Предмет", user.subject);
    const school = fieldInput("Школа", user.school);
    const region = fieldInput("Регион (используется ИИ для поиска мероприятий)", user.region);
    const years = fieldInput("Стаж (лет)", String(user.yearsExperience || 0));
    [name, subject, school, region, years].forEach(f => card.appendChild(f.wrap));
    const saveBtn = el("button", { class: "btn btn-primary" }, ["Сохранить изменения"]);
    saveBtn.addEventListener("click", async () => {
      try {
        await API.updateMe({ fullName: name.input.value.trim(), subject: subject.input.value.trim(), school: school.input.value.trim(), region: region.input.value.trim(), yearsExperience: parseInt(years.input.value || "0", 10) });
        await renderShell();
        toast("Профиль обновлён");
      } catch (e) { apiErr(e); }
    });
    card.appendChild(saveBtn);
    main.appendChild(card);

    const statusCard = el("div", { class: "card" }, [
      el("div", { class: "card-title" }, ["🤖 Статус ИИ-наставника"]),
      el("p", { style: "font-size:13px; color:var(--ink-soft);" }, [
        AI_LIVE
          ? "Подключён Gemini API с поиском в интернете (Google Search grounding) — карта строится из реальных мероприятий вашего региона."
          : "ИИ работает в офлайн-режиме: диалоговая диагностика доступна, но поиск реальных мероприятий отключён. Чтобы включить его, администратор платформы должен указать ключ Gemini API в настройках сервера (переменная GEMINI_API_KEY) — см. README бэкенда.",
      ]),
    ]);
    main.appendChild(statusCard);

    if (user.role === "user" && API.hasScores(user)) {
      const pCard = el("div", { class: "card", style: "margin-top:18px;" }, [el("div", { class: "card-title" }, ["🎓 Цифровое портфолио (этап 6)"])]);
      const pText = el("p", { style: "font-size:13.5px; color:var(--ink-soft); white-space:pre-line; margin-bottom:10px;" }, ["Загружаю…"]);
      pCard.appendChild(pText);
      const refreshBtn = el("button", { class: "btn btn-ghost btn-sm" }, ["🔄 Пересобрать"]);
      refreshBtn.addEventListener("click", async () => { pText.textContent = "Загружаю…"; const p = await API.getPortfolio(true); pText.textContent = p.text; });
      pCard.appendChild(refreshBtn);
      main.appendChild(pCard);
      API.getPortfolio().then(p => { pText.textContent = p.text; }).catch(() => { pText.textContent = "Не удалось собрать портфолио."; });
    }
  }

  /* =========================== BOOT =========================== */
  window.addEventListener("hashchange", () => {
    const hash = location.hash.replace("#/", "");
    if (hash && API.isLoggedIn()) { currentView = hash.split("/")[0]; currentSub = hash.split("/")[1] || null; renderMain(); }
  });

  document.addEventListener("DOMContentLoaded", async () => {
    bindLanding();
    if (API.isLoggedIn()) {
      const user = await API.fetchMe();
      if (user) await enterApp();
    }
  });
})();
