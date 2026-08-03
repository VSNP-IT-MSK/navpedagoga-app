import { Router } from "express";
import { query, mapMessage } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/:otherId", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM messages WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)
     ORDER BY created_at ASC`,
    [req.user.id, req.params.otherId]
  );
  res.json({ messages: rows.map(mapMessage) });
});

router.post("/:otherId", requireAuth, async (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Пустое сообщение" });
  const { rows } = await query(
    "INSERT INTO messages (from_user_id, to_user_id, text) VALUES ($1,$2,$3) RETURNING *",
    [req.user.id, req.params.otherId, text]
  );
  res.json({ message: mapMessage(rows[0]) });
});

export default router;
