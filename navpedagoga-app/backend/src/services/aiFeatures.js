import { query, COMPETENCIES } from "../db.js";
import { callGemini, extractJsonBlock, hasApiKey } from "./gemini.js";
import { OFFLINE_QUIZ_BANK } from "../data/offlineQuizzes.js";

function compLabel(id) { return COMPETENCIES.find((c) => c.id === id)?.label || id; }

/* ===================== Тест после мероприятия ===================== */
// Кэшируется на само мероприятие (event_quizzes), а не на пользователя — генерация дорогая
// (grounded-запрос), а вопросы для одного и того же мероприятия одинаково полезны всем.
const QUIZ_SYSTEM = `Ты — методист, который готовит короткие проверочные тесты для молодых педагогов после посещения профессионального мероприятия.
У тебя есть инструмент поиска Google. Найди актуальные методические рекомендации Министерства просвещения РФ (сайт edsoo.ru, edu.gov.ru, "Единое содержание общего образования", ФГОС) по теме, максимально близкой к описанию мероприятия и указанной компетенции.
Составь 5 вопросов с 4 вариантами ответа (один правильный), проверяющих понимание практического применения темы мероприятия, опираясь на найденные рекомендации, а не только на общие знания.
Ответ — ИСКЛЮЧИТЕЛЬНО JSON в блоке \`\`\`json ... \`\`\` по схеме:
{"questions":[{"q":"...","options":["...","...","...","..."],"correctIndex":0,"explain":"кратко почему правильный ответ верен"}]}
Никакого текста вне JSON-блока не нужно.`;

export async function getOrGenerateEventQuiz(event) {
  const existing = await query("SELECT * FROM event_quizzes WHERE event_id = $1", [event.id]);
  if (existing.rows[0]) {
    const r = existing.rows[0];
    return { questions: r.questions, sources: r.sources || [], mode: r.mode };
  }

  if (!hasApiKey()) return saveQuiz(event.id, offlineQuiz(event.area), [], "offline");

  try {
    const prompt = `Мероприятие: "${event.title}". Описание: ${event.description || "нет"}. Компетенция: ${compLabel(event.area)}. Регион: ${event.region || "—"}.`;
    const { text, sources } = await callGemini({ system: QUIZ_SYSTEM, messages: [{ role: "user", content: prompt }], googleSearch: true, maxTokens: 1600 });
    const parsed = extractJsonBlock(text);
    if (!parsed?.questions?.length) return saveQuiz(event.id, offlineQuiz(event.area), [], "offline");
    return saveQuiz(event.id, parsed.questions.slice(0, 5), sources.slice(0, 8), "live");
  } catch (e) {
    console.error("[getOrGenerateEventQuiz] failed:", e.message || e);
    return saveQuiz(event.id, offlineQuiz(event.area), [], "offline");
  }
}

function offlineQuiz(area) {
  return OFFLINE_QUIZ_BANK[area] || OFFLINE_QUIZ_BANK.subject;
}

async function saveQuiz(eventId, questions, sources, mode) {
  await query(
    `INSERT INTO event_quizzes (event_id, questions, sources, mode) VALUES ($1,$2,$3,$4)
     ON CONFLICT (event_id) DO UPDATE SET questions = $2, sources = $3, mode = $4, generated_at = now()`,
    [eventId, JSON.stringify(questions), JSON.stringify(sources), mode]
  );
  return { questions, sources, mode };
}

export async function submitQuizAttempt(eventId, userId, answers) {
  const { rows } = await query("SELECT questions FROM event_quizzes WHERE event_id = $1", [eventId]);
  if (!rows[0]) throw Object.assign(new Error("Тест не найден"), { code: "NOT_FOUND" });
  const questions = rows[0].questions;
  let score = 0;
  questions.forEach((q, i) => { if (answers[i] === q.correctIndex) score += 1; });
  const { rows: saved } = await query(
    "INSERT INTO quiz_attempts (event_id, user_id, answers, score, total) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [eventId, userId, JSON.stringify(answers), score, questions.length]
  );
  return { attempt: saved[0], questions, score, total: questions.length };
}

