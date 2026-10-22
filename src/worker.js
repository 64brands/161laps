/**
 * 161laps Worker.
 * Static pages stay on the assets pipeline. /api/contact sends mail via Resend.
 * RESEND_API_KEY is a Worker secret, same setting used by the FI50 contact form.
 */

var ALLOWED_SUBJECTS = [
  "Become a Guest",
  "General Comments",
  "Commercial Partnerships",
  "Commercial Opportunities",
  "General Enquiry",
];

var CONTACT_TO = "paul@161laps.com";
var CONTACT_FROM = "161 Laps Website <paul@161laps.com>";

function isContactApi(pathname) {
  return pathname === "/api/contact" || pathname === "/api/contact/";
}

function isRetiredShowPath(pathname) {
  return (
    pathname === "/the-show" ||
    pathname === "/the-show/" ||
    pathname === "/the-show/index.html"
  );
}

function permanentRedirect(location) {
  return new Response(null, {
    status: 301,
    headers: {
      Location: location,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { "Content-Type": "application/json" },
      extraHeaders || {}
    ),
  });
}

function wordCount(text) {
  var trimmed = String(text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function singleLine(value) {
  return String(value || "")
    .replace(/[\r\n\u0000]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function validateContact(body) {
  if (!body || typeof body !== "object") {
    return "invalid-request";
  }
  if (String(body.website || "").trim() !== "") {
    return "ignored";
  }
  if (ALLOWED_SUBJECTS.indexOf(String(body.subject || "").trim()) === -1) {
    return "invalid-subject";
  }
  if (!String(body.name || "").trim()) {
    return "invalid-name";
  }
  if (!isEmail(body.email)) {
    return "invalid-email";
  }
  if (!String(body.phone || "").trim()) {
    return "invalid-phone";
  }
  var message = String(body.message || "");
  if (!message.trim()) {
    return "invalid-message";
  }
  if (wordCount(message) > 500) {
    return "message-too-long";
  }
  return null;
}

function formatSubmittedAest(date) {
  var parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(date);
  var get = function (type) {
    var found = parts.filter(function (part) {
      return part.type === type;
    })[0];
    return found ? found.value : "";
  };
  var month = get("month").replace("Sept", "Sep");
  var period = get("dayPeriod").toLowerCase();
  return (
    get("day") +
    " " +
    month +
    " " +
    get("year") +
    ", " +
    get("hour") +
    ":" +
    get("minute") +
    " " +
    period +
    " " +
    get("timeZoneName")
  );
}

function buildEmail(body) {
  var submitted = formatSubmittedAest(new Date());
  var subject = singleLine(body.subject);
  var name = singleLine(body.name);
  var email = singleLine(body.email);
  var phone = String(body.phone).trim();
  var message = String(body.message).trim();
  var safeEmail = escapeHtml(email);

  var text = [
    "New 161 Laps website enquiry",
    "",
    "Enquiry Type: " + subject,
    "Name: " + name,
    "Email: " + email,
    "Phone: " + phone,
    "",
    "Message:",
    message,
    "",
    "Submitted: " + submitted,
  ].join("\n");

  var html =
    "<p><strong>New 161 Laps website enquiry</strong></p>" +
    "<p><strong>Enquiry Type:</strong> " +
    escapeHtml(subject) +
    "</p>" +
    "<p><strong>Name:</strong> " +
    escapeHtml(name) +
    "</p>" +
    "<p><strong>Email:</strong> " +
    safeEmail +
    "</p>" +
    "<p><strong>Phone:</strong> " +
    escapeHtml(phone) +
    "</p>" +
    "<p><strong>Message:</strong><br>" +
    escapeHtml(message).replace(/\n/g, "<br>") +
    "</p>" +
    "<p><strong>Submitted:</strong> " +
    escapeHtml(submitted) +
    "</p>";

  return {
    from: CONTACT_FROM,
    to: [CONTACT_TO],
    reply_to: email,
    subject: "161 Laps Contact — " + subject + " — " + name,
    text: text,
    html: html,
  };
}

async function handleContact(request, env) {
  if (request.method !== "POST") {
    return json(
      { ok: false, error: "method-not-allowed" },
      405,
      { Allow: "POST" }
    );
  }

  var body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: "invalid-request" }, 400);
  }

  var problem = validateContact(body);
  if (problem === "ignored") {
    return json({ ok: true }, 200);
  }
  if (problem) {
    return json({ ok: false, error: problem }, 400);
  }

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: "send-failed" }, 500);
  }

  var resendResponse;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildEmail(body)),
    });
  } catch (err) {
    return json({ ok: false, error: "send-failed" }, 500);
  }

  if (!resendResponse.ok) {
    return json({ ok: false, error: "send-failed" }, 500);
  }

  return json({ ok: true }, 200);
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    if (isRetiredShowPath(url.pathname)) {
      return permanentRedirect("https://161laps.com/");
    }
    if (url.pathname === "/sitemap.xml/") {
      return permanentRedirect("https://161laps.com/sitemap.xml");
    }
    if (isContactApi(url.pathname)) {
      return handleContact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
