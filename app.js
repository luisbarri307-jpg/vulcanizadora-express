const authView = document.querySelector("#authView");
const siteView = document.querySelector("#siteView");
const loginPanel = document.querySelector("#loginPanel");
const registerPanel = document.querySelector("#registerPanel");
const toast = document.querySelector("#toast");

let currentUser = null;
let toastTimer;
const apiTimeoutMs = 15000;

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), apiTimeoutMs);
  try {
    let response;
    try {
      response = await fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...options.headers },
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("El servidor tardó demasiado en responder. Comprueba que MongoDB esté activo e inténtalo de nuevo.");
      }
      if (error instanceof TypeError) {
        throw new Error("No se pudo conectar con el servidor. Inicia la aplicación con npm start y abre http://localhost:3000.");
      }
      throw error;
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("El servidor devolvió una respuesta inválida. Reinicia la aplicación e inténtalo de nuevo.");
    }
    if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
    return result;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function showNotice(selector, message, success = false) {
  const notice = document.querySelector(selector);
  notice.textContent = message;
  notice.classList.toggle("success", success);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3800);
}

function showAuth(mode = "login", message = "") {
  authView.hidden = false;
  siteView.hidden = true;
  loginPanel.hidden = mode !== "login";
  registerPanel.hidden = mode !== "register";
  showNotice(mode === "login" ? "#loginNotice" : "#registerNotice", message);
  window.scrollTo(0, 0);
}

function showSite(user) {
  currentUser = user;
  authView.hidden = true;
  siteView.hidden = false;
  document.querySelector("#userGreeting").textContent = `HOLA, ${user.name.split(/\s+/)[0]}`;
  document.querySelector("#bookingName").value = user.name;
  document.querySelector("#bookingPhone").value = user.phone || "";
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  document.querySelector("#bookingDate").min = today.toISOString().slice(0, 10);
  loadAppointments();
  animatePage();
}

function setFormBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = busy;
  button.style.opacity = busy ? ".65" : "";
  button.setAttribute("aria-busy", String(busy));
}

document.querySelectorAll("[data-show-register]").forEach((button) => {
  button.addEventListener("click", () => showAuth("register"));
});
document.querySelectorAll("[data-show-login]").forEach((button) => {
  button.addEventListener("click", () => showAuth("login"));
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  data.rememberMe = document.querySelector("#rememberMe").checked;
  setFormBusy(form, true);
  showNotice("#loginNotice", "Verificando tu cuenta…");
  try {
    const { user } = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
    try {
      if (data.rememberMe) localStorage.setItem("vexpress-email", data.email);
      else localStorage.removeItem("vexpress-email");
    } catch {
      showToast("Sesión iniciada. El navegador no permite recordar el correo.");
    }
    showSite(user);
  } catch (error) {
    showNotice("#loginNotice", error.message);
  } finally {
    setFormBusy(form, false);
  }
});

document.querySelector("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormBusy(form, true);
  showNotice("#registerNotice", "Creando tu cuenta…");
  try {
    const { user } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
    showSite(user);
    showToast("Tu cuenta quedó lista. ¡Bienvenido a Vulcanizadora Express!");
  } catch (error) {
    showNotice("#registerNotice", error.message);
  } finally {
    setFormBusy(form, false);
  }
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    currentUser = null;
    showAuth();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#bookingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setFormBusy(form, true);
  showNotice("#bookingNotice", "");
  const data = Object.fromEntries(new FormData(form));
  try {
    await api("/api/appointments", {
      method: "POST",
      body: JSON.stringify(data),
    });
    form.reset();
    document.querySelector("#bookingName").value = currentUser.name;
    document.querySelector("#bookingPhone").value = currentUser.phone || "";
    showNotice("#bookingNotice", "Solicitud enviada. Te contactaremos para confirmar disponibilidad.", true);
    showToast("Tu solicitud se guardó correctamente.");
    await loadAppointments();
  } catch (error) {
    showNotice("#bookingNotice", error.message);
  } finally {
    setFormBusy(form, false);
  }
});

