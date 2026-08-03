import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { cached } from "../cache.js";

const router = Router();

// Структурированный тест — альтернатива/дополнение к разговорной диагностике с ИИ.
// Пункты и шкала 1-3 взяты из реального теста в приложении к диссертации Поляковой Г.Д.
// (см. backend/src/data/testBank.js). Список меняется редко — кэшируем на 5 минут.
router.get("/items", requireAuth, async (req, res) => {
  const items = await cached("diagnostic:items", 300_000, async () => {
    const { rows } = await query("SELECT id, competency_id, text, weight FROM diagnostic_items ORDER BY sort_order ASC");
    return rows;
  });
  res.json({ items, scale: [
    { v: 1, label: "Испытываю затруднения" },
    { v: 2, label: "Получается, но необходимо совершенствование" },
    { v: 3, label: "Получается хорошо" },
  ] });
});

router.get("/my-answers", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT item_id, score FROM diagnostic_answers WHERE user_id = $1", [req.user.id]);
  res.json({ answers: rows });
});

// Принимает { answers: [{ itemId, score }] }, сохраняет и пересчитывает баллы 1-5 по каждой
// компетенции (среднее по пунктам блока, переведённое из шкалы 1-3 в привычную 1-5) —
// чтобы результат совместимо ложился поверх уже существующей дорожной карты/ИИ-логики.
router.post("/submit", requireAuth, async (req, res) => {
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (!answers.length) return res.status(400).json({ error: "Нет ответов" });

  const { rows: items } = await query("SELECT id, competency_id, weight FROM diagnostic_items");
  const byId = new Map(items.map((i) => [i.id, i]));

  // Каждый upsert атомарен сам по себе (ON CONFLICT) — отдельная транзакция здесь не нужна:
  // частичная запись при обрыве соединения просто означает "часть ответов сохранится", без риска
  // рассинхронизации данных (в отличие от, например, перевода баллов между сущностями).
  for (const a of answers) {
    const item = byId.get(a.itemId);
    if (!item || ![1, 2, 3].includes(a.score)) continue;
    await query(
      `INSERT INTO diagnostic_answers (user_id, item_id, score) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, item_id) DO UPDATE SET score = $3, answered_at = now()`,
      [req.user.id, item.id, a.score]
    );
  }

  // пересчитываем итоговые баллы по компетенциям
  const { rows: scored } = await query(
    `SELECT di.competency_id, AVG(da.score)::float AS avg_score, COUNT(*)::int AS n
     FROM diagnostic_answers da JOIN diagnostic_items di ON di.id = da.item_id
     WHERE da.user_id = $1 GROUP BY di.competency_id`,
    [req.user.id]
  );
  const scores = { subject: 0, pedagogy: 0, method: 0, digital: 0, communication: 0, personal: 0 };
  for (const row of scored) {
    // 1-3 -> 1-5: линейное преобразование ((avg-1)/(3-1))*4+1
    scores[row.competency_id] = Math.round((((row.avg_score - 1) / 2) * 4 + 1) * 10) / 10;
  }
  await query("UPDATE users SET scores = $1, current_stage = GREATEST(current_stage, 2) WHERE id = $2", [JSON.stringify(scores), req.user.id]);

  res.json({ scores });
});

export default router;
