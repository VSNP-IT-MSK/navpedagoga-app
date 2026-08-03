import { Router } from "express";
import { query, mapUser } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.post("/", requireAuth, requireRole("mentor"), async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: "Укажите название группы" });
  const { rows } = await query("INSERT INTO groups (mentor_id, name, description) VALUES ($1,$2,$3) RETURNING *", [req.user.id, name, description || ""]);
  res.json({ group: mapGroup(rows[0], 0) });
});

router.get("/", requireAuth, async (req, res) => {
  if (req.user.role === "mentor") {
    const { rows } = await query(
      `SELECT g.*, COUNT(gm.user_id)::int AS member_count FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id
       WHERE g.mentor_id = $1 GROUP BY g.id ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    return res.json({ groups: rows.map((r) => mapGroup(r, r.member_count)) });
  }
  const { rows } = await query(
    `SELECT g.*, u.full_name AS mentor_name FROM groups g
     JOIN group_members gm ON gm.group_id = g.id JOIN users u ON u.id = g.mentor_id
     WHERE gm.user_id = $1 ORDER BY g.created_at DESC`,
    [req.user.id]
  );
  res.json({ groups: rows.map((r) => ({ ...mapGroup(r), mentorName: r.mentor_name })) });
});

router.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM groups WHERE id = $1", [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: "Не найдено" });
  const isOwner = g.mentor_id === req.user.id;
  const { rows: members } = await query(
    `SELECT u.* FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1 ORDER BY u.full_name`,
    [req.params.id]
  );
  const isMember = members.some((m) => m.id === req.user.id);
  if (!isOwner && !isMember) return res.status(403).json({ error: "Недостаточно прав" });
  res.json({ group: mapGroup(g, members.length), members: members.map(mapUser) });
});

router.put("/:id", requireAuth, requireRole("mentor"), async (req, res) => {
  const { name, description } = req.body || {};
  const { rows } = await query(
    "UPDATE groups SET name = COALESCE($1,name), description = COALESCE($2,description) WHERE id = $3 AND mentor_id = $4 RETURNING *",
    [name, description, req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Не найдено" });
  res.json({ group: mapGroup(rows[0]) });
});

router.delete("/:id", requireAuth, requireRole("mentor"), async (req, res) => {
  await query("DELETE FROM groups WHERE id = $1 AND mentor_id = $2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.post("/:id/members", requireAuth, requireRole("mentor"), async (req, res) => {
  const { userId } = req.body || {};
  const group = await query("SELECT id FROM groups WHERE id = $1 AND mentor_id = $2", [req.params.id, req.user.id]);
  if (!group.rows[0]) return res.status(404).json({ error: "Группа не найдена" });
  const mentee = await query("SELECT id FROM users WHERE id = $1 AND mentor_id = $2 AND mentor_status = 'confirmed'", [userId, req.user.id]);
  if (!mentee.rows[0]) return res.status(400).json({ error: "Этот педагог не является вашим подтверждённым подопечным" });
  await query("INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.params.id, userId]);
  res.json({ ok: true });
});

router.delete("/:id/members/:userId", requireAuth, requireRole("mentor"), async (req, res) => {
  const group = await query("SELECT id FROM groups WHERE id = $1 AND mentor_id = $2", [req.params.id, req.user.id]);
  if (!group.rows[0]) return res.status(404).json({ error: "Группа не найдена" });
  await query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [req.params.id, req.params.userId]);
  res.json({ ok: true });
});

function mapGroup(row, memberCount) {
  return { id: row.id, mentorId: row.mentor_id, name: row.name, description: row.description, memberCount: memberCount ?? row.member_count ?? 0, createdAt: row.created_at?.getTime?.() ?? row.created_at };
}

export default router;