async function loadAppointments() {
  const list = document.querySelector("#ordersList");
  list.replaceChildren();
  try {
    const { appointments } = await api("/api/appointments");
    if (appointments.length === 0) {
      const empty = document.createElement("p");
      empty.className = "orders-empty";
      empty.textContent = "Todavía no tienes solicitudes. Agenda tu primer servicio cuando quieras.";
      list.append(empty);
      return;
    }
    appointments.forEach((appointment) => {
      const row = document.createElement("div");
      row.className = "order-row";
      const values = [
        new Date(`${appointment.date}T12:00:00`).toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        appointment.service,
        appointment.time,
      ];
      values.forEach((value) => {
        const cell = document.createElement("span");
        cell.textContent = value;
        row.append(cell);
      });
      const status = document.createElement("span");
      status.className = "order-status";
      status.textContent = appointment.status === "confirmed" ? "CONFIRMADO" : "PENDIENTE";
      row.append(status);
      list.append(row);
    });
  } catch (error) {
    const failed = document.createElement("p");
    failed.className = "orders-empty";
    failed.textContent = error.message;
    list.append(failed);
  }
}

const menuToggle = document.querySelector("#menuToggle");
const mainNav = document.querySelector("#mainNav");
menuToggle.addEventListener("click", () => {
  const open = mainNav.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", String(open));
});
mainNav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mainNav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

function animatePage() {
  if (!window.gsap || !window.ScrollTrigger || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.gsap.registerPlugin(window.ScrollTrigger);
  window.gsap.fromTo(".hero-content > *", { autoAlpha: 0, y: 22 }, {
    autoAlpha: 1,
    y: 0,
    duration: .75,
    stagger: .09,
    ease: "power2.out",
    clearProps: "all",
  });
  window.gsap.to(".hero-backdrop", {
    yPercent: 10,
    ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true },
  });
  window.gsap.utils.toArray(".reveal-image").forEach((frame) => {
    window.gsap.fromTo(frame, {
      clipPath: "inset(12% 12% 12% 12% round 18px)",
      scale: .94,
    }, {
      clipPath: "inset(0% 0% 0% 0% round 0px)",
      scale: 1,
      ease: "none",
      scrollTrigger: { trigger: frame, start: "top 88%", end: "center 48%", scrub: 1 },
    });
  });
  window.gsap.utils.toArray(".service-card").forEach((card, index) => {
    window.gsap.from(card, {
      y: 30,
      autoAlpha: 0,
      duration: .55,
      delay: (index % 3) * .08,
      ease: "power2.out",
      scrollTrigger: { trigger: card, start: "top 92%", once: true },
    });
  });
  const cinematicImage = document.querySelector(".cinematic-image");
  window.gsap.fromTo(cinematicImage, {
    clipPath: "inset(13% 13% 13% 13% round 26px)",
    scale: .94,
  }, {
    clipPath: "inset(0% 0% 0% 0% round 0px)",
    scale: 1,
    ease: "none",
    scrollTrigger: { trigger: ".cinematic-section", start: "top 90%", end: "center 45%", scrub: 1 },
  });
  window.gsap.to(".parallax-image", {
    yPercent: 12,
    ease: "none",
    scrollTrigger: { trigger: ".cinematic-section", start: "top bottom", end: "bottom top", scrub: true },
  });
}

async function restoreSession() {
  try {
    const { user } = await api("/api/auth/me");
    showSite(user);
  } catch (error) {
    showAuth();
    if (error.message !== "No has iniciado sesión.") showNotice("#loginNotice", error.message);
  }
}

try {
  const rememberedEmail = localStorage.getItem("vexpress-email");
  if (rememberedEmail) {
    document.querySelector("#loginEmail").value = rememberedEmail;
    document.querySelector("#rememberMe").checked = true;
  }
} catch {
  // Private browsing settings can disable local storage; sign-in still works without remembering the email.
}

restoreSession();
