import crypto from "node:crypto";
import { COMPETENCIES, query } from "../db.js";
import { callGemini, extractJsonBlock, hasApiKey } from "./gemini.js";
import { cacheInvalidate } from "../cache.js";

function weakestFirst(scores) {
  return COMPETENCIES.map((c) => ({ comp: c, score: scores[c.id] || 3 })).sort((a, b) => a.score - b.score);
}

function eventHash(title, region, date) {
  const norm = [title, region, date].map((s) => (s || "").trim().toLowerCase()).join("|");
  return crypto.createHash("sha256").update(norm).digest("hex");
}

/**
 * Хеширование как механизм дедупликации, а не защиты данных: сохраняет мероприятия,
 * найденные ИИ через живой поиск, в общий каталог (events), чтобы он и правда становился
 * "постоянно обновляющимся списком" по региону и компетенции. sha256(название|регион|дата)
 * даёт стабильный ключ — при повторном поиске (ручном или по cron-расписанию) тот же вебинар
 * не дублируется в таблице (ON CONFLICT (content_hash) DO NOTHING), а просто пропускается.
 */
async function ingestDiscoveredEvents(priorities, region) {
  for (const p of priorities || []) {
    for (const ev of p.events || []) {
      if (!ev.title) continue;
      const hash = eventHash(ev.title, region, ev.date);
      await query(
        `INSERT INTO events (title, description, event_date, type, area, region, url, source, weight, content_hash, discovered_by_ai)
         VALUES ($1,$2,$3,'online',$4,$5,$6,$7,2,$8,true)
         ON CONFLICT (content_hash) DO NOTHING`,
        [ev.title, ev.description || "", ev.date || "", p.competency, region, ev.url || "", ev.source || "Найдено ИИ", hash]
      );
    }
  }
}

async function offlineRoadmap(user, note) {
  const ranked = weakestFirst(user.scores || {});
  const priorities = [];
  for (const { comp, score } of ranked.slice(0, 6)) {
    const { rows } = await query(
      "SELECT title, event_date AS date, url, source, description FROM events WHERE area = $1 AND (region = 'Все регионы' OR region = $2) ORDER BY created_at DESC LIMIT 2",
      [comp.id, user.region || ""]
    );
    priorities.push({ competency: comp.id, score, events: rows });
  }
  return {
    region: user.region || "не указан",
    summary: note || "Офлайн-режим: показаны мероприятия из общего каталога платформы. Чтобы включить поиск реальных мероприятий по региону, администратору нужно указать ключ Gemini API на сервере.",
    priorities,
    mode: "offline",
    generatedAt: Date.now(),
  };
}

const ROADMAP_SYSTEM = `Ты — ИИ-наставник образовательной платформы «НавигаторПедагога» (методология Поляковой Г.Д., МГУ 2022–2023) для молодых педагогов России.

У тебя есть инструмент поиска через Google. Твоя задача — найти РЕАЛЬНЫЕ, актуальные мероприятия для молодых педагогов (вебинары, курсы повышения квалификации, конкурсы, форумы, школы молодого педагога) в указанном регионе России.

Приоритетные источники (сформируй несколько разных поисковых запросов, комбинируя регион с этими источниками, не ограничивайся одним общим запросом):
- Общероссийский профсоюз образования и его региональные отделения (сайт eseur.ru и региональные организации профсоюза, например «профсоюз образования <регион>»)
- Региональные министерства/департаменты образования
- Региональные институты развития образования / ИПК / ИРО
- Конкурс «Учитель года» и «Педагогический дебют», региональные этапы
- Школа молодого педагога / молодого специалиста в конкретном регионе

Тебе передан профиль педагога и его баллы по 6 компетенциям (1-5, где ≤2 — выраженный дефицит, приоритет для развития). Для каждой компетенции с дефицитом подбери 1-3 реально найденных мероприятия.

ВАЖНО: используй только то, что реально нашёл через поиск. Не придумывай названия, даты или ссылки. Если по какой-то компетенции в регионе ничего релевантного не нашлось — честно оставь для неё пустой список "events", не выдумывай.

В конце ответа выведи ИСКЛЮЧИТЕЛЬНО валидный JSON в блоке \`\`\`json ... \`\`\` по схеме:
{
  "region": "название региона",
  "summary": "2-3 предложения на русском о том, что удалось найти",
  "priorities": [
    {
      "competency": "id компетенции (subject|pedagogy|method|digital|communication|personal)",
      "score": число,
      "events": [
        { "title": "...", "date": "если известна, иначе пусто", "url": "полная ссылка", "source": "название сайта/организации", "description": "1 предложение" }
      ]
    }
  ]
}
Перед JSON можешь кратко написать 2-4 предложения по-русски о ходе поиска, но JSON-блок обязателен и должен идти последним.`;

async function saveRoadmap(userId, rm) {
  await query(
    `INSERT INTO roadmaps (user_id, region, summary, priorities, mode, raw_text, generated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (user_id) DO UPDATE SET region = $2, summary = $3, priorities = $4, mode = $5, raw_text = $6, generated_at = now()`,
    [userId, rm.region, rm.summary, JSON.stringify(rm.priorities), rm.mode, rm.rawText || null]
  );
  return rm;
}

