import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_BANK } from "./data/testBank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

/**
 * DATABASE_URL — строка подключения к Postgres. Работает без изменений с
 * любым бесплатным провайдером: Neon, Supabase, Render Postgres (см.
 * .env.example про сроки действия бесплатных тарифов).
 * `ssl: { rejectUnauthorized: false }` нужен почти всем облачным Postgres
 * бесплатного тарифа (Neon/Supabase используют сертификаты, которые Node по
 * умолчанию не проверяет по цепочке) — для локальной разработки (localhost)
 * SSL отключается.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

export async function query(text, params) {
  return pool.query(text, params);
}

export const COMPETENCIES = [
  { id: "subject", icon: "📚", label: "Предметные", short: "Предмет", color: "green", desc: "Знание предмета, научная база" },
  { id: "pedagogy", icon: "🧠", label: "Психолого-педагогическое", short: "Психология", color: "purple", desc: "Управление классом, работа с учениками" },
  { id: "method", icon: "📋", label: "Методическое", short: "Методика", color: "magenta", desc: "Планирование, разработка рабочих программ" },
  { id: "digital", icon: "💻", label: "Цифровое / ИКТ", short: "Цифра", color: "yellow", desc: "МЭШ, ЭОР, медиаграмотность" },
  { id: "communication", icon: "🗣️", label: "Коммуникативное", short: "Общение", color: "purple", desc: "Родители, коллеги, администрация" },
  { id: "personal", icon: "⭐", label: "Личностное", short: "Бренд", color: "magenta", desc: "Бренд педагога, конкурсы, лидерство" },
];

// Соответствует алгоритму построения индивидуальной траектории (диссертация, гл. 3.2):
// тестирование -> создание пары -> корректировка карты -> обучение -> рефлексия -> портфолио.
export const ALGO_STAGES = [
  "Диагностика дефицитов",
  "Создание пары наставник—наставляемый",
  "Корректировка карты",
  "Обучение и мероприятия",
  "Рефлексивный анализ",
  "Цифровое портфолио",
];

export const NOTE_CATS = ["Личное", "Урок", "Наставничество", "Мероприятие", "Рефлексия", "Администрирование"];

/** Переводит строку из таблицы users (snake_case) в форму, которую уже ожидает фронтенд (camelCase). */
export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    subject: row.subject,
    school: row.school,
    region: row.region,
    yearsExperience: row.years_experience,
    currentStage: row.current_stage,
    mentorId: row.mentor_id,
    mentorStatus: row.mentor_status,
    approvedByAdmin: row.approved_by_admin,
    scores: row.scores,
    avatarColor: row.avatar_color,
    coins: row.coins,
    xp: row.xp,
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
  };
}

/** publicUser — алиас mapUser для совместимости с прежним контрактом роутов (никогда не включает password_hash). */
export const publicUser = mapUser;

export function mapEvent(row, completed) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.event_date,
    time: row.event_time,
    type: row.type,
    area: row.area,
    region: row.region,
    url: row.url,
    source: row.source,
    weight: row.weight,
    createdBy: row.created_by,
    completed: Boolean(completed?.completed),
    reflection: completed?.reflection || "",
  };
}

export function mapNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    category: row.category,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at,
  };
}

export function mapMessage(row) {
  if (!row) return null;
  return { id: row.id, from: row.from_user_id, to: row.to_user_id, text: row.text, ts: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at };
}

/** Создаёт таблицы, если их ещё нет — удобно для бесплатного хостинга без отдельного шага миграции. */
export async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "data", "schema.sql"), "utf8");
  await pool.query(schema);
}

