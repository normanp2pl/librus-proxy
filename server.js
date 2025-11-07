"use strict";

const express = require("express");
const app = express();

// === Swagger UI + OpenAPI (YAML) ===
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const openapiDocument = YAML.load("./openapi.yaml");
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument, {
  explorer: true,
  swaggerOptions: { persistAuthorization: true }
}));

app.get("/openapi.json", (_req, res) => res.json(openapiDocument));
// ===================================
const API_KEY = process.env.API_KEY;

app.use((req, res, next) => {
  if (!API_KEY) return next(); // jeśli nie ustawiono klucza – przepuszczamy wszystko

  const headerKey = req.get("x-api-key");
  const queryKey = req.query.apiKey;

  // akceptuj klucz w nagłówku lub w URL
  if (headerKey === API_KEY || queryKey === API_KEY) {
    return next();
  }

  return res.status(401).json({ ok:false, error: "unauthorized" });
});

const gradesRoutes = require("./routes/grades");
const timetableRoutes = require("./routes/timetable");
const messagesRoutes = require("./routes/messages");
const homeworksRoutes = require("./routes/homeworks");

const { PORT = 3000 } = process.env;

app.use(express.json());

// trasy modułowe
app.use(gradesRoutes);
app.use(timetableRoutes);
app.use(messagesRoutes);
app.use(homeworksRoutes);

// healthcheck
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
  console.log(`Swagger UI: http://localhost:${PORT}/docs`);
});