export async function generateRoadmap(user) {
  if (!user.scores || !Object.values(user.scores).some((v) => v > 0)) {
    const err = new Error("NO_SCORES");
    err.code = "NO_SCORES";
    throw err;
  }

  if (!hasApiKey()) {
    return saveRoadmap(user.id, await offlineRoadmap(user));
  }

  const region = user.region || "";
  if (!region) {
    return saveRoadmap(user.id, await offlineRoadmap(user, "Регион не указан — укажите его в профиле, чтобы включить поиск реальных мероприятий."));
  }

  const ranked = weakestFirst(user.scores);
  const profileLine =
    `Педагог: ${user.fullName}. Предмет: ${user.subject}. Стаж: ${user.yearsExperience} лет. Регион: ${region}.\n` +
    `Баллы по компетенциям (1-5): ` +
    ranked.map((r) => `${r.comp.label} (${r.comp.id}) = ${r.score}`).join(", ") +
    `.\nНайди реальные мероприятия для региона "${region}" под указанные дефициты и построй дорожную карту по инструкции.`;

  try {
    const { text, sources } = await callGemini({
      system: ROADMAP_SYSTEM,
      messages: [{ role: "user", content: profileLine }],
      googleSearch: true,
      maxTokens: 2200,
    });

    let parsed = extractJsonBlock(text);

    if (!parsed) {
      const rm = await offlineRoadmap(user, "Не удалось получить структурированный ответ от ИИ — показаны мероприятия из общего каталога. Попробуйте обновить карту ещё раз.");
      rm.rawText = text.slice(0, 4000);
      return saveRoadmap(user.id, rm);
    }

    parsed.mode = "live";
    parsed.generatedAt = Date.now();
    parsed.sources = sources.slice(0, 15);
    parsed.rawText = text.slice(0, 4000);
    await ingestDiscoveredEvents(parsed.priorities, region);
    cacheInvalidate("events:catalog:"); // каталог пополнился — сбрасываем кэш, чтобы список сразу увидели остальные пользователи
    return saveRoadmap(user.id, parsed);
  } catch (e) {
    console.error("[generateRoadmap] failed:", e.message || e);
    const rm = await offlineRoadmap(user, `Не удалось связаться с Gemini API (${e.code || e.message}). Показаны мероприятия из общего каталога.`);
    return saveRoadmap(user.id, rm);
  }
}

export async function getStoredRoadmap(userId) {
  const { rows } = await query("SELECT * FROM roadmaps WHERE user_id = $1", [userId]);
  if (!rows[0]) return null;
  const r = rows[0];
  const generatedAt = r.generated_at?.getTime?.() ?? new Date(r.generated_at).getTime();
  const stale = Date.now() - generatedAt > STALE_MS;
  return { region: r.region, summary: r.summary, priorities: r.priorities, mode: r.mode, rawText: r.raw_text, generatedAt, stale };
}

const STALE_MS = 4 * 24 * 3600 * 1000; // карта считается устаревшей через 4 дня — повод обновить поиск по региону

/** Обновляет карты всех активных педагогов, чьи карты устарели — вызывается по расписанию (см. routes/cron.js). */
export async function refreshStaleRoadmaps(limit = 15) {
  const { rows } = await query(
    `SELECT u.* FROM users u
     LEFT JOIN roadmaps r ON r.user_id = u.id
     WHERE u.role = 'user' AND u.scores::text <> '{"subject":0,"pedagogy":0,"method":0,"digital":0,"communication":0,"personal":0}'
       AND (r.generated_at IS NULL OR r.generated_at < now() - interval '4 days')
     ORDER BY r.generated_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const row of rows) {
    const user = { id: row.id, fullName: row.full_name, subject: row.subject, region: row.region, yearsExperience: row.years_experience, scores: row.scores, currentStage: row.current_stage };
    try {
      const rm = await generateRoadmap(user);
      results.push({ userId: user.id, ok: true, mode: rm.mode });
    } catch (e) {
      results.push({ userId: user.id, ok: false, error: e.message });
    }
  }
  return results;
}

// ---------------- roadmap_progress: репорт/оценка мероприятий (гл. 3.3, п.8-9 диссертации) ----------------
// Молодой педагог добавляет мероприятие в работу, по завершении пишет отчёт и оценивает
// полезность (1-5); человек-наставник видит отчёт и ставит свою оценку — это и есть та
// самая "корректировка пути", которую по методологии выполняет наставник, а не ИИ.
export async function addProgressItem(userId, { competencyId, eventTitle, eventUrl, weight }) {
  const { rows } = await query(
    `INSERT INTO roadmap_progress (user_id, competency_id, event_title, event_url, weight) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, competencyId, eventTitle, eventUrl || "", weight || 1]
  );
  return rows[0];
}

export async function listProgress(userId) {
  const { rows } = await query("SELECT * FROM roadmap_progress WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return rows;
}

export async function reportProgress(id, userId, reportText, usefulnessRating) {
  const { rows } = await query(
    `UPDATE roadmap_progress SET status = 'reported', report_text = $1, usefulness_rating = $2, updated_at = now()
     WHERE id = $3 AND user_id = $4 RETURNING *`,
    [reportText, usefulnessRating, id, userId]
  );
  return rows[0] || null;
}

export async function mentorRateProgress(id, mentorId, mentorRating) {
  const { rows } = await query(
    `UPDATE roadmap_progress SET status = 'rated', mentor_rating = $1, updated_at = now()
     WHERE id = $2 AND user_id IN (SELECT id FROM users WHERE mentor_id = $3 AND mentor_status = 'confirmed') RETURNING *`,
    [mentorRating, id, mentorId]
  );
  return rows[0] || null;
}
