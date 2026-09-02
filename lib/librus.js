"use strict";

const Librus = require("librus-api");
const cheerio = require("cheerio");

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

/**
 * Parser nowego schematu strony ocen (table.newSchemaGradesByStudentTable).
 * getGrades() z librus-api 2.x oczekuje span.grade-box w starym układzie kolumn
 * i zwraca pusto na nowym schemacie — stąd własny parser.
 */
async function getGradesNewSchema(client) {
  const config = require("librus-api/lib/config.js");
  const res = await client.caller.get(config.page_url + "/przegladaj_oceny/uczen");
  const $ = cheerio.load(res.data);

  const subjects = [];
  $("table:has(> tbody > tr.studentRow)").each((_, table) => {
    $(table).children("tbody").children("tr").each((_, tr) => {
      if (!$(tr).hasClass("studentRow")) return;
      const tds = $(tr).children("td");
      const name = $(tds[1]).text().trim();
      if (!name) return;

      const grades = [];
      $(tr).next("tr.studentGradesDetailsRow").find("table tbody tr").each((_, gtr) => {
        const gtds = $(gtr).children("td");
        if (gtds.length !== 8) return; // „Brak ocen” = pojedynczy td colspan=8
        const link = $(gtds[0]).find("a").first();
        const href = link.attr("href") || "";
        const idRaw = href.split("/").filter(Boolean).pop();
        const value = (link.text() || $(gtds[0]).text()).trim().replace(/\*+$/u, "").trim();
        const cell = (n) => $(gtds[n]).text().trim();
        const info = [
          cell(2) && `Obszar oceniania: ${cell(2)}`,
          cell(3) && `Umiejętność: ${cell(3)}`,
          cell(4) && `Data: ${cell(4)}`,
          cell(5) && `Nauczyciel: ${cell(5)}`,
          cell(7) && `Dodał: ${cell(7)}`,
        ].filter(Boolean).join("\n");
        grades.push({ id: parseInt(idRaw, 10) || 0, info, value });
      });

      subjects.push({
        name,
        semester: [{ grades, tempAverage: null, average: null }],
        tempAverage: null,
        average: null,
      });
    });
  });

  return subjects;
}

/**
 * Ujednolicone pobieranie ocen: najpierw getGrades() z biblioteki (stary schemat),
 * a jeśli nie zwróci żadnych ocen — parser nowego schematu.
 */
async function fetchGrades(client) {
  let grades = [];
  try {
    grades = await client.info.getGrades();
  } catch (_) {
    grades = [];
  }
  const hasGrades = (grades || []).some(s =>
    (s.semester || []).some(sem => (sem.grades || []).length > 0)
  );
  if (hasGrades) return grades;
  return getGradesNewSchema(client);
}

module.exports = {
  getClient: () => client,
  ensureAuth,
  resetAuth: () => { isAuthorized = false; },
  getGradesNewSchema,
  fetchGrades,
};
