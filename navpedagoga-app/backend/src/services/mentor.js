import { COMPETENCIES, query } from "../db.js";
import { callGemini, hasApiKey } from "./gemini.js";
import { awardCoins, REWARDS } from "./gamification.js";

const SCORE_CHIPS = [
  { v: 1, t: "Совсем не уверен(а), нужна помощь с нуля" },
  { v: 2, t: "Есть большие трудности" },
  { v: 3, t: "Средне — получается, но нестабильно" },
  { v: 4, t: "Уверенно, но есть куда расти" },
  { v: 5, t: "Это моя сильная сторона" },
];

const QUESTIONS = {
  subject: "Начнём с предмета. Насколько уверенно вы чувствуете себя в своём предмете и его научной базе — легко ли отвечаете на неожиданные вопросы учеников?",
  pedagogy: "Как обстоят дела с управлением классом? Получается удерживать внимание и дисциплину на протяжении всего урока?",
  method: "Теперь про методику. Насколько легко вам планировать уроки и разрабатывать рабочую программу?",
  digital: "А как с цифровыми инструментами — МЭШ, ЭОР, интерактивные задания?",
  communication: "Расскажите про коммуникацию: как складывается общение с родителями, коллегами, администрацией?",
  personal: "И последнее — про личный бренд. Участвуете ли в конкурсах, сообществах?",
};

const FOLLOWUP_LOW = {
  subject: "Понимаю. Что именно вызывает больше всего сомнений — конкретные темы, или уверенность отвечать «на лету»?",
  pedagogy: "Спасибо за честность. В какой момент урока дисциплина проседает сильнее всего?",
  method: "Ясно. Сложнее с самим планированием или с тем, чтобы уложиться в рабочую программу?",
  digital: "Понял. Дело в незнакомых инструментах или просто не хватает времени их осваивать?",
  communication: "Хорошо, что говорите об этом. Сложнее с родителями, коллегами или администрацией?",
  personal: "Не хватает времени, идей — или пока не знаете, с чего начать?",
};

const MICRO_FEEDBACK = {
  5: ["Отлично, это явно ваша опора.", "Сильная сторона — будем на неё опираться."],
  4: ["Хорошая база, отшлифуем детали.", "Уже уверенно, есть куда расти вглубь."],
  3: ["Понимаю, нестабильность — это нормально на старте.", "Окей, зафиксировал."],
  2: ["Спасибо за честность — частая точка роста у молодых педагогов.", "Понял, возьмём это в приоритет."],
  1: ["Спасибо, что не стали приукрашивать — с этого и начинается рост.", "Окей, это будет приоритет №1."],
};

const POS_WORDS = ["уверен", "легко", "хорошо", "отлично", "люблю", "получается", "сильная сторона", "опытн", "свободно", "нравится", "спокойно"];
const NEG_WORDS = ["не умею", "не знаю", "сложно", "трудно", "боюсь", "путаюсь", "не получается", "слабо", "плохо", "затрудня", "не уверен", "тяжело", "паника", "стресс"];

