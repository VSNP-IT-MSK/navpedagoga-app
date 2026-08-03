import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { awardCoins, REWARDS } from "../services/gamification.js";

const router = Router();

function mapAssignment(row) {
  return {
    id: row.id, mentorId: row.mentor_id, groupId: row.group_id, testId: row.test_id,
    title: row.title, description: row.description,
    dueDate: row.due_date?.getTime?.() ?? row.due_date,
    coinReward: row.coin_reward, createdAt: row.created_at?.getTime?.() ?? row.created_at,
  };
}
function mapTarget(row) {
  return {
    userId: row.user_id, status: row.status, answerText: row.answer_text, testAnswers: row.test_answers,
    score: row.score, total: row.total, mentorFeedback: row.mentor_feedback,
    submittedAt: row.submitted_at?.getTime?.() ?? row.submitted_at, gradedAt: row.graded_at?.getTime?.() ?? row.graded_at,
  };
}

// Наставник создаёт задание — на группу (groupId), на конкретных педагогов (userIds), или и то и другое сразу.
router.post("/", requireAuth, requireRole("mentor"), async (req, res) => {
  const { title, description, dueDate, coinReward, testId, groupId, userIds } = req.body || {};
  if (!title) return res.status(400).json({ error: "Укажите название задания" });
  if (testId) {
    const t = await query("SELECT id FROM custom_tests WHERE id = $1 AND mentor_id = $2", [testId, req.user.id]);
    if (!t.rows[0]) return res.status(400).json({ error: "Тест не найден" });
  }
  if (groupId) {
    const g = await query("SELECT id FROM groups WHERE id = $1 AND mentor_id = $2", [groupId, req.user.id]);
    if (!g.rows[0]) return res.status(400).json({ error: "Группа не найдена" });
  }

  const { rows } = await query(
    "INSERT INTO assignments (mentor_id, group_id, test_id, title, description, due_date, coin_reward) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [req.user.id, groupId || null, testId || null, title, description || "", dueDate || null, coinReward || 10]
  );
  const assignment = rows[0];

  const targetIds = new Set(Array.isArray(userIds) ? userIds : []);
  if (groupId) {
    const { rows: members } = await query("SELECT user_id FROM group_members WHERE group_id = $1", [groupId]);
    members.forEach((m) => targetIds.add(m.user_id));
  }
  for (const uid of targetIds) {
    // назначаем только своим подтверждённым подопечным — защищает от произвольного userId
    const ok = await query("SELECT id FROM users WHERE id = $1 AND mentor_id = $2 AND mentor_status = 'confirmed'", [uid, req.user.id]);
    if (ok.rows[0]) await query("INSERT INTO assignment_targets (assignment_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [assignment.id, uid]);
  }
  res.json({ assignment: mapAssignment(assignment), targetCount: targetIds.size });
});

// Наставник: свои задания. Педагог: назначенные ему.
router.get("/", requireAuth, async (req, res) => {
  if (req.user.role === "mentor") {
    const { rows } = await query(
      `SELECT a.*, COUNT(t.user_id)::int AS target_count, COUNT(t.user_id) FILTER (WHERE t.status <> 'assigned')::int AS submitted_count
       FROM assignments a LEFT JOIN assignment_targets t ON t.assignment_id = a.id
       WHERE a.mentor_id = $1 GROUP BY a.id ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    return res.json({ assignments: rows.map((r) => ({ ...mapAssignment(r), targetCount: r.target_count, submittedCount: r.submitted_count })) });
  }
  const { rows } = await query(
    `SELECT a.*, t.status, t.score, t.total FROM assignments a
     JOIN assignment_targets t ON t.assignment_id = a.id
     WHERE t.user_id = $1 ORDER BY a.created_at DESC`,
    [req.user.id]
  );
  res.json({ assignments: rows.map((r) => ({ ...mapAssignment(r), myStatus: r.status, myScore: r.score, myTotal: r.total })) });
});

router.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM assignments WHERE id = $1", [req.params.id]);
  const a = rows[0];
  if (!a) return res.status(404).json({ error: "Не найдено" });
  const isMentor = a.mentor_id === req.user.id;
  let questions = null;
  if (a.test_id) {
    const { rows: qs } = await query("SELECT * FROM custom_test_questions WHERE test_id = $1 ORDER BY sort_order", [a.test_id]);
    questions = qs.map((q) => (isMentor ? { id: q.id, q: q.q, options: q.options, correctIndex: q.correct_index, points: q.points } : { id: q.id, q: q.q, options: q.options, points: q.points }));
  }
  if (isMentor) {
    const { rows: targets } = await query(
      `SELECT t.*, u.full_name AS user_name FROM assignment_targets t JOIN users u ON u.id = t.user_id WHERE t.assignment_id = $1 ORDER BY u.full_name`,
      [req.params.id]
    );
    return res.json({ assignment: mapAssignment(a), questions, targets: targets.map((t) => ({ ...mapTarget(t), userName: t.user_name })) });
  }
  const mine = await query("SELECT * FROM assignment_targets WHERE assignment_id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  if (!mine.rows[0]) return res.status(403).json({ error: "Это задание вам не назначено" });
  res.json({ assignment: mapAssignment(a), questions, myTarget: mapTarget(mine.rows[0]) });
});

// Педагог сдаёт задание: либо текстовый ответ (свободное задание), либо ответы теста (авто-проверка + монеты сразу).
router.post("/:id/submit", requireAuth, async (req, res) => {
  const { answerText, testAnswers } = req.body || {};
  const a = await query("SELECT * FROM assignments WHERE id = $1", [req.params.id]);
  if (!a.rows[0]) return res.status(404).json({ error: "Не найдено" });
  const assignment = a.rows[0];

  if (assignment.test_id) {
    const { rows: qs } = await query("SELECT * FROM custom_test_questions WHERE test_id = $1 ORDER BY sort_order", [assignment.test_id]);
    let score = 0, total = 0;
    qs.forEach((q, i) => { total += q.points; if ((testAnswers || [])[i] === q.correct_index) score += q.points; });
    const { rows } = await query(
      `UPDATE assignment_targets SET status = 'graded', test_answers = $1, score = $2, total = $3, submitted_at = now(), graded_at = now()
       WHERE assignment_id = $4 AND user_id = $5 RETURNING *`,
      [JSON.stringify(testAnswers || []), score, total, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Задание вам не назначено" });
    const passRatio = total ? score / total : 0;
    await awardCoins(req.user.id, assignment.coin_reward, `Задание сдано: ${assignment.title}`);
    if (passRatio >= 0.8) await awardCoins(req.user.id, REWARDS.ASSIGNMENT_GRADED_BONUS, `Высокий результат теста: ${assignment.title}`);
    return res.json({ target: mapTarget(rows[0]) });
  }

  if (!answerText) return res.status(400).json({ error: "Введите ответ" });
  const { rows } = await query(
    `UPDATE assignment_targets SET status = 'submitted', answer_text = $1, submitted_at = now()
     WHERE assignment_id = $2 AND user_id = $3 RETURNING *`,
    [answerText, req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Задание вам не назначено" });
  await awardCoins(req.user.id, REWARDS.ASSIGNMENT_SUBMITTED, `Задание сдано: ${assignment.title}`);
  res.json({ target: mapTarget(rows[0]) });
});

// Наставник вручную оценивает свободное (текстовое) задание.
router.post("/:id/grade/:userId", requireAuth, requireRole("mentor"), async (req, res) => {
  const { score, total, feedback } = req.body || {};
  const owner = await query("SELECT * FROM assignments WHERE id = $1 AND mentor_id = $2", [req.params.id, req.user.id]);
  if (!owner.rows[0]) return res.status(404).json({ error: "Не найдено" });
  const { rows } = await query(
    `UPDATE assignment_targets SET status = 'graded', score = $1, total = $2, mentor_feedback = $3, graded_at = now()
     WHERE assignment_id = $4 AND user_id = $5 RETURNING *`,
    [score ?? null, total ?? null, feedback || "", req.params.id, req.params.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Не найдено" });
  const ratio = total ? (score || 0) / total : 0;
  if (ratio >= 0.8) await awardCoins(req.params.userId, REWARDS.ASSIGNMENT_GRADED_BONUS, `Наставник высоко оценил задание: ${owner.rows[0].title}`);
  res.json({ target: mapTarget(rows[0]) });
});

router.delete("/:id", requireAuth, requireRole("mentor"), async (req, res) => {
  await query("DELETE FROM assignments WHERE id = $1 AND mentor_id = $2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

export default router;
