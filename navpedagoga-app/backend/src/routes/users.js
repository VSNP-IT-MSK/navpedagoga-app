import { Router } from "express";
import { query, mapUser } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { cacheInvalidate } from "../cache.js";

const router = Router();

router.put("/me", requireAuth, async (req, res) => {
  const { fullName, subject, school, region, yearsExperience } = req.body || {};
  const fields = [];
  const values = [];
  let i = 1;
  if (fullName) { fields.push(`full_name = $${i++}`); values.push(fullName); }
  if (subject !== undefined) { fields.push(`subject = $${i++}`); values.push(subject); }
  if (school !== undefined) { fields.push(`school = $${i++}`); values.push(school); }
  if (region !== undefined) { fields.push(`region = $${i++}`); values.push(region); }
  if (yearsExperience !== undefined) { fields.push(`years_experience = $${i++}`); values.push(parseInt(yearsExperience, 10) || 0); }
  if (!fields.length) return res.json({ user: req.user });
  values.push(req.user.id);
  const { rows } = await query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`, values);
  res.json({ user: mapUser(rows[0]) });
});

// list users by role — admins see everyone; mentors see their confirmed mentees;
// молодой педагог, выбирающий наставника, может запросить список подтверждённых наставников (role=mentor).
router.get("/", requireAuth, async (req, res) => {
  const { role } = req.query;
  if (req.user.role === "admin") {
    const { rows } = await query("SELECT * FROM users" + (role ? " WHERE role = $1" : "") + " ORDER BY created_at DESC", role ? [role] : []);
    return res.json({ users: rows.map(mapUser) });
  }
  if (req.user.role === "mentor") {
    const status = req.query.status === "pending" ? "pending" : "confirmed";
    const { rows } = await query("SELECT * FROM users WHERE mentor_id = $1 AND mentor_status = $2 ORDER BY created_at DESC", [req.user.id, status]);
    return res.json({ users: rows.map(mapUser) });
  }
  // req.user.role === 'user'
  if (role === "mentor") {
    const { rows } = await query("SELECT * FROM users WHERE role = 'mentor' AND approved_by_admin = true ORDER BY created_at DESC");
    return res.json({ users: rows.map(mapUser) });
  }
  return res.status(403).json({ error: "Недостаточно прав" });
});

router.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [req.params.id]);
  const u = rows[0];
  if (!u) return res.status(404).json({ error: "Не найден" });
  const canView = req.user.role === "admin" || req.user.id === u.id || u.mentor_id === req.user.id || req.user.mentorId === u.id;
  if (!canView) return res.status(403).json({ error: "Недостаточно прав" });
  res.json({ user: mapUser(u) });
});

// Прямое назначение наставника администратором (в обход запроса/подтверждения).
router.put("/:id/mentor", requireAuth, requireRole("admin"), async (req, res) => {
  const mentorId = req.body?.mentorId || null;
  const { rows } = await query(
    "UPDATE users SET mentor_id = $1, mentor_status = $2, current_stage = GREATEST(current_stage, 2) WHERE id = $3 RETURNING *",
    [mentorId, mentorId ? "confirmed" : null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Не найден" });
  res.json({ user: mapUser(rows[0]) });
});

// Создание пары «наставник-наставляемый» по алгоритму из диссертации (гл. 3.3, п.3-4):
// молодой педагог отправляет запрос -> наставник подтверждает или отклоняет.
router.post("/mentors/:mentorId/request", requireAuth, requireRole("user"), async (req, res) => {
  const mentor = await query("SELECT id FROM users WHERE id = $1 AND role = 'mentor' AND approved_by_admin = true", [req.params.mentorId]);
  if (!mentor.rows[0]) return res.status(404).json({ error: "Наставник не найден" });
  const { rows } = await query(
    "UPDATE users SET mentor_id = $1, mentor_status = 'pending' WHERE id = $2 RETURNING *",
    [req.params.mentorId, req.user.id]
  );
  res.json({ user: mapUser(rows[0]) });
});

router.post("/mentees/:menteeId/confirm", requireAuth, requireRole("mentor"), async (req, res) => {
  const { rows } = await query(
    "UPDATE users SET mentor_status = 'confirmed', current_stage = GREATEST(current_stage, 2) WHERE id = $1 AND mentor_id = $2 AND mentor_status = 'pending' RETURNING *",
    [req.params.menteeId, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Заявка не найдена" });
  res.json({ user: mapUser(rows[0]) });
});

router.post("/mentees/:menteeId/decline", requireAuth, requireRole("mentor"), async (req, res) => {
  const { rows } = await query(
    "UPDATE users SET mentor_id = NULL, mentor_status = NULL WHERE id = $1 AND mentor_id = $2 AND mentor_status = 'pending' RETURNING *",
    [req.params.menteeId, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Заявка не найдена" });
  res.json({ user: mapUser(rows[0]) });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  await query("DELETE FROM users WHERE id = $1", [req.params.id]);
  cacheInvalidate("events:"); // события этого пользователя как создателя каскадно уходят из кэша тоже
  res.json({ ok: true });
});

export default router;
