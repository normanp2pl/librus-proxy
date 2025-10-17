"use strict";

const express = require("express");
const router = express.Router();
const { ensureAuth, getClient, resetAuth } = require("../lib/librus");

/** Utils */
function weekdayName(isoDate) {
  const d = new Date(isoDate + "T00:00:00Z");
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()];
}

function mondayOf(isoDate) {
  const d = new Date(isoDate + "T00:00:00Z");
  const wd = d.getUTCDay(); // 0=Sun..6=Sat
  const mondayShift = wd === 0 ? -6 : 1 - wd; // poniedziałek
  d.setUTCDate(d.getUTCDate() + mondayShift);
  return d.toISOString().slice(0,10);
}

function normDateStr(s) {
  if (!s) return null;
  if (s instanceof Date) return s.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return String(s);
  const d = new Date(s);
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}
function inRange(dayStr, startStr, endStr) {
  if (!startStr && !endStr) return true;
  if (!dayStr) return false;
  if (startStr && dayStr < startStr) return false;
  if (endStr && dayStr > endStr) return false;
  return true;
}
const DAY_IDX = { Monday:0, Tuesday:1, Wednesday:2, Thursday:3, Friday:4, Saturday:5, Sunday:6 };
function addDaysUTC(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

async function safeCall(fn) {
  try {
    return await fn();
  } catch (e) {
    resetAuth();
    await ensureAuth();
    return await fn();
  }
}

/** Normalizacja pojedynczej lekcji do wspólnego formatu */
function normalizeLesson(l) {
  const date =
    l.date ?? l.day ?? l.lessonDate ?? (l.startDate || l.beginDate)?.slice?.(0, 10) ?? null;
  const start =
    l.start ?? l.from ?? l.begin ?? l.startTime ?? l.timeFrom ?? null;
  const end =
    l.end ?? l.to ?? l.finish ?? l.endTime ?? l.timeTo ?? null;
  const subject = l.subject ?? l.name ?? l.title ?? null;
  const number = l.number ?? l.lesson ?? l.idx ?? null;
  const room = l.room ?? l.classroom ?? l.place ?? null;
  const teacher = l.teacher ?? l.teacherName ?? l.lecturer ?? null;
  const group = l.group ?? l.class ?? null;
  const dayName = l.dayName ?? null;

  return {
    date: normDateStr(date),
    dayName,
    start, end, number, subject, room, teacher, group,
    raw: l,
  };
}

/** Pobranie planu:
 *  1) getTimetable() — obsługa dwóch kształtów:
 *     - lista lekcji
 *     - siatka { hours[], table.{Monday..Sunday}[] }
 *  2) fallback: getCalendar() → filtrowanie wydarzeń „lekcyjnych”
 */
async function fetchTimetableUnified({ from, to, weekStart } = {}) {
  await ensureAuth();
  const client = getClient();

  const tryTimetable = async () => {
    const raw = await safeCall(() => client.calendar.getTimetable());

    // CASE A: standardowa lista
    const lessonsList = Array.isArray(raw) ? raw
                        : Array.isArray(raw?.lessons) ? raw.lessons
                        : null;
    if (lessonsList) return lessonsList.map(normalizeLesson);

    // CASE B: siatka {hours, table}
    if (raw && raw.hours && raw.table && typeof raw.table === "object") {
      const out = [];
      const hours = raw.hours; // np. "08:00 - 08:45"
      for (const [dayName, slots] of Object.entries(raw.table)) {
        if (!Array.isArray(slots)) continue;
        slots.forEach((slot, idx) => {
          if (!slot) return; // puste okienko
          const timeStr = slot.time || hours[idx] || null;
          let start = null, end = null;
          if (timeStr && timeStr.includes("-")) {
            const [s, e] = timeStr.split("-").map(s => s.trim());
            start = s || null; end = e || null;
          }
          // jeśli podano weekStart (poniedziałek), wylicz konkretne daty
          let date = null;
          if (weekStart && dayName in DAY_IDX) {
            date = addDaysUTC(weekStart, DAY_IDX[dayName]);
          }

          out.push(normalizeLesson({
            date,
            dayName,
            start,
            end,
            number: idx + 1,
            subject: slot.subject || null,
            room: slot.room || null,
            teacher: slot.teacher || null,
            group: null
          }));
        });
      }
      return out;
    }

    return [];
  };

  const tryCalendarFallback = async () => {
    const cal = await safeCall(() => client.calendar.getCalendar());
    const events = Array.isArray(cal) ? cal
                  : Array.isArray(cal?.events) ? cal.events
                  : [];

    const looksLikeLesson = (e) => {
      const t = (e.title ?? e.name ?? e.subject ?? "").toLowerCase();
      const cat = (e.category ?? e.type ?? "").toLowerCase();
      return /lekcj|zaję|wf|polski|matem|angiel|przyro|muzyc|plasty|informat|etyk|relig/i.test(t + " " + cat);
    };

    return events
      .filter(looksLikeLesson)
      .map(e => normalizeLesson({
        date: e.date ?? e.day ?? (e.start ?? e.begin ?? "").slice?.(0,10),
        start: e.start ?? e.begin ?? e.startTime ?? null,
        end: e.end ?? e.finish ?? e.endTime ?? null,
        subject: e.subject ?? e.title ?? e.name ?? null,
        room: e.room ?? e.classroom ?? e.place ?? null,
        teacher: e.teacher ?? e.teacherName ?? null,
        number: e.number ?? e.lesson ?? null,
        group: e.group ?? e.class ?? null,
        raw: e
      }));
  };

  const run = async () => {
    let lessons = await tryTimetable();
    if (!lessons.length) lessons = await tryCalendarFallback();

    // Docięcie po zakresie (gdy lib zignoruje parametry)
    const startStr = from ? normDateStr(from) : null;
    const endStr   = to   ? normDateStr(to)   : null;
    if (startStr || endStr) {
      lessons = lessons.filter(l => inRange(l.date, startStr, endStr));
    }

    // Grupowanie:
    // - jeżeli mamy daty → grupuj po dacie
    // - inaczej → grupuj po dayName
    const groups = new Map();
    if (lessons.some(l => l.date)) {
      for (const l of lessons) {
        if (!l.date) continue;
        if (!groups.has(l.date)) groups.set(l.date, []);
        groups.get(l.date).push(l);
      }
    } else {
      for (const l of lessons) {
        const key = l.dayName || "Unknown";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(l);
      }
    }

    // Sortowanie w grupach
    for (const arr of groups.values()) {
      arr.sort((a, b) => {
        if (a.number != null && b.number != null) return a.number - b.number;
        if (a.start && b.start) return String(a.start).localeCompare(String(b.start));
        return 0;
      });
    }

    // Budowa odpowiedzi
    const keyed = [...groups.entries()].map(([key, lessons]) => {
      if (key.includes("-")) { // YYYY-MM-DD
        const dn = lessons[0]?.dayName ?? weekdayName(key);
        // dla spójności, dociśnij dayName w lekcjach
        for (const l of lessons) { l.dayName = dn; }
        return { date: key, dayName: dn, lessons };
      } else {
        // grupowanie po nazwie dnia (fallback)
        return { date: null, dayName: key, lessons };
      }
    });
    // Sortowanie dni bez dat wg DAY_IDX
    keyed.sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.dayName && b.dayName) return (DAY_IDX[a.dayName] ?? 99) - (DAY_IDX[b.dayName] ?? 99);
      if (a.date && b.dayName) return -1;
      if (a.dayName && b.date) return 1;
      return 0;
    });

    return keyed;
  };

  try {
    return await run();
  } catch (_) {
    resetAuth();
    await ensureAuth();
    return await run();
  }
}

