import { Router } from "express";
import bcrypt from "bcryptjs";
import { query, mapUser } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router = Router();
const AVATAR_COLORS = ["purple", "magenta", "yellow", "green"];

router.post("/register", async (req, res) => {
  const { fullName, email, password, subject, region, school, yearsExperience, role } = req.body || {};
  if (!fullName || !email || !password || password.length < 4) {
    return res.status(400).json({ error: "Заполните имя, email и пароль (мин. 4 символа)" });
  }
  const exists = await query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  if (exists.rows.length) return res.status(409).json({ error: "Пользователь с такой почтой уже существует" });

  const passwordHash = await bcrypt.hash(password, 10);
  const finalRole = role === "mentor" ? "mentor" : "user";
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const scores = { subject: 0, pedagogy: 0, method: 0, digital: 0, communication: 0, personal: 0 };

  // Регистрация требует подтверждения администратором образовательной организации (ТЗ п.4.3) —
  // до подтверждения пользователь всё же получает токен и видит свой профиль в статусе ожидания,
  // но роуты, требующие approvedByAdmin, должны сами эту проверку делать при необходимости.
  const { rows } = await query(
    `INSERT INTO users (full_name, email, password_hash, role, subject, school, region, years_experience, current_stage, approved_by_admin, scores, avatar_color)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,false,$9,$10) RETURNING *`,
    [fullName, email, passwordHash, finalRole, subject || "", school || "", region || "", parseInt(yearsExperience, 10) || 0, JSON.stringify(scores), avatarColor]
  );
  const user = rows[0];
  res.json({ token: signToken(user.id), user: mapUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email || ""]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Неверная почта или пароль" });
  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok) return res.status(401).json({ error: "Неверная почта или пароль" });
  res.json({ token: signToken(user.id), user: mapUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
