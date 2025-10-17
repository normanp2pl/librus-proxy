"use strict";

const express = require("express");
const router = express.Router();
const { ensureAuth, getClient, resetAuth } = require("../lib/librus");

function normDateStr(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return String(s);
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d.toISOString().slice(0,10);
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

/**
 * GET /homeworks
 * Query:
 *  - from=YYYY-MM-DD
 *  - to=YYYY-MM-DD
 *  - subject=fragment nazwy (opcjonalnie)
 *  - includeRaw=true|false
 */
router.get("/homeworks", async (req, res) => {
  try {
    await ensureAuth();
    const client = getClient();

    const { from, to, subject, includeRaw } = req.query;
    const fromStr = from ? normDateStr(from) : null;
    const toStr   = to   ? normDateStr(to)   : null;
    const qSubj   = (subject || "").toString().toLowerCase();
    const wantRaw = String(includeRaw || "false").toLowerCase() === "true";

    const fetchList = async () => {
      if (client.homework?.getHomeworks) {
        try {
          if (fromStr || toStr) {
            return await client.homework.getHomeworks({ from: fromStr, to: toStr });
          }
          return await client.homework.getHomeworks();
        } catch {
          return await client.homework.getHomeworks();
        }
      }
      if (client.homework?.list) return await client.homework.list();
      return [];
    };

    const rawList = await safeCall(fetchList);
    const items = Array.isArray(rawList?.items) ? rawList.items
                : Array.isArray(rawList) ? rawList
                : [];

    const normalized = items.map(h => {
      const id = h.id ?? h.homeworkId ?? h.uid ?? null;
      const subj = h.subject ?? h.subjectName ?? h.name ?? null;
      const title = h.title ?? h.topic ?? h.header ?? null;
      const desc = h.description ?? h.content ?? h.text ?? null;
      const assigned = h.assigned ?? h.given ?? h.created ?? h.date ?? null;
      const due = h.due ?? h.deadline ?? h.dueDate ?? h.end ?? null;
      const teacher = h.teacher ?? h.teacherName ?? h.author ?? null;
      return {
        id,
        subject: subj,
        title,
        description: desc,
        assignedDate: assigned,
        dueDate: due,
        teacher,
        raw: h
      };
    });

    let filtered = normalized;
    if (fromStr || toStr) {
      filtered = filtered.filter(x => {
        const d = normDateStr(x.dueDate || x.assignedDate);
        if (!d) return false;
        if (fromStr && d < fromStr) return false;
        if (toStr && d > toStr) return false;
        return true;
      });
    }
    if (qSubj) {
      filtered = filtered.filter(x => (x.subject || "").toLowerCase().includes(qSubj));
    }

    const sanitized = filtered.map(x => {
      if (wantRaw) return x;
      const { raw, ...rest } = x;
      return rest;
    });

    res.json({
      ok: true,
      total: sanitized.length,
      data: sanitized,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

module.exports = router;
