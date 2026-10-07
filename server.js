require("dotenv").config();

const path = require("node:path");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const app = express();
const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI;
const sessionSecret = process.env.SESSION_SECRET;
const databaseName = process.env.MONGODB_DB || "vulcanizadora_express";
const sessionCookieName = "vexpress.sid";
const serviceNames = ["Parches", "Vulcanizado", "Balanceo", "Rotación", "Nitrógeno", "Revisión general"];

if (!mongoUri) throw new Error("Falta configurar MONGODB_URI en el archivo .env.");
if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
  throw new Error("SESSION_SECRET debe tener al menos 32 bytes. Configúralo en el archivo .env.");
}

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  passwordHash: { type: String, required: true, select: false },
}, { timestamps: true });

const appointmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  service: { type: String, required: true, enum: serviceNames },
  date: { type: String, required: true },
  time: { type: String, required: true },
  notes: { type: String, trim: true, maxlength: 500, default: "" },
  status: { type: String, enum: ["pending", "confirmed"], default: "pending" },
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
const Appointment = mongoose.model("Appointment", appointmentSchema);

app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      frameSrc: ["https://www.openstreetmap.org"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(express.json({ limit: "10kb" }));
app.use(session({
  name: sessionCookieName,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: mongoUri,
    dbName: databaseName,
    collectionName: "sessions",
    ttl: 60 * 60 * 24 * 30,
    mongoOptions: {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    },
  }),
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
}));

app.get("/", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));
app.get("/styles.css", (_request, response) => response.sendFile(path.join(__dirname, "styles.css")));
app.get("/app.js", (_request, response) => response.sendFile(path.join(__dirname, "app.js")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({
    error: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo.",
  }),
});

function publicUser(user) {
  return { id: user._id.toString(), name: user.name, email: user.email, phone: user.phone };
}

function establishSession(request, userId, rememberMe) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      request.session.userId = userId.toString();
      if (rememberMe) request.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      resolve();
    });
  });
}

function requiredString(value, maximumLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

app.post("/api/auth/register", authLimiter, async (request, response) => {
  const { name, phone, email, password } = request.body || {};
  if (!requiredString(name, 80) || !requiredString(phone, 20) || !requiredString(email, 254)
    || typeof password !== "string" || password.length < 8 || Buffer.byteLength(password) > 72) {
    return response.status(400).json({
      error: "Revisa tus datos: completa todos los campos y usa una contraseña de 8 a 72 bytes.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return response.status(400).json({ error: "Escribe un correo electrónico válido." });
  }
  if (!/^[0-9+()\-\s]{7,20}$/.test(normalizedPhone)) {
    return response.status(400).json({ error: "Escribe un teléfono válido." });
  }
  if (await User.exists({ email: normalizedEmail })) {
    return response.status(409).json({ error: "Ya existe una cuenta con ese correo. Inicia sesión." });
  }

  const user = await User.create({
    name: name.trim(),
    phone: normalizedPhone,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12),
  });
  await establishSession(request, user._id, true);
  return response.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", authLimiter, async (request, response) => {
  const { email, password, rememberMe } = request.body || {};
  if (!requiredString(email, 254) || typeof password !== "string" || password.length === 0
    || Buffer.byteLength(password) > 72) {
    return response.status(400).json({ error: "Ingresa tu correo y contraseña." });
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return response.status(401).json({ error: "Correo o contraseña incorrectos." });
  }
  await establishSession(request, user._id, rememberMe === true);
  return response.json({ user: publicUser(user) });
});

app.get("/api/auth/me", async (request, response) => {
  if (!request.session.userId) return response.status(401).json({ error: "No has iniciado sesión." });
  const user = await User.findById(request.session.userId);
  if (!user) {
    request.session.destroy(() => {});
    return response.status(401).json({ error: "No has iniciado sesión." });
  }
  return response.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", async (request, response) => {
  if (request.session) {
    await new Promise((resolve, reject) => {
      request.session.destroy((error) => error ? reject(error) : resolve());
    });
  }
  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response.json({ message: "Sesión cerrada." });
});

function requireAuth(request, response, next) {
  if (!request.session.userId) return response.status(401).json({ error: "Inicia sesión para continuar." });
  return next();
}

app.get("/api/appointments", requireAuth, async (request, response) => {
  const appointments = await Appointment.find({ userId: request.session.userId })
    .sort({ createdAt: -1 })
    .select("service date time status createdAt")
    .lean();
  return response.json({ appointments });
});

app.post("/api/appointments", requireAuth, async (request, response) => {
  const { name, phone, service, date, time, notes = "" } = request.body || {};
  if (!requiredString(name, 80) || !requiredString(phone, 20)
    || !serviceNames.includes(service)
    || !isValidDate(date)
    || typeof time !== "string" || !/^(09|1[0-6]):00$/.test(time)
    || typeof notes !== "string" || notes.length > 500) {
    return response.status(400).json({ error: "Revisa los datos de la cita e inténtalo de nuevo." });
  }
  if (!/^[0-9+()\-\s]{7,20}$/.test(phone.trim())) {
    return response.status(400).json({ error: "Escribe un teléfono válido." });
  }

  const appointment = await Appointment.create({
    userId: request.session.userId,
    name: name.trim(),
    phone: phone.trim(),
    service,
    date,
    time,
    notes: notes.trim(),
  });
  return response.status(201).json({
    appointment: {
      id: appointment._id.toString(),
      service: appointment.service,
      date: appointment.date,
      time: appointment.time,
      status: appointment.status,
    },
  });
});

app.use((error, _request, response, _next) => {
  console.error("Error de la aplicación:", error);
  if (error.code === 11000) {
    return response.status(409).json({ error: "Ya existe una cuenta con ese correo. Inicia sesión." });
  }
  if (error.type === "entity.too.large") {
    return response.status(413).json({ error: "La solicitud es demasiado grande." });
  }
  return response.status(500).json({ error: "Ocurrió un error. Inténtalo de nuevo más tarde." });
});

async function start() {
  await mongoose.connect(mongoUri, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  app.listen(port, () => console.log(`Vulcanizadora Express disponible en http://localhost:${port}`));
}

start().catch((error) => {
  console.error("No se pudo iniciar el servidor. Revisa MongoDB y las variables de entorno.", error);
  process.exitCode = 1;
});
