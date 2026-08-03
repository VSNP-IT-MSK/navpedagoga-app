import { Router } from "express";
import rateLimit from "express-rate-limit";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { startDiagnostic, handleDiagnosticReply, isDiagnosticActive, assistantReply, QUICK_ACTIONS, quickActionText } from "../services/mentor.js";
import { generateRoadmap, getStoredRoadmap, addProgressItem, listProgress, reportProgress, mentorRateProgress } from "../services/roadmap.js";
import { hasApiKey } from "../services/gemini.js";
import { getOrGenerateDigest, reviewReportDraft, getOrGenerateMethodicalTips, getOrGeneratePortfolio, getInactivityNudge } from "../services/aiFeatures.js";
import { awardCoins, REWARDS } from "../services/gamification.js";

const router = Router();

// A diagnostic conversation alone makes a dozen+ small requests, so keep this generous.
// Only the web-search-backed roadmap generation gets a tight limit below.
const aiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
router.use(aiLimiter);

const roadmapLimiter = rateLimit({ windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false, message: { error: "Слишком много запросов на построение карты — подождите минуту." } });

async function saveChatRow(userId, msg) {
  await query("INSERT INTO ai_chats (user_id, role, text, chips, action) VALUES ($1,$2,$3,$4,$5)", [
    userId, msg.role, msg.text, msg.chips ? JSON.stringify(msg.chips) : null, msg.action || null,
  ]);
}
function mapChatRow(r) {
  return { role: r.role, text: r.text, chips: r.chips || undefined, action: r.action || undefined };
}

router.get("/status", requireAuth, (req, res) => {
  res.json({ liveMode: hasApiKey(), quickActions: QUICK_ACTIONS });
});

router.get("/chat", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM ai_chats WHERE user_id = $1 ORDER BY id ASC", [req.user.id]);
  res.json({ messages: rows.map(mapChatRow), diagnosticActive: await isDiagnosticActive(req.user.id) });
});

router.post("/diagnostic/start", requireAuth, async (req, res) => {
  const msgs = await startDiagnostic(req.user);
  for (const m of msgs) await saveChatRow(req.user.id, m);
  res.json({ messages: msgs });
});

router.post("/diagnostic/reply", requireAuth, async (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Пустой ответ" });
  await saveChatRow(req.user.id, { role: "user", text });
  const newMsgs = await handleDiagnosticReply(req.user, text);
  for (const m of newMsgs) await saveChatRow(req.user.id, m);
  res.json({ messages: newMsgs, diagnosticActive: await isDiagnosticActive(req.user.id) });
});

router.post("/chat", requireAuth, async (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Пустое сообщение" });
  await saveChatRow(req.user.id, { role: "user", text });
  const { rows } = await query("SELECT role, text FROM ai_chats WHERE user_id = $1 ORDER BY id ASC", [req.user.id]);
  const replyText = await assistantReply(req.user, text, rows);
  const aiMsg = { role: "ai", text: replyText };
  await saveChatRow(req.user.id, aiMsg);
  res.json({ messages: [aiMsg] });
});

router.get("/quick-actions", requireAuth, (req, res) => {
  res.json({ actions: QUICK_ACTIONS.map((a) => ({ ...a, prompt: quickActionText(a.id, req.user) })) });
});

// The star feature: web-search-powered, region-aware roadmap.
router.post("/roadmap/generate", requireAuth, roadmapLimiter, async (req, res) => {
  const region = (req.body?.region || req.user.region || "").trim();
  if (!region) return res.status(400).json({ error: "Укажите регион в профиле или в запросе" });
  if (region !== req.user.region) { await query("UPDATE users SET region = $1 WHERE id = $2", [region, req.user.id]); req.user.region = region; }
  try {
    const rm = await generateRoadmap(req.user);
    res.json({ roadmap: rm });
  } catch (e) {
    if (e.code === "NO_SCORES") return res.status(400).json({ error: "Сначала пройдите диагностику с ИИ-наставником" });
    res.status(500).json({ error: "Не удалось построить карту: " + e.message });
  }
});

