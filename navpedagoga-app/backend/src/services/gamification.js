import { query } from "../db.js";

/**
 * Единая точка начисления монет и очков опыта (XP) — виртуальное поощрение.
 * XP определяет уровень/прогресс-бар (100 XP = 1 уровень), монеты — отдельная "валюта"
 * (пока без магазина трат — это база для будущего расширения, см. README).
 */
export async function awardCoins(userId, amount, reason) {
  if (!amount) return null;
  const { rows } = await query(
    "UPDATE users SET coins = coins + $1, xp = xp + $1 WHERE id = $2 RETURNING coins, xp",
    [amount, userId]
  );
  await query("INSERT INTO coin_transactions (user_id, amount, reason) VALUES ($1,$2,$3)", [userId, amount, reason]);
  return rows[0] || null;
}

export function levelFromXp(xp) {
  const level = Math.floor((xp || 0) / 100) + 1;
  const inLevel = (xp || 0) % 100;
  return { level, inLevel, toNext: 100 - inLevel, pct: inLevel };
}

export async function getCoinHistory(userId, limit = 20) {
  const { rows } = await query("SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, limit]);
  return rows;
}

// Тарифы начисления — простые константы, чтобы менять баланс в одном месте.
export const REWARDS = {
  EVENT_COMPLETED: 15,
  EVENT_QUIZ_PASSED: 10, // за каждый правильный ответ теста мероприятия
  DIAGNOSTIC_DONE: 30,
  ROADMAP_PROGRESS_REPORTED: 15,
  ROADMAP_PROGRESS_RATED_BONUS: 10, // дополнительно, если наставник поставил 4-5
  ASSIGNMENT_SUBMITTED: 10,
  ASSIGNMENT_GRADED_BONUS: 15, // дополнительно, если наставник/тест засчитал высокий балл
};
