"use strict";

const express = require("express");
const router = express.Router();
const { ensureAuth, getClient, resetAuth } = require("../lib/librus");

// W wielu instancjach: 5=Odebrane, 6=Wysłane, 10=Uwagi
const DEFAULT_FOLDER_ID = 5;

function normDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(+d) ? String(s) : d.toISOString();
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

/**
 * BEZPIECZNE pobieranie listy wiadomości z folderu.
 * Zwraca tablicę elementów lub [] (zamiast 500 przy „dziwnych” folderach, np. Uwagi bez wpisów).
 */
async function fetchInboxSafe(client, folderId, page) {
  try {
    if (page != null) {
      const out = await safeCall(() => client.inbox.listInbox(folderId, page));
      return Array.isArray(out?.items) ? out.items : (Array.isArray(out) ? out : []);
    }
    const out = await safeCall(() => client.inbox.listInbox(folderId));
    return Array.isArray(out?.items) ? out.items : (Array.isArray(out) ? out : []);
  } catch (_) {
    return [];
  }
}

/**
 * GET /messages
 * Query:
 *  - folderId=NUMBER (domyślnie 5 – Odebrane)
 *  - page=NUMBER (jeśli Twoja wersja libki to wspiera)
 *  - includeRaw=true|false
 */
router.get("/messages", async (req, res) => {
  try {
    await ensureAuth();
    const client = getClient();

    const folderId = Number(req.query.folderId ?? DEFAULT_FOLDER_ID);
    const page = req.query.page != null ? Number(req.query.page) : undefined;
    const includeRaw = String(req.query.includeRaw || "false").toLowerCase() === "true";

    const items = await fetchInboxSafe(client, folderId, page);

    const normalized = items.map(m => {
      const id = m.id ?? m.messageId ?? m.uid ?? m.msgId ?? null;
      const subject = m.subject ?? m.title ?? "(bez tematu)";
      const sender = m.sender ?? m.from ?? m.author ?? m.teacher ?? null;
      const date = normDate(m.date ?? m.sentAt ?? m.time ?? m.created);
      const read =
        m.read ?? m.isRead ?? (m.unread !== undefined ? !m.unread : undefined) ?? null;
      const hasAttachments = !!(m.files?.length || m.attachments?.length);
      return includeRaw
        ? { id, folderId, subject, sender, date, read, hasAttachments, raw: m }
        : { id, folderId, subject, sender, date, read, hasAttachments };
    });

    res.json({ ok: true, folderId, total: normalized.length, data: normalized });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

/**
 * GET /messages/:folderId/:id
 * Szczegóły wiadomości (treść + pliki)
 * Query:
 *  - includeRaw=true|false
 */
router.get("/messages/:folderId/:id", async (req, res) => {
  try {
    await ensureAuth();
    const client = getClient();

    const folderId = Number(req.params.folderId);
    const id = Number(req.params.id);
    const includeRaw = String(req.query.includeRaw || "false").toLowerCase() === "true";

    let msg;
    try {
      msg = await safeCall(() => client.inbox.getMessage(folderId, id));
    } catch (_) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (!msg) return res.status(404).json({ ok: false, error: "not_found" });

    const subject = msg.subject ?? msg.title ?? "(bez tematu)";
    const sender = msg.sender ?? msg.from ?? msg.author ?? msg.teacher ?? null;
    const to = msg.to ?? msg.recipients ?? null;
    const date = normDate(msg.date ?? msg.sentAt ?? msg.time ?? msg.created);
    const body = msg.body ?? msg.text ?? msg.html ?? msg.content ?? null;

    const attachments = (msg.files ?? msg.attachments ?? []).map(f => ({
      name: f.name ?? f.filename ?? "plik",
      path: f.path ?? f.url ?? null,
      size: f.size ?? null,
      mime: f.mime ?? f.contentType ?? null
    }));

    const out = { id, folderId, subject, sender, to, date, body, attachments };
    if (includeRaw) out.raw = msg;

    res.json({ ok: true, data: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

/**
 * GET /messages/receivers?q=fraza
 * Wyszukiwarka potencjalnych adresatów (jeśli szkoła to udostępnia w Twojej instancji).
 */
router.get("/messages/receivers", async (req, res) => {
  try {
    await ensureAuth();
    const client = getClient();
    const q = String(req.query.q || "").trim();
    let list = [];
    try {
      list = await safeCall(() => client.inbox.listReceivers(q));
    } catch (_) {}
    res.json({ ok: true, total: Array.isArray(list) ? list.length : 0, data: list || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

/**
 * GET /announcements
 * Ogłoszenia (jeśli są używane).
 */
router.get("/announcements", async (req, res) => {
  try {
    await ensureAuth();
    const client = getClient();
    let list = [];
    try {
      list = await safeCall(() => client.inbox.listAnnouncements());
    } catch (_) {}
    const items = Array.isArray(list?.items) ? list.items : Array.isArray(list) ? list : [];
    res.json({ ok: true, total: items.length, data: items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

/**
 * GET /messages/folders-known
 * Prosta, statyczna „mapka” znanych folderów (bo getFolders() często nie istnieje).
 */
router.get("/messages/folders-known", (req, res) => {
  res.json({
    ok: true,
    data: [
      { id: 5,  name: "Odebrane" },
      { id: 6,  name: "Wysłane" },
      { id: 10, name: "Uwagi" } // może być pusto; obsługujemy bez 500
    ]
  });
});

/**
 * DEBUG: surowy zrzut z listInbox
 * GET /debug/messages?folderId=5&page=1
 * Zwraca ok: true nawet przy błędzie w libce — wtedy raw=null i note/error.
 */
router.get("/debug/messages", async (req, res) => {
  try {
    await ensureAuth();
    const client = getClient();

    const folderId = Number(req.query.folderId ?? DEFAULT_FOLDER_ID);
    const page = req.query.page != null ? Number(req.query.page) : undefined;

    try {
      const out = page != null
        ? await safeCall(() => client.inbox.listInbox(folderId, page))
        : await safeCall(() => client.inbox.listInbox(folderId));
      res.json({ ok: true, folderId, raw: out });
    } catch (e) {
      res.json({
        ok: true,
        folderId,
        raw: null,
        note: "listInbox threw",
        error: String(e?.message || e)
      });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

module.exports = router;
