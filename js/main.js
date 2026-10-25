(function () {
  var header = document.getElementById("site-header");
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("primary-nav");

  function onScroll() {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    toggle.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  nav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      nav.classList.remove("is-open");
      toggle.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });

  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { observer.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* Forms: Gliff waitlist (form[data-signup]) and contact (form[data-contact]) post to
     the Eduneko API. Signups are double opt-in: success means "check your inbox". If the
     API is unreachable, the status line offers the form's data-fallback mailto link.
     The API scales to zero, so the first focus in a form wakes it, and a request that
     fails while it is starting (network error or 502/503/504) is retried once. */
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

  function wireForm(form, path, collect, success) {
    form.addEventListener("focusin", warmUp);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var fields = form.querySelectorAll("input, select, textarea");
      for (var i = 0; i < fields.length; i++) {
        if (!fields[i].checkValidity()) {
          fields[i].reportValidity();
          return;
        }
      }
      var button = form.querySelector("button[type=submit]");
      button.disabled = true;
      setStatus(form, "Sending…");
      postJSON(path, collect()).then(function (res) {
        if (res.status >= 200 && res.status < 300) {
          form.reset();
          setStatus(form, success, "ok");
        } else {
          failure(form, res);
        }
      }, function () {
        failure(form, null);
      }).then(function () {
        button.disabled = false;
      });
    });
  }

  var signupForms = document.querySelectorAll("form[data-signup]");
  for (var s = 0; s < signupForms.length; s++) {
    (function (form) {
      wireForm(form, "/signups", function () {
        return {
          email: form.elements.email.value.trim(),
          product: form.getAttribute("data-signup"),
          website: form.elements.website.value
        };
      }, "Almost there. Check your inbox for a link to confirm.");
    })(signupForms[s]);
  }

  var contactForm = document.querySelector("form[data-contact]");
  if (contactForm) {
    wireForm(contactForm, "/contact", function () {
      var el = contactForm.elements;
      return {
        name: el.name.value.trim(),
        email: el.email.value.trim(),
        topic: el.topic.value,
        message: el.message.value.trim(),
        website: el.website.value
      };
    }, "Thanks, your message is on its way. We'll reply by email.");
  }
})();