export async function seedIfEmpty() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (rows[0].n > 0) return;

  const passHash = await bcrypt.hash("123456", 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const admin = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, subject, school, region, years_experience, current_stage, approved_by_admin, scores, avatar_color)
       VALUES ($1,$2,$3,'admin',$4,$5,$6,$7,6,true,$8,'purple') RETURNING id`,
      ["Администратор Системы", "admin@np.ru", passHash, "Администрация", "ГБОУ Школа №1248", "Москва", 8,
        JSON.stringify({ subject: 0, pedagogy: 0, method: 0, digital: 0, communication: 0, personal: 0 })]
    );
    const mentor = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, subject, school, region, years_experience, current_stage, approved_by_admin, scores, avatar_color)
       VALUES ($1,$2,$3,'mentor',$4,$5,$6,$7,6,true,$8,'green') RETURNING id`,
      ["Анна Сергеевна Козлова", "mentor@np.ru", passHash, "Математика", "ГБОУ Школа №1248", "Москва", 12,
        JSON.stringify({ subject: 5, pedagogy: 4, method: 5, digital: 4, communication: 5, personal: 4 })]
    );
    const user = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, subject, school, region, years_experience, current_stage, mentor_id, mentor_status, approved_by_admin, scores, avatar_color)
       VALUES ($1,$2,$3,'user',$4,$5,$6,$7,3,$8,'confirmed',true,$9,'magenta') RETURNING id`,
      ["Михаил Александрович Петров", "user@np.ru", passHash, "История", "ГБОУ Школа №1248", "Москва", 1,
        mentor.rows[0].id, JSON.stringify({ subject: 3, pedagogy: 2, method: 3, digital: 2, communication: 3, personal: 4 })]
    );

    const events = [
      ["Вебинар: Управление классом в современной школе", "Практические инструменты управления поведением учеников.", "15 сентября", "18:00", "online", "pedagogy", "Все регионы", 2],
      ["Мастер-класс: Цифровые инструменты учителя", "Обзор МЭШ, ЦОС и EdTech-инструментов.", "20 сентября", "16:00", "online", "digital", "Все регионы", 2],
      ["Открытый урок: Лучшие методики преподавания", "Мастер-класс от победителей конкурса «Учитель года».", "28 сентября", "10:00", "offline", "method", "Москва", 3],
      ["Тренинг: Коммуникация с родителями", "Разбор конфликтных ситуаций.", "3 октября", "17:00", "online", "communication", "Все регионы", 2],
      ["Конкурс молодых педагогов Москвы", "Городской конкурс для молодых специалистов.", "10 октября", "09:00", "offline", "personal", "Москва", 3],
      ["Курсы ПК: Обновление предметных знаний", "Актуальные научные подходы в преподавании предмета.", "18 октября", "14:00", "online", "subject", "Все регионы", 5],
    ];
    for (const [title, description, event_date, event_time, type, area, region, weight] of events) {
      await client.query(
        `INSERT INTO events (title, description, event_date, event_time, type, area, region, source, weight, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Каталог платформы',$8,$9)`,
        [title, description, event_date, event_time, type, area, region, weight, admin.rows[0].id]
      );
    }

    const notes = [
      ["Первый урок в 8Б", "Провёл первый урок. Дисциплина слабеет к концу — попробую «выходной билет».", "Рефлексия"],
      ["Совет наставника по ИКТ", "Анна Сергеевна рекомендовала библиотеку МЭШ.", "Наставничество"],
    ];
    for (const [title, content, category] of notes) {
      await client.query(`INSERT INTO notes (user_id, title, content, category) VALUES ($1,$2,$3,$4)`, [user.rows[0].id, title, content, category]);
    }

    for (let i = 0; i < TEST_BANK.length; i++) {
      const item = TEST_BANK[i];
      await client.query(`INSERT INTO diagnostic_items (competency_id, text, weight, sort_order) VALUES ($1,$2,$3,$4)`, [item.competency, item.text, item.weight, i]);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function newId() {
  // Postgres генерирует UUID сам (gen_random_uuid()) для строк, вставляемых через INSERT.
  // Эта функция остаётся для мест, где id нужен на стороне приложения до записи в БД.
  return crypto.randomUUID();
}
