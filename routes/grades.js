"use strict";

const express = require("express");
const router = express.Router();
const { ensureAuth, getClient, resetAuth } = require("../lib/librus");

/** Parser pola `info` (plusiki w I–III klasie) */
function parseInfo(info = "") {
  const res = {};
  const lines = String(info).split("\n").map(s => s.trim());
  for (const line of lines) {
    if (line.startsWith("Obszar oceniania:"))
      res.area = line.split(":").slice(1).join(":").trim();
    else if (line.startsWith("Umiejętność:"))
      res.skill = line.split(":").slice(1).join(":").trim();
    else if (line.startsWith("Data:"))
      res.date = line.replace(/^Data:\s*/u, "").replace(/\s*\(.+\)\s*$/u, "").trim();
    else if (line.startsWith("Nauczyciel:"))
      res.teacher = line.replace(/^Nauczyciel:\s*/u, "").trim();
    else if (line.startsWith("Dodał:"))
      res.addedBy = line.replace(/^Dodał:\s*/u, "").trim();
  }
  return res;
}

async function safeCall(fn) {
  try {
    return await fn();
  } catch (e) {
    // jedna próba relogu
    resetAuth();
    await ensureAuth();
    return await fn();
  }
}

/** Ujednolicone pobieranie ocen (z relogiem) */
async function fetchGradesUnified() {
  await ensureAuth();
  const client = getClient();

  const run = async () => {
    const grades = await client.info.getGrades();
    const result = grades
      .map(s => ({
        subject: s.name,
        items: s.semester.flatMap(sem =>
          (sem.grades || []).map(g => {
            const meta = parseInfo(g.info || "");
            return {
              subject: s.name,
              value: g.value ?? g.symbol ?? g.mark ?? null, // „+”, „✓”, cyfry — co daje instancja
              ...meta, // area, skill, date, teacher, addedBy
              raw: g,  // do debugowania, wycinane domyślnie
            };
          })
        ),
      }))
      .filter(s => s.items.length > 0);

    return result;
  };

  try {
    return await run();
  } catch (_) {
    resetAuth();
    await ensureAuth();
    return await run();
  }
}

/** GET /grades
 * Query:
 *  - subject=fragment nazwy przedmiotu (opcjonalnie)
 *  - includeRaw=true|false
 */
router.get("/grades", async (req, res) => {
  try {
    const { subject, includeRaw } = req.query;
    const showRaw = String(includeRaw || "false").toLowerCase() === "true";

    const data = await fetchGradesUnified();

    let filtered = data;
    if (subject) {
      const q = String(subject).toLowerCase();
      filtered = data
        .map(s => ({ ...s, items: s.items.filter(it => it.subject.toLowerCase().includes(q)) }))
        .filter(s => s.items.length > 0);
    }

    const sanitized = filtered.map(s => ({
      subject: s.subject,
      items: s.items.map(it => {
        const { raw, ...rest } = it;
        return showRaw ? it : rest;
      })
    }));

    res.json({
      ok: true,
      count: sanitized.reduce((acc, s) => acc + s.items.length, 0),
      subjects: sanitized.length,
      data: sanitized
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

/** DEBUG: surowe getGrades() */
router.get("/debug/grades", async (_req, res) => {
  try {
    await ensureAuth();
    const client = getClient();
    const raw = await safeCall(() => client.info.getGrades());
    res.json({ ok: true, raw });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

module.exports = router;