function inferScore(text) {
  const t = text.toLowerCase();
  let s = 3;
  POS_WORDS.forEach((w) => { if (t.includes(w)) s += 1; });
  NEG_WORDS.forEach((w) => { if (t.includes(w)) s -= 1; });
  return Math.max(1, Math.min(5, s));
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function firstName(u) { return (u.fullName || "коллега").split(" ")[0]; }
function compOrder() { return COMPETENCIES.map((c) => c.id); }
function questionFor(idx) { const id = compOrder()[idx]; return { id, comp: COMPETENCIES.find((c) => c.id === id), text: QUESTIONS[id] }; }

const DEFAULT_PROFILE = () => ({ stepIndex: 0, awaitingFollowup: false, answers: {}, notes: {}, done: false });

async function loadProfile(userId) {
  const { rows } = await query("SELECT * FROM ai_profiles WHERE user_id = $1", [userId]);
  if (!rows[0]) return DEFAULT_PROFILE();
  return { stepIndex: rows[0].step_index, awaitingFollowup: rows[0].awaiting_followup, answers: rows[0].answers, notes: rows[0].notes, done: rows[0].done };
}

async function saveProfile(userId, state) {
  await query(
    `INSERT INTO ai_profiles (user_id, step_index, awaiting_followup, answers, notes, done) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET step_index = $2, awaiting_followup = $3, answers = $4, notes = $5, done = $6`,
    [userId, state.stepIndex, state.awaitingFollowup, JSON.stringify(state.answers), JSON.stringify(state.notes), state.done]
  );
}

export async function startDiagnostic(user) {
  await saveProfile(user.id, DEFAULT_PROFILE());
  await query("DELETE FROM ai_chats WHERE user_id = $1", [user.id]); // начинаем диагностику заново — старую историю чата с ИИ очищаем
  const q = questionFor(0);
  return [
    { role: "ai", text: `Привет, ${firstName(user)}! Я ваш ИИ-наставник 🤖 Вместо теста — просто поговорим. Пройдёмся по 6 направлениям, а в конце я найду для вас реальные мероприятия в регионе «${user.region || "не указан"}» и соберу дорожную карту.` },
    { role: "ai", text: `${q.comp.icon} **${q.comp.label}**\n${q.text}`, chips: SCORE_CHIPS.map((c) => c.t) },
  ];
}

export async function isDiagnosticActive(userId) {
  const p = await loadProfile(userId);
  return Boolean(p && !p.done);
}

export async function handleDiagnosticReply(user, input) {
  const state = await loadProfile(user.id);
  const out = [];
  const idx = state.stepIndex;
  const q = questionFor(idx);

  if (state.awaitingFollowup) {
    state.notes[q.id] = input;
    state.awaitingFollowup = false;
    out.push({ role: "ai", text: pick(["Записал, это поможет точнее подобрать мероприятия.", "Спасибо, учту это в карте."]) });
    await advance(state, out, user);
    await saveProfile(user.id, state);
    return out;
  }

  const chipMatch = SCORE_CHIPS.find((c) => c.t === input);
  const score = chipMatch ? chipMatch.v : inferScore(input);
  state.answers[q.id] = score;
  out.push({ role: "ai", text: pick(MICRO_FEEDBACK[score]) });

  if (score <= 2 && chipMatch) {
    state.awaitingFollowup = true;
    out.push({ role: "ai", text: FOLLOWUP_LOW[q.id] });
  } else {
    await advance(state, out, user);
  }
  await saveProfile(user.id, state);
  return out;
}

async function advance(state, out, user) {
  state.stepIndex += 1;
  if (state.stepIndex >= compOrder().length) {
    state.done = true;
    const scores = {};
    compOrder().forEach((id) => { scores[id] = state.answers[id] || 3; });
    await query("UPDATE users SET scores = $1, current_stage = GREATEST(current_stage, 2) WHERE id = $2", [JSON.stringify(scores), user.id]);
    await awardCoins(user.id, REWARDS.DIAGNOSTIC_DONE, "Диагностика пройдена");
    const weak = COMPETENCIES.filter((c) => scores[c.id] <= 2).map((c) => `${c.icon} ${c.label} (${scores[c.id]}/5)`).join(", ") || "выраженных дефицитов не выявлено";
    out.push({ role: "ai", text: `Готово! 🎉 Средний балл: **${(Object.values(scores).reduce((a, b) => a + b, 0) / 6).toFixed(1)}/5**\nПриоритеты: ${weak}` });
    out.push({ role: "ai", text: `Сейчас поищу для вас реальные мероприятия в регионе «${user.region || "не указан"}» и соберу дорожную карту — откройте вкладку «Дорожная карта».`, action: "generate-roadmap" });
  } else {
    const q = questionFor(state.stepIndex);
    out.push({ role: "ai", text: `${q.comp.icon} **${q.comp.label}**\n${q.text}`, chips: SCORE_CHIPS.map((c) => c.t) });
  }
}

// ---------------- ongoing assistant (quick actions + free chat) ----------------
// Цифровой ИИ-наставник выполняет основные функции наставника (диагностика, подбор
// мероприятий, разбор рабочих ситуаций, план развития) — человек-наставник, согласно
// методологии Поляковой Г.Д. (гл. 3.2), только корректирует итоговую дорожную карту.
export const QUICK_ACTIONS = [
  { id: "map", label: "🗺️ Обновить дорожную карту (поиск в интернете)" },
  { id: "analyze", label: "🔍 Анализ дефицитов" },
  { id: "week", label: "📅 План на неделю" },
  { id: "attest", label: "🎯 Подготовка к аттестации" },
  { id: "class", label: "💡 Как работать с классом?" },
];

export function quickActionText(id, user) {
  switch (id) {
    case "map": return `Найди реальные мероприятия для молодых педагогов в регионе ${user.region || "моём регионе"} и обнови мою дорожную карту.`;
    case "analyze": return "Проведи углублённый анализ моих профессиональных дефицитов.";
    case "week": return `Составь план профессионального развития на эту неделю с учётом предмета (${user.subject || "—"}).`;
    case "attest": return "Как мне подготовиться к аттестации? Расскажи пошагово.";
    case "class": return "Дай конкретные техники управления классом для молодого педагога.";
    default: return "";
  }
}

function weakestComp(user) {
  const scores = user.scores || {};
  const comps = COMPETENCIES.map((c) => ({ comp: c, score: scores[c.id] || 3 }));
  comps.sort((a, b) => a.score - b.score);
  return comps[0];
}
function adviceFor(id) {
  const map = {
    subject: "обновите знания на курсах ПК, ведите дневник сложных вопросов учеников.",
    pedagogy: "внедрите чёткие правила урока с первой минуты, используйте «выходной билет» в конце.",
    method: "начните с шаблона рабочей программы наставника, адаптируйте постепенно.",
    digital: "выделяйте 20 минут в неделю на один новый инструмент МЭШ/ЭОР.",
    communication: "готовьте краткий скрипт перед сложным разговором.",
    personal: "выберите один конкурс или сообщество на квартал.",
  };
  return map[id] || "поговорите с наставником о конкретных шагах.";
}

function localAnswer(user, text) {
  const t = text.toLowerCase();
  const has = user.scores && Object.values(user.scores).some((v) => v > 0);
  if (/карт|маршрут|roadmap|мероприят/.test(t)) return "Чтобы найти актуальные мероприятия в вашем регионе и обновить карту, используйте кнопку «Обновить дорожную карту» — я поищу в интернете.";
  if (/дефицит|анализ|слаб/.test(t)) {
    if (!has) return "Диагностика ещё не пройдена — пройдите её, чтобы я мог точно определить дефициты.";
    let out = "🔍 Анализ дефицитов:\n";
    COMPETENCIES.forEach((c) => { const s = user.scores[c.id]; if (s && s <= 3) out += `${c.icon} ${c.label} (${s}/5) → ${adviceFor(c.id)}\n`; });
    return out.trim();
  }
  if (/недел|план на/.test(t)) {
    const w = has ? weakestComp(user) : null;
    return "📅 План на неделю:\nПн–Вт: практика по предмету.\nСр: наблюдение открытого урока.\nЧт: разговор с наставником.\nПт: рефлексия в «Заметках»." + (w ? `\nОсобое внимание — ${w.comp.label}: ${adviceFor(w.comp.id)}` : "");
  }
  if (/аттестац/.test(t)) return "🎯 Портфолио, самоанализ по 6 компетенциям, открытый урок, документы за 2 месяца, репетиция защиты с наставником.";
  if (/класс|дисциплин/.test(t)) return "💡 Правило первой минуты, проксимити-контроль, «выходной билет», невербальные сигналы, конкретная похвала сразу.";
  if (/родител/.test(t)) return "🗣️ Начинайте с позитива, формулируйте через поведение, предлагайте конкретный план, фиксируйте письменно.";
  if (/привет|здравств/.test(t)) return `Здравствуйте, ${firstName(user)}! Чем могу помочь?`;
  if (!has) return "Пока не вижу результатов диагностики — пройдите её, и я смогу давать советы точнее.";
  const w = weakestComp(user);
  return `Судя по карте, точка роста — ${w.comp.icon} ${w.comp.label} (${w.score}/5). Расскажите подробнее о ситуации, либо выберите быстрое действие ниже.`;
}

const SYS_PROMPT = "Ты — цифровой ИИ-наставник в системе «НавигаторПедагога» (методология Поляковой Г.Д.). Ты выполняешь основные функции наставника: разбираешь рабочие ситуации, подсказываешь конкретные приёмы, отслеживаешь прогресс по дорожной карте. Отвечай на русском, конкретно и по-доброму, с эмодзи-структурой, без длинных вступлений. Не изобретай названия мероприятий - для поиска мероприятий пользователь должен использовать отдельную функцию 'Обновить дорожную карту'. Помни: у наставляемого есть ещё и человек-наставник, который вправе скорректировать предложенный тобой путь — если пользователь спрашивает о решениях наставника, уважительно отсылай к нему.";

export async function assistantReply(user, text, history) {
  if (hasApiKey()) {
    try {
      const ctx = user.scores && Object.values(user.scores).some((v) => v > 0)
        ? `[Педагог: ${user.fullName}, предмет: ${user.subject}, регион: ${user.region}, баллы: ${Object.entries(user.scores).map(([k, v]) => k + ":" + v).join(" ")}] `
        : `[Педагог: ${user.fullName}, предмет: ${user.subject}, регион: ${user.region}, диагностика не пройдена] `;
      const msgs = (history || []).slice(-10).map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
      const last = msgs[msgs.length - 1];
      if (last && last.role === "user") last.content = ctx + last.content;
      const { text: replyText } = await callGemini({ system: SYS_PROMPT, messages: msgs, maxTokens: 900 });
      return replyText;
    } catch (e) {
      console.error("[assistantReply] Gemini call failed:", e.message || e);
      return localAnswer(user, text) + `\n\n_(офлайн-режим: ${e.code || "ошибка API"})_`;
    }
  }
  return localAnswer(user, text);
}
