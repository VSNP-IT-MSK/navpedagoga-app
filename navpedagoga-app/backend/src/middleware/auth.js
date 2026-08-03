import jwt from "jsonwebtoken";
import { query, mapUser } from "../db.js";

const SECRET = process.env.JWT_SECRET || "dev-insecure-secret-change-me";

export function signToken(userId) {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: "30d" });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Нет токена авторизации" });
  try {
    const payload = jwt.verify(token, SECRET);
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [payload.uid]);
    if (!rows[0]) return res.status(401).json({ error: "Пользователь не найден" });
    req.user = mapUser(rows[0]);
    req.dbUser = rows[0]; // сырая строка (с password_hash) — на случай если понадобится в защищённых роутах
    next();
  } catch (e) {
    return res.status(401).json({ error: "Недействительный токен" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Недостаточно прав" });
    next();
  };
}
