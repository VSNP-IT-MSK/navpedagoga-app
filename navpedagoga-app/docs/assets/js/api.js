/* ============================================================
   НавигаторПедагога — клиент API
   Заменяет прежний localStorage-слой на реальные запросы к бэкенду.
   ============================================================ */
(function (global) {
  "use strict";

  // Измените на адрес вашего развёрнутого бэкенда после деплоя.
  // Если фронтенд открыт с того же origin, что и API — оставьте пустым.
  const API_BASE = window.NP_API_BASE || "http://localhost:4000/api";

  const COMPETENCIES = [
    { id: "subject", icon: "📚", label: "Предметные", short: "Предмет", color: "green", desc: "Знание предмета, научная база" },
    { id: "pedagogy", icon: "🧠", label: "Психолого-педагогическое", short: "Психология", color: "purple", desc: "Управление классом, работа с учениками" },
    { id: "method", icon: "📋", label: "Методическое", short: "Методика", color: "magenta", desc: "Планирование, разработка рабочих программ" },
    { id: "digital", icon: "💻", label: "Цифровое / ИКТ", short: "Цифра", color: "yellow", desc: "МЭШ, ЭОР, медиаграмотность" },
    { id: "communication", icon: "🗣️", label: "Коммуникативное", short: "Общение", color: "purple", desc: "Родители, коллеги, администрация" },
    { id: "personal", icon: "⭐", label: "Личностное", short: "Бренд", color: "magenta", desc: "Бренд педагога, конкурсы, лидерство" },
  ];
  const ALGO_STAGES = ["Диагностика дефицитов", "Создание пары наставник—наставляемый", "Корректировка карты", "Обучение и мероприятия", "Рефлексивный анализ", "Цифровое портфолио"];
  const NOTE_CATS = ["Личное", "Урок", "Наставничество", "Мероприятие", "Рефлексия", "Администрирование"];
  const ROLE = { USER: "user", MENTOR: "mentor", ADMIN: "admin" };

  let TOKEN = localStorage.getItem("np_token") || null;
  let CUR_USER = null;

  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (TOKEN) headers.Authorization = "Bearer " + TOKEN;
    let res;
    try {
      res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      const err = new Error("Не удалось связаться с сервером. Проверьте, что бэкенд запущен и доступен по адресу " + API_BASE);
      err.network = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Ошибка сервера (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const API = {
    ROLE, COMPETENCIES, ALGO_STAGES, NOTE_CATS,
    apiBase: API_BASE,

    competency(id) { return COMPETENCIES.find((c) => c.id === id); },
    initials(u) {
      if (!u || !u.fullName) return "?";
      const p = u.fullName.trim().split(/\s+/);
      return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : p[0][0].toUpperCase();
    },
    roleLabel(role) { return role === ROLE.ADMIN ? "Администратор" : role === ROLE.MENTOR ? "Наставник" : "Молодой педагог"; },
    hasScores(u) { return Boolean(u && u.scores && Object.values(u.scores).some((v) => v > 0)); },
    avgScore(u) {
      if (!u || !u.scores) return 0;
      const vals = Object.values(u.scores).filter((v) => v > 0);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    },

    // ---- auth ----
    async login(email, password) {
      const data = await request("POST", "/auth/login", { email, password });
      TOKEN = data.token; CUR_USER = data.user;
      localStorage.setItem("np_token", TOKEN);
      return data.user;
    },
    async register(payload) {
      const data = await request("POST", "/auth/register", payload);
      TOKEN = data.token; CUR_USER = data.user;
      localStorage.setItem("np_token", TOKEN);
      return data.user;
    },
    async fetchMe() {
      if (!TOKEN) return null;
      try {
        const data = await request("GET", "/auth/me");
        CUR_USER = data.user;
        return CUR_USER;
      } catch (e) {
        TOKEN = null; localStorage.removeItem("np_token");
        return null;
      }
    },
    getCurUser() { return CUR_USER; },
    isLoggedIn() { return Boolean(TOKEN); },
    logout() { TOKEN = null; CUR_USER = null; localStorage.removeItem("np_token"); },
    async updateMe(payload) {
      const data = await request("PUT", "/users/me", payload);
      CUR_USER = data.user;
      return CUR_USER;
    },

    // ---- users (admin/mentor) ----
    async listUsers(role) { const data = await request("GET", "/users" + (role ? "?role=" + role : "")); return data.users; },
    async pendingMentees() { const data = await request("GET", "/users?role=user&status=pending"); return data.users; },
    async getUser(id) { const data = await request("GET", "/users/" + id); return data.user; },
    async setMentor(userId, mentorId) { const data = await request("PUT", `/users/${userId}/mentor`, { mentorId }); return data.user; },
    async deleteUser(id) { return request("DELETE", "/users/" + id); },
    async requestMentor(mentorId) { const data = await request("POST", `/users/mentors/${mentorId}/request`); return data.user; },
    async confirmMentee(menteeId) { const data = await request("POST", `/users/mentees/${menteeId}/confirm`); return data.user; },
    async declineMentee(menteeId) { const data = await request("POST", `/users/mentees/${menteeId}/decline`); return data.user; },

    // ---- events ----
    async listEvents(area) { const data = await request("GET", "/events" + (area && area !== "all" ? "?area=" + area : "")); return data.events; },
    async createEvent(ev) { const data = await request("POST", "/events", ev); return data.event; },
    async updateEvent(id, ev) { const data = await request("PUT", "/events/" + id, ev); return data.event; },
    async deleteEvent(id) { return request("DELETE", "/events/" + id); },
    async completeEvent(id, completed, reflection) { const data = await request("POST", `/events/${id}/complete`, { completed, reflection }); return data.event; },
    async getQuiz(eventId) { return request("GET", `/events/${eventId}/quiz`); },
    async submitQuiz(eventId, answers) { return request("POST", `/events/${eventId}/quiz/submit`, { answers }); },

    // ---- notes ----
    async listNotes() { const data = await request("GET", "/notes"); return data.notes; },
    async createNote(n) { const data = await request("POST", "/notes", n); return data.note; },
    async updateNote(id, n) { const data = await request("PUT", "/notes/" + id, n); return data.note; },
    async deleteNote(id) { return request("DELETE", "/notes/" + id); },

    // ---- messages ----
    async listMessages(otherId) { const data = await request("GET", "/messages/" + otherId); return data.messages; },
    async sendMessage(otherId, text) { const data = await request("POST", "/messages/" + otherId, { text }); return data.message; },

    // ---- AI ----
    async aiStatus() { return request("GET", "/ai/status"); },
    async getAiChat() { return request("GET", "/ai/chat"); },
    async startDiagnostic() { const data = await request("POST", "/ai/diagnostic/start"); return data.messages; },
    async replyDiagnostic(text) { return request("POST", "/ai/diagnostic/reply", { text }); },
    async chatWithAi(text) { const data = await request("POST", "/ai/chat", { text }); return data.messages; },
    async quickActions() { const data = await request("GET", "/ai/quick-actions"); return data.actions; },
    async generateRoadmap(region) { const data = await request("POST", "/ai/roadmap/generate", { region }); return data.roadmap; },
    async getRoadmap() { const data = await request("GET", "/ai/roadmap"); return data.roadmap; },
    async addProgress(item) { const data = await request("POST", "/ai/roadmap/progress", item); return data.progress; },
    async listProgress() { const data = await request("GET", "/ai/roadmap/progress"); return data.progress; },
    async reportProgress(id, reportText, usefulnessRating) { const data = await request("POST", `/ai/roadmap/progress/${id}/report`, { reportText, usefulnessRating }); return data.progress; },
    async reviewReport(text) { return request("POST", "/ai/roadmap/progress/review", { text }); },
    async getDigest() { return request("GET", "/ai/digest"); },
    async getNudge() { return request("GET", "/ai/nudge"); },
    async getTips(competencyId) { return request("GET", "/ai/tips/" + competencyId); },
    async getPortfolio(force) { return request("GET", "/ai/portfolio" + (force ? "?force=1" : "")); },
    async mentorRateProgress(id, mentorRating) { const data = await request("POST", `/ai/roadmap/progress/${id}/mentor-rate`, { mentorRating }); return data.progress; },
    async menteeReports() { const data = await request("GET", "/ai/roadmap/progress/mentees"); return data.progress; },

    // ---- структурированная диагностика (реальный тест из диссертации) ----
    async diagnosticItems() { return request("GET", "/diagnostic/items"); },
    async diagnosticMyAnswers() { const data = await request("GET", "/diagnostic/my-answers"); return data.answers; },
    async submitDiagnostic(answers) { const data = await request("POST", "/diagnostic/submit", { answers }); return data.scores; },

    // ---- группы ----
    async createGroup(name, description) { const data = await request("POST", "/groups", { name, description }); return data.group; },
    async listGroups() { const data = await request("GET", "/groups"); return data.groups; },
    async getGroup(id) { return request("GET", "/groups/" + id); },
    async deleteGroup(id) { return request("DELETE", "/groups/" + id); },
    async addGroupMember(groupId, userId) { return request("POST", `/groups/${groupId}/members`, { userId }); },
    async removeGroupMember(groupId, userId) { return request("DELETE", `/groups/${groupId}/members/${userId}`); },

    // ---- конструктор тестов ----
    async createTest(title, description, questions) { const data = await request("POST", "/tests", { title, description, questions }); return data.test; },
    async listTests() { const data = await request("GET", "/tests"); return data.tests; },
    async getTest(id) { const data = await request("GET", "/tests/" + id); return data.test; },
    async updateTest(id, payload) { const data = await request("PUT", "/tests/" + id, payload); return data.test; },
    async deleteTest(id) { return request("DELETE", "/tests/" + id); },

    // ---- задания ----
    async createAssignment(payload) { const data = await request("POST", "/assignments", payload); return data.assignment; },
    async listAssignments() { const data = await request("GET", "/assignments"); return data.assignments; },
    async getAssignment(id) { return request("GET", "/assignments/" + id); },
    async submitAssignment(id, payload) { const data = await request("POST", `/assignments/${id}/submit`, payload); return data.target; },
    async gradeAssignment(id, userId, score, total, feedback) { const data = await request("POST", `/assignments/${id}/grade/${userId}`, { score, total, feedback }); return data.target; },
    async deleteAssignment(id) { return request("DELETE", "/assignments/" + id); },
  };

  global.API = API;
})(window);
