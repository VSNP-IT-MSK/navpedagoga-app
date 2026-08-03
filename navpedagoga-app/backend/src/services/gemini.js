/**
 * Тонкая обёртка над Gemini API (Google AI Studio / Gemini Developer API).
 * Ключ GEMINI_API_KEY читается только из переменных окружения сервера —
 * никогда не передаётся и не хранится на клиенте.
 *
 * Реализовано через официальный SDK @google/genai и его Interactions API
 * (v1beta/interactions) — это рекомендуемый Google путь взамен старого
 * generateContent (см. https://ai.google.dev/gemini-api/docs/get-started?hl=ru#javascript).
 * Самодельного веб-поиска не нужно (в отличие от DeepSeek-версии, тот код и
 * cheerio уже удалены) — используется официальный grounding-инструмент
 * Google Search: модель сама формирует поисковые запросы, ищет и возвращает
 * ответ вместе со списком реальных источников.
 *
 * ВАЖНО: это бесплатный тариф Gemini API — рейт-лимиты жёсткие, особенно на
 * grounding/поиск (см. roadmapLimiter в routes/ai.js). 429-ошибки от Gemini
 * здесь оборачиваются в понятный err.code, который mentor.js/roadmap.js уже
 * показывают пользователю как есть — так пользователь видит «превышена
 * бесплатная квота», а не общее «ошибка API».
 */
import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

let client = null;
function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function hasApiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Interactions API принимает `input` как простую строку (подтверждено в
 * типах SDK: InteractionsInput = string | Array<Step> | Array<Content> |
 * Array<Turn> | Content) — но не умеет напрямую принять историю в виде
 * готовых "prior turns" в том формате, в каком мы её храним (плоский список
 * в lowdb, db.data.aiChats). Реконструировать внутренний формат steps[]
 * предыдущего ответа было бы хрупко, поэтому вся история сериализуется одним
 * текстовым блоком с явной разметкой ролей — просто и надёжно для нашего
 * случая одноразовых, недлинных диалогов.
 */
function serializeMessagesToInput(messages) {
  return (messages || [])
    .map((m) => `${m.role === "assistant" ? "Ассистент" : "Пользователь"}: ${m.content}`)
    .join("\n\n");
}

/**
 * Собирает финальный текст и источники (URL grounding-цитат) из ответа
 * Interactions API.
 *
 * `interaction.output_text` — удобный геттер, добавляемый самим SDK
 * (см. genai.d.ts: "Note: this is added by the SDK") — уже конкатенированный
 * текст последнего model_output. Используем как основной путь, но на случай
 * пустого/отсутствующего значения дополнительно вручную собираем текст и
 * цитаты из steps[] — надёжнее, чем полагаться на один недокументированный
 * в официальных гайдах геттер.
 *
 * Источники лежат в content[].annotations[] с type === "url_citation" внутри
 * шагов с type === "model_output" (а не в groundingMetadata.groundingChunks,
 * как было в старом REST-формате generateContent). Поисковые запросы модели
 * — в шагах type === "google_search_call", arguments.queries.
 */
function extractFromInteraction(interaction) {
  const sourceSet = new Set();
  const searchQuerySet = new Set();
  const textParts = [];

  const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
  for (const step of steps) {
    if (step.type === "model_output") {
      for (const block of step.content || []) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
          for (const ann of block.annotations || []) {
            if (ann.type === "url_citation" && ann.url) sourceSet.add(ann.url);
          }
        }
      }
    } else if (step.type === "google_search_call") {
      for (const q of step.arguments?.queries || []) searchQuerySet.add(q);
    }
  }

  const text =
    typeof interaction.output_text === "string" && interaction.output_text.trim()
      ? interaction.output_text
      : textParts.join("\n");

  return { text, sources: [...sourceSet], searchQueries: [...searchQuerySet], raw: interaction };
}

function isQuotaError(err) {
  return err?.status === 429 || err?.name === "RateLimitError" || /RESOURCE_EXHAUSTED/i.test(String(err?.message || ""));
}

/**
 * @param {object} opts
 * @param {string} opts.system
 * @param {Array<{role:'user'|'assistant', content:string}>} opts.messages - OpenAI-style roles; converted internally
 * @param {boolean} [opts.googleSearch] - enable Google Search grounding tool
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{text:string, sources:string[]}>}
 */
export async function callGemini({ system, messages, googleSearch = false, maxTokens = 1800 }) {
  if (!hasApiKey()) {
    const err = new Error("NoApiKey");
    err.code = "NoApiKey";
    throw err;
  }

  const params = {
    model: MODEL,
    system_instruction: system,
    input: serializeMessagesToInput(messages),
    store: false, // историю ведём сами в lowdb, не просим Google хранить её на своей стороне
    generation_config: { max_output_tokens: maxTokens },
    // Примечание: у нового Interactions API generation_config (snake_case,
    // GenerationConfig_2 в типах SDK) пока НЕТ поля temperature — оно есть
    // только в старом camelCase GenerationConfig для generateContent.
    // Раньше здесь стояло temperature: 0.4 — при миграции пришлось убрать,
    // управлять "творческостью" ответа сейчас нечем, кроме промпта.
  };
  if (googleSearch) {
    params.tools = [{ type: "google_search" }];
  }

  try {
    const interaction = await getClient().interactions.create(params);
    return extractFromInteraction(interaction);
  } catch (e) {
    // Реальный текст ошибки — в лог сервера (Render → Logs). Это было
    // отдельно добавлено по запросу пользователя, который раньше не мог
    // понять причину "(офлайн-режим: API_ERROR)" — не терять эту диагностику.
    console.error("[gemini.js] Interactions API error:", e);

    const err = new Error(e?.message || "Gemini API error");
    err.status = e?.status;
    err.code = isQuotaError(e) ? "превышена бесплатная квота" : "APIError";
    throw err;
  }
}

/** Extracts the last ```json ... ``` fenced block from a text response. */
export function extractJsonBlock(text) {
  if (!text) return null;
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1][1];
  try {
    return JSON.parse(last);
  } catch (e) {
    return null;
  }
}
