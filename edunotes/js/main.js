/* Tailwind Play CDN configuration — must run before the CDN paints, so this file
   is loaded synchronously in <head>, immediately after the CDN script. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        brand: '#1034A6',
        'brand-hover': '#0D2B8A',
        'brand-tint': 'rgba(16, 52, 166, 0.08)',
        charcoal: '#1D1D1F',
        muted: '#6E6E73',
        studio: '#F4F4F6',
        space: '#111113',
      },
      borderColor: {
        hairline: 'rgba(0, 0, 0, 0.08)',
      },
      borderRadius: {
        '2xl': '20px',
        '3xl': '28px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'sans-serif'],
      },
      maxWidth: {
        shell: '1120px',
      },
    },
  },
};

/* Early-access forms.

   Submitting adds the visitor to the EduNotes waitlist through the Eduneko API
   (services/api, POST /signups). It is double opt-in, so success means "check your
   inbox for a confirmation link", shown in the form's [data-form-status] line. If the
   API can't be reached, the old behaviour takes over: a mailto: link pre-filled with
   what they typed opens their mail application.

   The API scales to zero, so the first focus in a form wakes it, and a request that
   fails while it is starting (network error or 502/503/504) is retried once before
   falling back. */
(function () {
  var LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var API = LOCAL ? "http://localhost:8080" : "https://api.eduneko.cloud";
  var INBOX = "hello@eduneko.eu";
  var SUBJECT = "EduNotes early access request";
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

  function postWithRetry(url, options) {
    function send() { return fetch(url, options); }
    function later() {
      return new Promise(function (resolve) { setTimeout(resolve, RETRY_DELAY); }).then(send);
    }
    return send().then(function (res) {
      return retryable(res) ? later() : res;
    }, later);
  }

  var ROLE_LABELS = {
    teacher: "Teacher / Educator",
    trainer: "Trainer / Speaker",
    student: "Student",
    other: "Other"
  };

  function buildBody(email, role) {
    var lines = ["I'd like early access to the EduNotes private beta.", ""];
    if (email) lines.push("Email: " + email);
    if (role) lines.push("Role: " + (ROLE_LABELS[role] || role));
    return lines.join("\n");
  }

  function setStatus(form, text, kind) {
    var el = form.querySelector("[data-form-status]");
    if (!el) return;
    el.textContent = text;
    el.setAttribute("data-kind", kind || "");
  }

  function wire(form) {
    form.addEventListener("focusin", warmUp);
    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var emailField = form.querySelector('input[type="email"]');
      var roleField = form.querySelector("select");
      var honeypot = form.querySelector('input[name="website"]');
      var button = form.querySelector('button[type="submit"]');

      if (emailField && !emailField.checkValidity()) {
        emailField.reportValidity();
        return;
      }

      var email = emailField ? emailField.value.trim() : "";
      var role = roleField ? roleField.value : "";

      function openMailApp() {
        window.location.href =
          "mailto:" + INBOX +
          "?subject=" + encodeURIComponent(SUBJECT) +
          "&body=" + encodeURIComponent(buildBody(email, role));
      }

      button.disabled = true;
      setStatus(form, "Sending…");
      postWithRetry(API + "/signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, product: "edunotes", role: role, website: honeypot ? honeypot.value : "" })
      }).then(function (res) {
        if (res.ok) {
          form.reset();
          setStatus(form, "Almost there. Check your inbox for a link to confirm.", "ok");
        } else if (res.status === 400) {
          setStatus(form, "Please check your email address and try again.", "error");
        } else if (res.status === 429) {
          setStatus(form, "Too many attempts. Please try again in a few minutes.", "error");
        } else {
          setStatus(form, "");
          openMailApp();
        }
      }, function () {
        setStatus(form, "");
        openMailApp();
      }).then(function () {
        button.disabled = false;
      });
    });
  }

  function init() {
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) wire(forms[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* Hero headline rotator.

   Cycles the aria-current word inside [data-rotator]; the crossfade is a CSS opacity
   transition. Skipped under reduced motion and paused while the tab is hidden. Without
   JS the first word simply stays. */
(function () {
  var INTERVAL = 3000;

  function setup(root) {
    var words = root.children;
    if (words.length < 2) return;
    var index = 0;
    var timer = null;

    function step() {
      words[index].setAttribute("aria-current", "false");
      index = (index + 1) % words.length;
      words[index].setAttribute("aria-current", "true");
    }

    function start() { if (!timer) timer = window.setInterval(step, INTERVAL); }
    function stop() { window.clearInterval(timer); timer = null; }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });
    start();
  }

  function init() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var roots = document.querySelectorAll("[data-rotator]");
    for (var i = 0; i < roots.length; i++) setup(roots[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* Hero carousel.

   Slides live side by side in a flex track; moving between them is a single
   translateX on the track. Autoplay is skipped entirely when the visitor prefers
   reduced motion, and pauses on hover, on keyboard focus, and when the tab is
   hidden. Without JS the track simply shows the first slide. */
(function () {
  var INTERVAL = 6000;

  function setup(root) {
    var track = root.querySelector("[data-carousel-track]");
    var slides = root.querySelectorAll("[data-carousel-track] > *");
    var dots = root.querySelectorAll("[data-carousel-dot]");
    var prev = root.querySelector("[data-carousel-prev]");
    var next = root.querySelector("[data-carousel-next]");
    if (!track || slides.length < 2) return;

    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var index = 0;
    var timer = null;

    function render() {
      track.style.transform = "translateX(" + (index * -100) + "%)";

      for (var i = 0; i < slides.length; i++) {
        slides[i].setAttribute("aria-hidden", i === index ? "false" : "true");
      }
      for (var j = 0; j < dots.length; j++) {
        dots[j].setAttribute("aria-current", j === index ? "true" : "false");
      }
    }

    function goTo(i) {
      index = (i + slides.length) % slides.length;
      render();
    }

    function start() {
      if (reduced || timer) return;
      timer = window.setInterval(function () { goTo(index + 1); }, INTERVAL);
    }

    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    }

    function restart() { stop(); start(); }

    if (prev) prev.addEventListener("click", function () { goTo(index - 1); restart(); });
    if (next) next.addEventListener("click", function () { goTo(index + 1); restart(); });

    for (var k = 0; k < dots.length; k++) {
      (function (target) {
        dots[target].addEventListener("click", function () { goTo(target); restart(); });
      })(k);
    }

    root.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") { goTo(index - 1); restart(); }
      else if (event.key === "ArrowRight") { goTo(index + 1); restart(); }
      else return;
      event.preventDefault();
    });

    root.addEventListener("mouseenter", stop);
    root.addEventListener("mouseleave", start);
    root.addEventListener("focusin", stop);
    root.addEventListener("focusout", start);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });

    /* Touch swipe — horizontal drags only, so vertical page scrolling is untouched. */
    var startX = null;
    var startY = null;
    root.addEventListener("touchstart", function (event) {
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      stop();
    }, { passive: true });

    root.addEventListener("touchend", function (event) {
      if (startX === null) return;
      var dx = event.changedTouches[0].clientX - startX;
      var dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) goTo(index + (dx < 0 ? 1 : -1));
      startX = null;
      startY = null;
      start();
    }, { passive: true });

    render();
    start();
  }

  function init() {
    var roots = document.querySelectorAll("[data-carousel]");
    for (var i = 0; i < roots.length; i++) setup(roots[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
