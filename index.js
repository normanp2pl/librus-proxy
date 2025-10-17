"use strict";

const Librus = require("librus-api");

async function main() {
  const login = process.env.LIBRUS_LOGIN;
  const password = process.env.LIBRUS_PASSWORD;

  if (!login || !password) {
    console.error("Brak LIBRUS_LOGIN / LIBRUS_PASSWORD w środowisku.");
    process.exit(1);
  }

  const client = new Librus();

  await client.authorize(login, password);
  console.log("✅ Zalogowano do Librus.");

  // Przykładowe wywołania — wybierz co chcesz
  const info = await client.info.getAccountInfo();
  console.log("Konto:", info);

  // const subjects = await client.homework.listSubjects();
  // subjects.forEach(async (element) => {
  //   const homework = await client.homework.listHomework(element.id);
  //   if (homework!=[]) console.log(homework);
  // });
  function parseInfo(info = "") {
    const res = {};
    const lines = info.split("\n").map(s => s.trim());
    for (const line of lines) {
      if (line.startsWith("Obszar oceniania:")) res.area = line.split(":").slice(1).join(":").trim();
      else if (line.startsWith("Umiejętność:"))   res.skill = line.split(":").slice(1).join(":").trim();
      else if (line.startsWith("Data:"))          res.date  = line.replace(/^Data:\s*/u, "").replace(/\s*\(.+\)\s*$/u, "").trim();
      else if (line.startsWith("Nauczyciel:"))    res.teacher = line.replace(/^Nauczyciel:\s*/u, "").trim();
      else if (line.startsWith("Dodał:"))         res.addedBy = line.replace(/^Dodał:\s*/u, "").trim();
    }
    return res;
  }
  
  const grades = await client.info.getGrades();
  
  for (const subject of grades) {
    const semestersWithGrades = subject.semester.filter(s => Array.isArray(s.grades) && s.grades.length > 0);
    if (semestersWithGrades.length === 0) continue;
  
    console.log(`📘 ${subject.name}`);
    for (const sem of semestersWithGrades) {
      for (const g of sem.grades) {
        const meta = parseInfo(g.info);
        const symbol = g.value ?? g.symbol ?? g.mark ?? "?";   // „+”, „✓”, itp.
        const parts = [
          symbol,
          meta.skill && `— ${meta.skill}`,
          meta.date && `⏰ ${meta.date}`,
          meta.teacher && `— ${meta.teacher}`,
          meta.addedBy && `(dodał: ${meta.addedBy})`
        ].filter(Boolean);
        console.log("  " + parts.join(" "));
      }
    }
    console.log(""); // odstęp między przedmiotami
  }
  
  
  // const grades = await client.info.getGrades();
  // grades.forEach(async (grade) => {
  //   console.log(grade)
  // })
  // console.log("Oceny (skrót):", grades?.slice?.(0, 10)); // nie zasypuj terminala

  // const timetable = await client.calendar.getCalendar();
  // console.log("Plan lekcji (skrót):", timetable?.slice?.(0, 3));

  // Inne metody dostępne w README, np. inbox, homework, absence itd.
}

main().catch(err => {
  console.error("❌ Błąd:", err?.message || err);
  process.exit(1);
});