/** GET /timetable
 * Query:
 *  - date=YYYY-MM-DD            (konkretny dzień)
 *  - weekStart=YYYY-MM-DD       (poniedziałek; mapuje siatkę Monday..Sunday na daty)
 *  - from=YYYY-MM-DD&to=YYYY-MM-DD (alternatywnie zakres)
 *  - includeRaw=true|false
 */
router.get("/timetable", async (req, res) => {
  try {
    const { date, weekStart, includeRaw, from, to, autoWeek } = req.query;

    // autoWeek domyślnie włączone: jeśli brak weekStart/from/to → użyj poniedziałku bieżącego tygodnia
    const auto = String(autoWeek ?? "true").toLowerCase() !== "false";

    let range = { from: null, to: null, weekStart: null };

    if (date) {
      const d = normDateStr(date);
      if (!d) return res.status(400).json({ ok: false, error: "invalid_date" });
      // przemapuj siatkę względem poniedziałku tygodnia, w którym jest 'date'
      const ws = mondayOf(d);
      range = { from: d, to: d, weekStart: ws };
    } else if (weekStart) {
      const ws = normDateStr(weekStart);
      if (!ws) return res.status(400).json({ ok: false, error: "invalid_weekStart" });
      const wsDate = new Date(ws + "T00:00:00Z");
      const endDate = new Date(wsDate);
      endDate.setUTCDate(wsDate.getUTCDate() + 6);
      range = { from: ws, to: endDate.toISOString().slice(0, 10), weekStart: ws };
    } else if (from || to) {
      range = { from: from ? normDateStr(from) : null, to: to ? normDateStr(to) : null, weekStart: null };
    } else if (auto) {
      // brak parametrów → bieżący tydzień
      const today = new Date();
      const todayIso = today.toISOString().slice(0,10);
      const ws = mondayOf(todayIso);
      const wsDate = new Date(ws + "T00:00:00Z");
      const endDate = new Date(wsDate);
      endDate.setUTCDate(wsDate.getUTCDate() + 6);
      range = { from: ws, to: endDate.toISOString().slice(0, 10), weekStart: ws };
    }

    const data = await fetchTimetableUnified(range);

    const showRaw = String(includeRaw || "false").toLowerCase() === "true";
    const sanitized = data.map(day => ({
      date: day.date,
      dayName: day.dayName,
      lessons: day.lessons.map(l => {
        const { raw, ...rest } = l;
        return showRaw ? l : rest;
      }),
    }));

    const totalLessons = sanitized.reduce((acc, d) => acc + d.lessons.length, 0);

    res.json({
      ok: true,
      days: sanitized.length,
      lessons: totalLessons,
      data: sanitized,
      source: totalLessons ? "timetable(grid)|calendar_fallback" : "none",
      note: auto ? "auto weekStart applied when missing" : undefined
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});
/** DEBUG: surowy timetable */
router.get("/debug/timetable", async (req, res) => {
  try {
    await ensureAuth();
    const client = getClient();
    const raw = await safeCall(() => client.calendar.getTimetable());
    res.json({ ok: true, raw });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

/** DEBUG: surowy calendar */
router.get("/debug/calendar", async (req, res) => {
  try {
    await ensureAuth();
    const client = getClient();
    const raw = await safeCall(() => client.calendar.getCalendar());
    res.json({ ok: true, raw });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});
router.get("/timetable/today", async (_req, res) => {
  try {
    const todayIso = new Date().toISOString().slice(0,10);
    const ws = mondayOf(todayIso);
    const data = await fetchTimetableUnified({ from: todayIso, to: todayIso, weekStart: ws });
    const day = data.find(d => d.date === todayIso);
    res.json({ ok: true, date: todayIso, lessons: day?.lessons || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});
module.exports = router;
