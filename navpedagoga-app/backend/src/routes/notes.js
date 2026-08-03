import { Router } from "express";
import { query, mapNote, NOTE_CATS } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM notes WHERE user_id = $1 ORDER BY updated_at DESC", [req.user.id]);
  res.json({ notes: rows.map(mapNote), categories: NOTE_CATS });
});

router.post("/", requireAuth, async (req, res) => {
  const { title, content, category } = req.body || {};
  if (!title) return res.status(400).json({ error: "Введите заголовок" });
  const { rows } = await query(
    "INSERT INTO notes (user_id, title, content, category) VALUES ($1,$2,$3,$4) RETURNING *",
    [req.user.id, title, content || "", category || "Личное"]
  );
  res.json({ note: mapNote(rows[0]) });
});

router.put("/:id", requireAuth, async (req, res) => {
  const { title, content, category } = req.body || {};
  const { rows } = await query(
    `UPDATE notes SET title = COALESCE($1,title), content = COALESCE($2,content), category = COALESCE($3,category), updated_at = now()
     WHERE id = $4 AND user_id = $5 RETURNING *`,
    [title, content, category, req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Не найдено" });
  res.json({ note: mapNote(rows[0]) });
});

router.delete("/:id", requireAuth, async (req, res) => {
  await query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

export default router;
