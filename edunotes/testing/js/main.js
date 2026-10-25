/* EduNotes beta testers' page.

   Each tester gets a personal invite link: <page>?t=<token>. The token is moved into
   localStorage and stripped from the address bar, then sent as a Bearer token to the
   feedback endpoints of the Eduneko API (services/api in this repo). Testers who arrive
   without the link can type the code (or paste the whole link) into the code form, and
   "Change code" clears it again. Without a token the page still works as a guide, and
   "Copy summary" lets results go out through TestFlight feedback.

   Card progress and "Your setup" are kept in localStorage so a half-done card survives
   a reload. Storage can be unavailable (private mode, blocked site data), so every
   access goes through store.get/set, which fail quietly. */
(function () {
  "use strict";

  var LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var ORIGIN = LOCAL ? "http://localhost:8080" : "https://api.eduneko.cloud";
  var API = ORIGIN + "/feedback";
  var KEY = "edunotes-beta.";
  // The API scales to zero: focusing anything on the page wakes it (at most every
  // WARM_EVERY), and a request that fails while it is starting is retried once.
  var RETRY_DELAY = 1500;
  var WARM_EVERY = 5 * 60 * 1000;

  var STATUSES = [
    { value: "pass", label: "Pass" },
    { value: "fail", label: "Fail" },
    { value: "blocked", label: "Blocked" },
    { value: "untested", label: "Not tested" }
  ];

  var store = {
    get: function (k) {
      try { return JSON.parse(localStorage.getItem(KEY + k)); } catch (e) { return null; }
    },
    set: function (k, v) {
      try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* not persisted */ }
    },
    remove: function (k) {
      try { localStorage.removeItem(KEY + k); } catch (e) { /* nothing to remove */ }
    }
  };

  // ---------- Invite token ----------

  var token = (function () {
    var params = new URLSearchParams(location.search);
    var fromUrl = params.get("t");
    if (fromUrl) {
      store.set("token", fromUrl);
      // Keep the token out of the address bar, history, and anything copied from it.
      params.delete("t");
      var qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
      return fromUrl;
    }
    return store.get("token");
  })();

  var warmedAt = 0;

  function warmUp() {
    var now = Date.now();
    if (now - warmedAt < WARM_EVERY) return;
    warmedAt = now;
    fetch(ORIGIN + "/healthz", { mode: "no-cors" }).catch(function () { /* only a wake-up */ });
  }

  document.addEventListener("focusin", warmUp);

  function retryable(res) {
    return res.status === 502 || res.status === 503 || res.status === 504;
  }

  function api(method, path, body) {
    function send() {
      return fetch(API + path, {
        method: method,
        headers: Object.assign(
          { Authorization: "Bearer " + token },
          body ? { "Content-Type": "application/json" } : {}
        ),
        body: body ? JSON.stringify(body) : undefined
      });
    }
    function later() {
      return new Promise(function (resolve) { setTimeout(resolve, RETRY_DELAY); }).then(send);
    }
    return send().then(function (res) {
      return retryable(res) ? later() : res;
    }, later).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "HTTP " + res.status);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function failureMessage(err) {
    if (err.status === 401) return "Your tester code isn't valid any more. Enter the code from your latest invitation email.";
    if (err.status === 400) return "Something in the form wasn't accepted: " + err.message;
    return "Couldn't reach the feedback service. Your answers are kept on this device. Try again later, or use Copy summary and paste it into TestFlight feedback.";
  }

  // ---------- Tester code and status ----------

  var statusEl = document.querySelector("[data-tester-status]");
  var codeForm = document.querySelector("[data-code-form]");
  var codeInput = codeForm.elements.code;
  var codeCurrent = document.querySelector("[data-code-current]");

  function showTesterStatus(text, warn) {
    statusEl.textContent = text;
    statusEl.classList.toggle("warn", !!warn);
    statusEl.hidden = false;
  }

  function markAssigned(cards) {
    cards.forEach(function (letter) {
      var card = document.querySelector('details[data-card="' + letter + '"]');
      if (!card) return;
      card.classList.add("assigned");
      card.querySelector("[data-assigned]").hidden = false;
    });
    // Open the first assigned card so testers land on their work.
    var first = document.querySelector("details.assigned");
    if (first) first.open = true;
  }

  function clearAssigned() {
    Array.prototype.forEach.call(document.querySelectorAll("details.assigned"), function (card) {
      card.classList.remove("assigned");
      card.querySelector("[data-assigned]").hidden = true;
    });
  }

  // Shows the form when there is no code, otherwise the code and its Change button.
  function renderCode() {
    codeForm.hidden = !!token;
    codeCurrent.hidden = !token;
    codeCurrent.querySelector("[data-code-value]").textContent = token || "";
  }

  function verifyToken() {
    var checking = token;
    showTesterStatus("Checking your tester code…");
    api("GET", "/me").then(function (me) {
      if (token !== checking) return;
      var cards = me.cards || [];
      var who = me.name || me.id;
      showTesterStatus(
        "Signed in as " + who + ". " +
        (cards.length ? "Your cards: " + cards.join(", ") + "." : "No cards assigned yet. Use EduNotes normally and report anything odd.")
      );
      markAssigned(cards);
    }).catch(function (err) {
      if (token !== checking) return;
      if (err.status === 401) {
        setToken(null);
        codeInput.value = checking;
      }
      showTesterStatus(failureMessage(err), true);
    });
  }

  function setToken(value) {
    token = value;
    if (value) store.set("token", value); else store.remove("token");
    clearAssigned();
    renderCode();
  }

  // Accepts the bare code or the whole invite link, which carries it as ?t=.
  function readCode(text) {
    text = text.trim();
    var match = /[?&]t=([^&#\s]+)/.exec(text);
    if (match) text = decodeURIComponent(match[1]);
    return /^[A-Za-z0-9_-]{16,}$/.test(text) ? text : null;
  }

  codeForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var code = readCode(codeInput.value);
    if (!code) {
      codeInput.setAttribute("aria-invalid", "true");
      showTesterStatus("That doesn't look like a tester code. Copy it from your invitation email, or paste the whole link.", true);
      codeInput.focus();
      return;
    }
    codeInput.removeAttribute("aria-invalid");
    codeInput.value = "";
    setToken(code);
    verifyToken();
  });

  codeCurrent.querySelector("[data-code-reset]").addEventListener("click", function () {
    setToken(null);
    showTesterStatus("Enter your tester code to send results. You can still read the cards and use Copy summary.", true);
    codeInput.focus();
  });

  renderCode();
  if (token) {
    verifyToken();
  } else {
    showTesterStatus("Enter your tester code, or open the personal link from your invitation email, to send results. You can still read the cards and use Copy summary.", true);
  }

  // ---------- Your setup ----------

  var setupForm = document.querySelector("[data-setup]");
  var savedSetup = store.get("setup") || {};
  Array.prototype.forEach.call(setupForm.elements, function (el) {
    if (el.name && savedSetup[el.name]) el.value = savedSetup[el.name];
  });
  setupForm.addEventListener("input", function () {
    var data = {};
    Array.prototype.forEach.call(setupForm.elements, function (el) {
      if (el.name) data[el.name] = el.value.trim();
      if (el.value.trim()) el.removeAttribute("aria-invalid");
    });
    store.set("setup", data);
  });

  function readSetup() {
    var data = {};
    Array.prototype.forEach.call(setupForm.elements, function (el) {
      if (el.name) data[el.name] = el.value.trim();
    });
    return data;
  }

  // Returns true when build, device and OS are filled; otherwise flags them and moves there.
  function requireSetup(statusTarget) {
    var missing = Array.prototype.filter.call(setupForm.querySelectorAll("[required]"), function (el) {
      var empty = !el.value.trim();
      if (empty) el.setAttribute("aria-invalid", "true");
      return empty;
    });
    if (!missing.length) return true;
    setStatus(statusTarget, "Fill in Your setup first: build, device model, and OS version.", "error");
    missing[0].scrollIntoView({ block: "center" });
    missing[0].focus({ preventScroll: true });
    return false;
  }

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = "form-status" + (kind ? " " + kind : "");
  }

  // ---------- Test cards ----------

  var footerTemplate = document.getElementById("card-footer");

  Array.prototype.forEach.call(document.querySelectorAll("details[data-card]"), function (card) {
    var letter = card.getAttribute("data-card");

    // Shared footer; radio names must be unique per card or the groups would merge.
    var footer = footerTemplate.content.cloneNode(true);
    Array.prototype.forEach.call(footer.querySelectorAll('input[name="outcome"]'), function (r) {
      r.name = "outcome-" + letter;
    });
    card.querySelector("[data-card-footer]").appendChild(footer);

    // One segmented status control per checklist line.
    Array.prototype.forEach.call(card.querySelectorAll("li[data-item]"), function (li) {
      var id = li.getAttribute("data-item");
      var text = document.createElement("span");
      text.className = "item-text";
      text.id = "item-" + id;
      while (li.firstChild) text.appendChild(li.firstChild);
      li.appendChild(text);

      var group = document.createElement("div");
      group.className = "status-group";
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-labelledby", text.id);
      STATUSES.forEach(function (s) {
        var label = document.createElement("label");
        var input = document.createElement("input");
        input.type = "radio";
        input.name = "item-" + id;
        input.value = s.value;
        var span = document.createElement("span");
        span.textContent = s.label;
        label.appendChild(input);
        label.appendChild(span);
        group.appendChild(label);
      });
      li.appendChild(group);
    });

    restoreDraft(card, letter);
    card.addEventListener("change", function () { saveDraft(card, letter); });
    card.addEventListener("input", function () { saveDraft(card, letter); });

    var statusOut = card.querySelector("[data-status]");
    card.querySelector('[data-action="send"]').addEventListener("click", function (e) {
      sendCard(card, letter, e.currentTarget, statusOut);
    });
    card.querySelector('[data-action="copy"]').addEventListener("click", function () {
      copyText(summaryText(letter, readCard(card, letter)), statusOut, "Summary copied. Paste it into TestFlight feedback or an email.");
    });
    card.querySelector('[data-action="reset"]').addEventListener("click", function () {
      clearCard(card);
      store.remove("card." + letter);
      setStatus(statusOut, "Card cleared.");
    });
  });

  // Unmarked lines read as "" so a restored draft leaves them blank; they are sent
  // and summarised as "untested".
  function readCard(card, letter) {
    var data = { items: [], fields: {}, outcome: "" };
    Array.prototype.forEach.call(card.querySelectorAll("li[data-item]"), function (li) {
      var checked = li.querySelector("input:checked");
      data.items.push({ id: li.getAttribute("data-item"), status: checked ? checked.value : "" });
    });
    Array.prototype.forEach.call(card.querySelectorAll("[data-field]"), function (el) {
      data.fields[el.getAttribute("data-field")] = el.value.trim();
    });
    var outcome = card.querySelector('input[name="outcome-' + letter + '"]:checked');
    data.outcome = outcome ? outcome.value : "";
    return data;
  }

  function saveDraft(card, letter) {
    store.set("card." + letter, readCard(card, letter));
  }

  function restoreDraft(card, letter) {
    var draft = store.get("card." + letter);
    if (!draft) return;
    (draft.items || []).forEach(function (it) {
      var input = it.status && card.querySelector('input[name="item-' + it.id + '"][value="' + it.status + '"]');
      if (input) input.checked = true;
    });
    Object.keys(draft.fields || {}).forEach(function (name) {
      var el = card.querySelector('[data-field="' + name + '"]');
      if (el) el.value = draft.fields[name];
    });
    if (draft.outcome) {
      var o = card.querySelector('input[name="outcome-' + letter + '"][value="' + draft.outcome + '"]');
      if (o) o.checked = true;
    }
  }

  function clearCard(card) {
    Array.prototype.forEach.call(card.querySelectorAll("input[type=radio]"), function (r) { r.checked = false; });
    Array.prototype.forEach.call(card.querySelectorAll("[data-field]"), function (el) { el.value = ""; });
  }

  function sendCard(card, letter, button, statusOut) {
    if (!token) {
      setStatus(statusOut, "Enter your tester code at the top of the page to send results, or use Copy summary.", "error");
      return;
    }
    if (!requireSetup(statusOut)) return;

    var data = readCard(card, letter);
    if (!data.outcome) {
      setStatus(statusOut, "Choose an overall result: Pass, Fail, or Blocked.", "error");
      return;
    }

    var setup = readSetup();
    var payload = {
      card: letter,
      build: setup.build,
      device: setup.device,
      os: setup.os,
      pencil: setup.pencil || "",
      connection: data.fields.connection || "",
      syncService: data.fields.syncService || "",
      document: data.fields.document || "",
      items: data.items.map(function (it) { return { id: it.id, status: it.status || "untested" }; }),
      outcome: data.outcome,
      issueIds: data.fields.issueIds || "",
      notes: data.fields.notes || ""
    };

    button.disabled = true;
    setStatus(statusOut, "Sending…");
    api("POST", "/results", payload).then(function (res) {
      clearCard(card);
      store.remove("card." + letter);
      setStatus(statusOut, "Sent. Thank you! Reference " + res.id.slice(0, 8) + ".", "ok");
    }).catch(function (err) {
      setStatus(statusOut, failureMessage(err), "error");
    }).then(function () {
      button.disabled = false;
    });
  }

  function summaryText(letter, data) {
    var setup = readSetup();
    var title = document.querySelector('[data-card="' + letter + '"] .card-title').textContent;
    var lines = [
      "EduNotes beta: Card " + letter + " (" + title + ")",
      "Build: " + (setup.build || "?") + " | Device: " + (setup.device || "?") + " | OS: " + (setup.os || "?") +
        (setup.pencil ? " | Pencil: " + setup.pencil : "")
    ];
    Object.keys(data.fields).forEach(function (k) {
      if (data.fields[k] && k !== "notes") lines.push(k + ": " + data.fields[k]);
    });
    lines.push("Result: " + (data.outcome || "not set"));
    data.items.forEach(function (it) {
      lines.push("  " + it.id + ": " + (it.status || "untested"));
    });
    if (data.fields.notes) lines.push("Notes: " + data.fields.notes);
    return lines.join("\n");
  }

  function copyText(text, statusOut, okMessage) {
    if (!navigator.clipboard) {
      setStatus(statusOut, "Copying isn't available in this browser. Select the text and copy it manually.", "error");
      return;
    }
    navigator.clipboard.writeText(text).then(function () {
      setStatus(statusOut, okMessage, "ok");
    }, function () {
      setStatus(statusOut, "Couldn't copy. Select the text and copy it manually.", "error");
    });
  }

  // ---------- Report format ----------

  // Builds the tester's own first line from severity, area and description. Without JS
  // the form stays hidden and the generic format above it still reads as a guide.
  var builder = document.querySelector("[data-report-builder]");
  var builderStatus = builder.querySelector("[data-status]");
  var builderLine = builder.querySelector("output code");

  function reportLine() {
    var f = builder.elements;
    return "[" + f.severity.value + "] [" + (f.area.value || "Area") + "] " +
      (f.description.value.trim() || "Short description");
  }

  builder.hidden = false;
  builder.addEventListener("input", function (e) {
    e.target.removeAttribute("aria-invalid");
    builderLine.textContent = reportLine();
    setStatus(builderStatus, "");
  });
  builder.addEventListener("submit", function (e) {
    e.preventDefault();
    var missing = [builder.elements.area, builder.elements.description].filter(function (el) {
      var empty = !el.value.trim();
      if (empty) el.setAttribute("aria-invalid", "true");
      return empty;
    });
    if (missing.length) {
      setStatus(builderStatus, "Choose an area and add a short description first.", "error");
      missing[0].focus();
      return;
    }
    copyText(reportLine(), builderStatus, "Copied. Paste it as the first line of your TestFlight feedback.");
  });

  // ---------- Weekly check-in ----------

  var checkin = document.querySelector("[data-checkin]");
  var checkinStatus = checkin.querySelector("[data-status]");
  checkin.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!token) {
      setStatus(checkinStatus, "Enter your tester code at the top of the page to send a check-in.", "error");
      return;
    }
    if (!requireSetup(checkinStatus)) return;

    var normalUse = checkin.querySelector('input[name="normalUse"]:checked');
    var sessions = parseInt(checkin.elements.guidedSessions.value, 10);
    var payload = {
      build: readSetup().build,
      guidedSessions: isNaN(sessions) ? 0 : Math.max(0, Math.min(50, sessions)),
      normalUse: normalUse ? normalUse.value === "true" : false,
      blockers: checkin.elements.blockers.value.trim(),
      notes: checkin.elements.notes.value.trim()
    };

    var button = checkin.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(checkinStatus, "Sending…");
    api("POST", "/checkins", payload).then(function () {
      checkin.reset();
      setStatus(checkinStatus, "Check-in sent. Thank you!", "ok");
    }).catch(function (err) {
      setStatus(checkinStatus, failureMessage(err), "error");
    }).then(function () {
      button.disabled = false;
    });
  });
})();