/* ===================== Идея 1: ИИ-дайджест «Что дальше» ===================== */
const DIGEST_SYSTEM = "Ты — цифровой ИИ-наставник платформы «НавигаторПедагога». По данным о педагоге сформулируй короткий (3-4 предложения) дружелюбный дайджест на русском: что уже сделано хорошо и что сделать в первую очередь на этой неделе. Без markdown-заголовков, только текст.";

export async function getOrGenerateDigest(user, force) {
  if (!force) {
    const { rows } = await query("SELECT * FROM ai_digests WHERE user_id = $1", [user.id]);
    if (rows[0] && Date.now() - new Date(rows[0].generated_at).getTime() < 24 * 3600 * 1000) return rows[0].text;
  }
  const text = await buildDigest(user);
  await query(
    `INSERT INTO ai_digests (user_id, text) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET text = $2, generated_at = now()`,
    [user.id, text]
  );
  return text;
}

async function buildDigest(user) {
  const scores = user.scores || {};
  const has = Object.values(scores).some((v) => v > 0);
  const { rows: progress } = await query("SELECT status FROM roadmap_progress WHERE user_id = $1", [user.id]);
  const openCount = progress.filter((p) => p.status === "open").length;
  const doneCount = progress.filter((p) => p.status !== "open").length;

  if (!hasApiKey()) return offlineDigest(scores, has, openCount, doneCount);

  try {
    const weakest = has ? COMPETENCIES.map((c) => ({ c, s: scores[c.id] || 3 })).sort((a, b) => a.s - b.s)[0] : null;
    const prompt = `Педагог: ${user.fullName}, предмет ${user.subject}, этап алгоритма ${user.currentStage}/6. ${has ? `Баллы: ${Object.entries(scores).map(([k, v]) => k + ":" + v).join(" ")}.` : "Диагностика ещё не пройдена."} В работе мероприятий: ${openCount}, завершено: ${doneCount}.${weakest ? ` Самая слабая компетенция: ${weakest.c.label}.` : ""}`;
    const { text } = await callGemini({ system: DIGEST_SYSTEM, messages: [{ role: "user", content: prompt }], maxTokens: 400 });
    return text.trim() || offlineDigest(scores, has, openCount, doneCount);
  } catch (e) {
    console.error("[buildDigest] failed:", e.message || e);
    return offlineDigest(scores, has, openCount, doneCount);
  }
}

function offlineDigest(scores, has, openCount, doneCount) {
  if (!has) return "Пока не вижу результатов диагностики — пройдите её с ИИ-наставником, и я смогу подсказывать точные следующие шаги каждую неделю.";
  const weakest = COMPETENCIES.map((c) => ({ c, s: scores[c.id] || 3 })).sort((a, b) => a.s - b.s)[0];
  let out = `На этой неделе стоит уделить внимание направлению «${weakest.c.label}» — это пока самая заметная точка роста. `;
  out += openCount ? `У вас ${openCount} мероприятий в работе — постарайтесь довести хотя бы одно до отчёта. ` : "Загляните в дорожную карту и возьмите в работу хотя бы одно мероприятие. ";
  if (doneCount) out += `Уже пройдено и отчитано: ${doneCount} — хороший темп, продолжайте.`;
  return out;
}

/* ===================== Идея 2: ИИ-ревью отчёта до отправки наставнику ===================== */
const REVIEW_SYSTEM = "Ты — ИИ-наставник. Педагог написал черновик отчёта о посещённом мероприятии для наставника. Дай короткую (2-3 предложения) конструктивную обратную связь на русском: чего не хватает (конкретики, примеров применения на уроке) или что уже хорошо. Не переписывай отчёт целиком, только подскажи, как улучшить.";

export async function reviewReportDraft(reportText) {
  if (!reportText || reportText.trim().length < 3) return "Отчёт пока пустой — опишите, что нового вы узнали и как планируете это применить.";
  if (!hasApiKey()) return offlineReview(reportText);
  try {
    const { text } = await callGemini({ system: REVIEW_SYSTEM, messages: [{ role: "user", content: reportText }], maxTokens: 300 });
    return text.trim() || offlineReview(reportText);
  } catch (e) {
    console.error("[reviewReportDraft] failed:", e.message || e);
    return offlineReview(reportText);
  }
}

