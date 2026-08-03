import { Router } from "express";
import { refreshStaleRoadmaps } from "../services/roadmap.js";

const router = Router();

/**
 * Автообновление дорожных карт по расписанию — это и есть "постоянно обновляющийся
 * список мероприятий по региону и компетенциям". Render free tier не запускает фоновые
 * задачи сам по себе (сервис засыпает без трафика), поэтому реальный планировщик — внешний:
 * бесплатный GitHub Actions cron (см. .github/workflows/refresh-roadmaps.yml в корне репозитория),
 * который раз в день дёргает этот эндпоинт по HTTPS. Это же будит спящий Render-сервис.
 *
 * Защищено секретным заголовком (не JWT — это не пользовательское действие).
 */
router.post("/refresh-roadmaps", async (req, res) => {
  const secret = req.headers["x-cron-secret"];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Неверный или отсутствующий CRON_SECRET" });
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 30); // ограничиваем пачку, чтобы не сжечь бесплатную квоту Gemini за один прогон
  const results = await refreshStaleRoadmaps(limit);
  res.json({ refreshed: results.length, results });
});

export default router;
