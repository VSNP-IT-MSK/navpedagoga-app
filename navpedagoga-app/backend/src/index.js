import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { initSchema, seedIfEmpty } from "./db.js";
import { hasApiKey } from "./services/gemini.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import eventRoutes from "./routes/events.js";
import noteRoutes from "./routes/notes.js";
import messageRoutes from "./routes/messages.js";
import aiRoutes from "./routes/ai.js";
import diagnosticRoutes from "./routes/diagnostic.js";
import cronRoutes from "./routes/cron.js";
import groupRoutes from "./routes/groups.js";
import testRoutes from "./routes/tests.js";
import assignmentRoutes from "./routes/assignments.js";

await initSchema();
await seedIfEmpty();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

const globalLimiter = rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, liveAiMode: hasApiKey(), time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/diagnostic", diagnosticRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/assignments", assignmentRoutes);

app.use((req, res) => res.status(404).json({ error: "Не найдено" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`НавигаторПедагога API запущен на порту ${PORT}`);
  console.log(hasApiKey() ? "✅ Gemini API ключ найден — живой ИИ и поиск мероприятий включены." : "⚠️  GEMINI_API_KEY не задан — ИИ работает в офлайн-режиме (без поиска в интернете).");
});