function offlineReview(text) {
  const t = text.toLowerCase();
  const tips = [];
  if (text.trim().length < 80) tips.push("отчёт короткий — добавьте конкретный пример, что именно вы узнали");
  if (!/(урок|класс|учени|практик|примен)/.test(t)) tips.push("не хватает связи с практикой — как вы это примените на уроке или в работе с классом");
  if (!tips.length) return "Отчёт выглядит содержательным — конкретика и связь с практикой на месте.";
  return "Чтобы отчёт был полезнее: " + tips.join("; ") + ".";
}

/* ===================== Идея 3: методические рекомендации Минпросвещения по слабой компетенции ===================== */
const TIPS_SYSTEM = `Ты — методист. У тебя есть инструмент поиска Google. Найди актуальные методические рекомендации Министерства просвещения РФ (edsoo.ru, edu.gov.ru, региональные ИРО) по указанной компетенции и предмету. Сформулируй 3-4 практических совета для молодого педагога на русском, кратко (маркированный список без markdown-разметки, просто с новой строки), со ссылкой на суть рекомендации, без выдумывания источников.`;

export async function getOrGenerateMethodicalTips(competencyId, subject) {
  const subj = subject || "";
  const { rows } = await query("SELECT * FROM methodical_tips WHERE competency_id = $1 AND subject = $2", [competencyId, subj]);
  if (rows[0] && Date.now() - new Date(rows[0].generated_at).getTime() < 30 * 24 * 3600 * 1000) {
    return { text: rows[0].text, sources: rows[0].sources || [], mode: rows[0].mode };
  }

  if (!hasApiKey()) return saveTips(competencyId, subj, offlineTip(competencyId), [], "offline");

  try {
    const prompt = `Компетенция: ${compLabel(competencyId)}. Предмет: ${subj || "не указан"}.`;
    const { text, sources } = await callGemini({ system: TIPS_SYSTEM, messages: [{ role: "user", content: prompt }], googleSearch: true, maxTokens: 700 });
    return saveTips(competencyId, subj, text.trim() || offlineTip(competencyId), sources.slice(0, 6), "live");
  } catch (e) {
    console.error("[getOrGenerateMethodicalTips] failed:", e.message || e);
    return saveTips(competencyId, subj, offlineTip(competencyId), [], "offline");
  }
}

async function saveTips(competencyId, subject, text, sources, mode) {
  await query(
    `INSERT INTO methodical_tips (competency_id, subject, text, sources, mode) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (competency_id, subject) DO UPDATE SET text = $3, sources = $4, mode = $5, generated_at = now()`,
    [competencyId, subject, text, JSON.stringify(sources), mode]
  );
  return { text, sources, mode };
}

function offlineTip(id) {
  const map = {
    subject: "Опирайтесь на примерные рабочие программы Минпросвещения по предмету (сайт edsoo.ru) — они регулярно обновляются и содержат готовые формулировки результатов обучения.",
    pedagogy: "Изучите методические рекомендации по формированию функциональной грамотности и работе с разными группами учеников — они содержат конкретные приёмы удержания внимания класса.",
    method: "Используйте конструктор рабочих программ на edsoo.ru — он соответствует актуальному ФГОС и экономит время на планировании.",
    digital: "Освойте библиотеку Московской электронной школы (МЭШ) — там собраны готовые уроки и сценарии, проверенные методистами.",
    communication: "Рекомендации по взаимодействию с родителями есть в методических материалах по формированию воспитательной работы школы — используйте готовые скрипты сложных разговоров.",
    personal: "Обратите внимание на всероссийские конкурсы профессионального мастерства (порталы Минпросвещения) — участие в них системно развивает личный бренд педагога.",
  };
  return map[id] || "Обратитесь к методическим материалам Министерства просвещения РФ на сайте edsoo.ru — там собраны актуальные рекомендации по большинству направлений.";
}

/* ===================== Идея 4: автосборка цифрового портфолио (этап 6 алгоритма) ===================== */
const PORTFOLIO_SYSTEM = "Ты — ИИ-наставник, который помогает молодому педагогу собрать текст цифрового портфолио для аттестации. На основе фактов о педагоге напиши связный текст от первого лица (4-6 предложений) на русском: кратко о профессиональном пути, сильных сторонах и конкретных достижениях (пройденные мероприятия, прогресс по компетенциям). Без воды и без markdown-разметки.";

