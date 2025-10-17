"use strict";

const Librus = require("librus-api");

const {
  LIBRUS_LOGIN,
  LIBRUS_PASSWORD,
  STUDENT_INDEX, // opcjonalnie: 0/1/2...
} = process.env;

if (!LIBRUS_LOGIN || !LIBRUS_PASSWORD) {
  console.error("Brak LIBRUS_LOGIN / LIBRUS_PASSWORD w środowisku.");
  process.exit(1);
}

const client = new Librus();
let isAuthorized = false;

async function ensureAuth() {
  if (isAuthorized) return client;

  await client.authorize(LIBRUS_LOGIN, LIBRUS_PASSWORD);

  // próba wyboru dziecka (jeśli biblioteka to obsługuje)
  try {
    if (typeof client.selectStudent === "function" && STUDENT_INDEX != null) {
      const idx = Number(STUDENT_INDEX);
      if (!Number.isNaN(idx)) {
        await client.selectStudent(idx);
        console.log(`Wybrano STUDENT_INDEX=${idx}`);
      }
    }
  } catch (e) {
    console.warn("selectStudent nieobsługiwane lub błąd:", e?.message || e);
  }

  isAuthorized = true;
  return client;
}

module.exports = {
  getClient: () => client,
  ensureAuth,
  resetAuth: () => { isAuthorized = false; },
};
