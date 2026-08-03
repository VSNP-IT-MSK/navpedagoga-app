import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

function mapTest(row, questions) {
  return { id: row.id, title: row.title, description: row.description, createdAt: row.created_at?.getTime?.() ?? row.created_at, questions };
}
function mapQuestion(q, includeAnswer) {
  const base = { id: q.id, q: q.q, options: q.options, points: q.points };
  return includeAnswer ? { ...base, correctIndex: q.correct_index } : base;
}

// Конструктор теста: наставник передаёт title/description + массив вопросов целиком (создать/пересобрать разом).
router.post("/", requireAuth, requireRole("mentor"), async (req, res) => {
  const { title, description, questions } = req.body || {};
  if (!title || !Array.isArray(questions) || !questions.length) return res.status(400).json({ error: "Укажите название и минимум один вопрос" });
  for (const q of questions) {
    if (!q.q || !Array.isArray(q.options) || q.options.length < 2 || typeof q.correctIndex !== "number") {
      return res.status(400).json({ error: "Каждый вопрос должен иметь текст, минимум 2 варианта и указанный верный ответ" });
    }
  }
  const { rows } = await query("INSERT INTO custom_tests (mentor_id, title, description) VALUES ($1,$2,$3) RETURNING *", [req.user.id, title, description || ""]);
  const test = rows[0];
  const saved = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const { rows: qr } = await query(
      "INSERT INTO custom_test_questions (test_id, q, options, correct_index, points, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [test.id, q.q, JSON.stringify(q.options), q.correctIndex, q.points || 1, i]
    );
    saved.push(qr[0]);
  }
  res.json({ test: mapTest(test, saved.map((q) => mapQuestion(q, true))) });
});

router.get("/", requireAuth, requireRole("mentor"), async (req, res) => {
  const { rows } = await query("SELECT * FROM custom_tests WHERE mentor_id = $1 ORDER BY created_at DESC", [req.user.id]);
  res.json({ tests: rows.map((t) => mapTest(t)) });
});

router.get("/:id", requireAuth, requireRole("mentor"), async (req, res) => {
  const { rows } = await query("SELECT * FROM custom_tests WHERE id = $1 AND mentor_id = $2", [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: "Не найдено" });
  const { rows: qs } = await query("SELECT * FROM custom_test_questions WHERE test_id = $1 ORDER BY sort_order", [req.params.id]);
  res.json({ test: mapTest(rows[0], qs.map((q) => mapQuestion(q, true))) });
});

// Полная пересборка вопросов теста (проще, чем частичный PATCH для конструктора).
router.put("/:id", requireAuth, requireRole("mentor"), async (req, res) => {
  const { title, description, questions } = req.body || {};
  const owner = await query("SELECT id FROM custom_tests WHERE id = $1 AND mentor_id = $2", [req.params.id, req.user.id]);
  if (!owner.rows[0]) return res.status(404).json({ error: "Не найдено" });
  await query("UPDATE custom_tests SET title = COALESCE($1,title), description = COALESCE($2,description) WHERE id = $3", [title, description, req.params.id]);
  if (Array.isArray(questions)) {
    await query("DELETE FROM custom_test_questions WHERE test_id = $1", [req.params.id]);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await query(
        "INSERT INTO custom_test_questions (test_id, q, options, correct_index, points, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
        [req.params.id, q.q, JSON.stringify(q.options), q.correctIndex, q.points || 1, i]
      );
    }
  }
  const { rows: t } = await query("SELECT * FROM custom_tests WHERE id = $1", [req.params.id]);
  const { rows: qs } = await query("SELECT * FROM custom_test_questions WHERE test_id = $1 ORDER BY sort_order", [req.params.id]);
  res.json({ test: mapTest(t[0], qs.map((q) => mapQuestion(q, true))) });
});

router.delete("/:id", requireAuth, requireRole("mentor"), async (req, res) => {
  await query("DELETE FROM custom_tests WHERE id = $1 AND mentor_id = $2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

export default router;