export async function getOrGeneratePortfolio(user, force) {
  if (!force) {
    const { rows } = await query("SELECT * FROM portfolios WHERE user_id = $1", [user.id]);
    if (rows[0]) return rows[0].text;
  }
  const facts = await gatherPortfolioFacts(user);
  const text = hasApiKey() ? await buildPortfolioWithAi(user, facts) : offlinePortfolio(user, facts);
  await query(
    `INSERT INTO portfolios (user_id, text) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET text = $2, generated_at = now()`,
    [user.id, text]
  );
  return text;
}

async function gatherPortfolioFacts(user) {
  const { rows: completed } = await query(
    `SELECT e.title, ec.reflection FROM event_completions ec JOIN events e ON e.id = ec.event_id WHERE ec.user_id = $1`,
    [user.id]
  );
  const { rows: reported } = await query("SELECT event_title, report_text, usefulness_rating, mentor_rating FROM roadmap_progress WHERE user_id = $1 AND status <> 'open'", [user.id]);
  const { rows: quiz } = await query("SELECT AVG(score::float / NULLIF(total,0)) AS avg_ratio, COUNT(*)::int AS n FROM quiz_attempts WHERE user_id = $1", [user.id]);
  return { completed, reported, quizAvg: quiz[0]?.avg_ratio, quizCount: quiz[0]?.n || 0 };
}

async function buildPortfolioWithAi(user, facts) {
  try {
    const prompt = `Педагог: ${user.fullName}, предмет ${user.subject}, стаж ${user.yearsExperience} лет, регион ${user.region}. Баллы по компетенциям: ${Object.entries(user.scores || {}).map(([k, v]) => k + ":" + v).join(" ")}. Пройдено мероприятий: ${facts.completed.length}. Отчётов сдано: ${facts.reported.length}. ${facts.quizCount ? `Средний результат тестов после мероприятий: ${Math.round((facts.quizAvg || 0) * 100)}%.` : ""}`;
    const { text } = await callGemini({ system: PORTFOLIO_SYSTEM, messages: [{ role: "user", content: prompt }], maxTokens: 500 });
    return text.trim() || offlinePortfolio(user, facts);
  } catch (e) {
    console.error("[buildPortfolioWithAi] failed:", e.message || e);
    return offlinePortfolio(user, facts);
  }
}

function offlinePortfolio(user, facts) {
  let out = `${user.fullName} — ${user.subject || "педагог"}, стаж ${user.yearsExperience || 0} лет, регион: ${user.region || "не указан"}. `;
  const has = user.scores && Object.values(user.scores).some((v) => v > 0);
  if (has) {
    const strong = COMPETENCIES.map((c) => ({ c, s: user.scores[c.id] || 0 })).sort((a, b) => b.s - a.s)[0];
    out += `Сильная сторона по результатам диагностики — ${strong.c.label.toLowerCase()}. `;
  }
  out += `За время работы с платформой пройдено мероприятий: ${facts.completed.length}, сдано отчётов наставнику: ${facts.reported.length}. `;
  if (facts.quizCount) out += `Средний результат проверочных тестов после мероприятий — ${Math.round((facts.quizAvg || 0) * 100)}%.`;
  return out;
}

/* ===================== Идея 5: умное напоминание о неактивности ===================== */
export async function getInactivityNudge(userId) {
  const { rows } = await query(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(created_at) FROM ai_chats WHERE user_id = $1), 'epoch'::timestamptz),
       COALESCE((SELECT MAX(updated_at) FROM roadmap_progress WHERE user_id = $1), 'epoch'::timestamptz),
       COALESCE((SELECT MAX(completed_at) FROM event_completions WHERE user_id = $1), 'epoch'::timestamptz)
     ) AS last_activity`,
    [userId]
  );
  const last = rows[0]?.last_activity;
  if (!last || last.getTime() === new Date(0).getTime()) return { daysInactive: null, suggestion: null };
  const days = Math.floor((Date.now() - new Date(last).getTime()) / (24 * 3600 * 1000));
  if (days < 5) return { daysInactive: days, suggestion: null };
  return {
    daysInactive: days,
    suggestion: days > 14
      ? "Вы давно не заходили — начните с малого: откройте «Дорожную карту» и возьмите в работу одно мероприятие."
      : "Не заходили несколько дней — загляните в чат с ИИ-наставником, он поможет спланировать следующий шаг.",
  };
}
