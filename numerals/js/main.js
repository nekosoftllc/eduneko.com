/* Numerals landing page. Single IIFE in ES5 style, like eduneko.com's js/main.js:
   loaded directly by the browser, no transpilation. */
(function () {
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Waitlist ----------
     Same flow as the Gliff form on eduneko.com: POST /signups (product "numerals") to the
     Eduneko API, double opt-in, so success means "check your inbox". If the API is
     unreachable, the status line offers the form's data-fallback mailto link. The API
     scales to zero, so the first focus in the form wakes it, and a request that fails
     while it is starting (network error or 502/503/504) is retried once. */
  var LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var API = LOCAL ? "http://localhost:8080" : "https://api.eduneko.cloud";
  var RETRY_DELAY = 1500;
  var WARM_EVERY = 5 * 60 * 1000;
  var warmedAt = 0;

  function warmUp() {
    var now = Date.now();
    if (now - warmedAt < WARM_EVERY) return;
    warmedAt = now;
    fetch(API + "/healthz", { mode: "no-cors" }).catch(function () { /* only a wake-up */ });
  }

  function retryable(res) {
    return res.status === 502 || res.status === 503 || res.status === 504;
  }

  function postJSON(path, data) {
    function send() {
      return fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
    }
    function later() {
      return new Promise(function (resolve) { setTimeout(resolve, RETRY_DELAY); }).then(send);
    }
    return send().then(function (res) {
      return retryable(res) ? later() : res;
    }, later).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, body: body };
      });
    });
  }

  function setStatus(form, text, kind, fallback) {
    var el = form.querySelector("[data-form-status]");
    el.className = "form-status" + (kind ? " is-" + kind : "");
    el.textContent = text;
    if (fallback) {
      el.appendChild(document.createTextNode(" "));
      var a = document.createElement("a");
      a.href = fallback;
      a.textContent = "Email us instead.";
      el.appendChild(a);
    }
  }

  function failure(form, res) {
    var fallback = form.getAttribute("data-fallback");
    if (res && res.status === 400) {
      setStatus(form, "Please check the form: " + (res.body.error || "something isn't right") + ".", "error");
    } else if (res && res.status === 429) {
      setStatus(form, "Too many attempts. Please try again in a few minutes.", "error", fallback);
    } else {
      setStatus(form, "Sorry, that didn't go through.", "error", fallback);
    }
  }

  var signup = document.querySelector("form[data-signup]");
  if (signup) {
    signup.addEventListener("focusin", warmUp);
    signup.addEventListener("submit", function (event) {
      event.preventDefault();
      var email = signup.elements.email;
      if (!email.checkValidity()) {
        email.reportValidity();
        return;
      }
      var button = signup.querySelector("button[type=submit]");
      button.disabled = true;
      setStatus(signup, "Sending…");
      postJSON("/signups", {
        email: email.value.trim(),
        product: signup.getAttribute("data-signup"),
        website: signup.elements.website.value
      }).then(function (res) {
        if (res.status >= 200 && res.status < 300) {
          signup.reset();
          setStatus(signup, "Almost there. Check your inbox for a link to confirm.", "ok");
        } else {
          failure(signup, res);
        }
      }, function () {
        failure(signup, null);
      }).then(function () {
        button.disabled = false;
      });
    });
  }
})();