router.get("/roadmap", requireAuth, async (req, res) => {
  res.json({ roadmap: await getStoredRoadmap(req.user.id) });
});

// ---------------- прогресс по мероприятиям: отчёт наставляемого + оценка наставника ----------------
// Наставляемый добавляет мероприятие дорожной карты в работу.
router.post("/roadmap/progress", requireAuth, async (req, res) => {
  const { competencyId, eventTitle, eventUrl, weight } = req.body || {};
  if (!competencyId || !eventTitle) return res.status(400).json({ error: "Укажите компетенцию и название мероприятия" });
  const item = await addProgressItem(req.user.id, { competencyId, eventTitle, eventUrl, weight });
  res.json({ progress: item });
});

router.get("/roadmap/progress", requireAuth, async (req, res) => {
  res.json({ progress: await listProgress(req.user.id) });
});

// Наставляемый заполняет отчёт и оценивает мероприятие по шкале «Полезность» 1-5 (гл. 3.2 диссертации).
router.post("/roadmap/progress/:id/report", requireAuth, async (req, res) => {
  const { reportText, usefulnessRating } = req.body || {};
  if (!reportText) return res.status(400).json({ error: "Опишите, что узнали и как будете применять" });
  const rating = Math.max(1, Math.min(5, parseInt(usefulnessRating, 10) || 3));
  const item = await reportProgress(req.params.id, req.user.id, reportText, rating);
  if (!item) return res.status(404).json({ error: "Не найдено" });
  await awardCoins(req.user.id, REWARDS.ROADMAP_PROGRESS_REPORTED, "Отчёт по мероприятию сдан");
  res.json({ progress: item });
});

// Наставник оценивает отчёт наставляемого — здесь и происходит "ручная корректировка" со стороны человека.
router.post("/roadmap/progress/:id/mentor-rate", requireAuth, requireRole("mentor"), async (req, res) => {
  const rating = Math.max(1, Math.min(5, parseInt(req.body?.mentorRating, 10) || 3));
  const item = await mentorRateProgress(req.params.id, req.user.id, rating);
  if (!item) return res.status(404).json({ error: "Не найдено или не ваш наставляемый" });
  if (rating >= 4) await awardCoins(item.user_id, REWARDS.ROADMAP_PROGRESS_RATED_BONUS, "Наставник высоко оценил отчёт");
  res.json({ progress: item });
});

// Наставнику — список отчётов своих наставляемых, ожидающих оценки.
router.get("/roadmap/progress/mentees", requireAuth, requireRole("mentor"), async (req, res) => {
  const { rows } = await query(
    `SELECT rp.*, u.full_name AS mentee_name FROM roadmap_progress rp
     JOIN users u ON u.id = rp.user_id
     WHERE u.mentor_id = $1 AND u.mentor_status = 'confirmed' AND rp.status = 'reported'
     ORDER BY rp.updated_at DESC`,
    [req.user.id]
  );
  res.json({ progress: rows });
});

export default router;

// ==================== 5 новых ИИ-функций ====================

// 1) Ежедневный дайджест "что дальше" на дашборде (кэш 24ч).
router.get("/digest", requireAuth, async (req, res) => {
  const text = await getOrGenerateDigest(req.user, req.query.force === "1");
  res.json({ text });
});

// 2) ИИ-ревью черновика отчёта до отправки наставнику.
router.post("/roadmap/progress/review", requireAuth, async (req, res) => {
  const feedback = await reviewReportDraft(req.body?.text || "");
  res.json({ feedback });
});

// 3) Методические рекомендации Минпросвещения по конкретной компетенции.
router.get("/tips/:competencyId", requireAuth, async (req, res) => {
  const tips = await getOrGenerateMethodicalTips(req.params.competencyId, req.user.subject);
  res.json(tips);
});

// 4) Автосборка цифрового портфолио (этап 6 алгоритма).
router.get("/portfolio", requireAuth, async (req, res) => {
  const text = await getOrGeneratePortfolio(req.user, req.query.force === "1");
  res.json({ text });
});

// 5) Умное напоминание о неактивности.
router.get("/nudge", requireAuth, async (req, res) => {
  res.json(await getInactivityNudge(req.user.id));
});
