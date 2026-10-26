/* subscription/: confirm or cancel a waitlist signup from an emailed link.

   Nothing happens on page load. The visitor presses the button, then the token from the
   link is posted to the API. This keeps link-scanning mail filters from confirming or
   unsubscribing people. Same ES5 style as main.js. */
(function () {
  var LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var API = LOCAL ? "http://localhost:8080" : "https://api.eduneko.cloud";

  // Where each product's "see what's new" link points, relative to this page.
  var PRODUCT_PAGES = { edunotes: "../edunotes/", gliff: "../#gliff", numerals: "../numerals/" };
  var PRODUCT_NAMES = { edunotes: "EduNotes", gliff: "Gliff", numerals: "Numerals" };

  var params = new URLSearchParams(location.search);
  var confirmToken = params.get("confirm");
  var unsubId = params.get("unsubscribe");
  var unsubSig = params.get("sig");

  var title = document.querySelector("[data-title]");
  var message = document.querySelector("[data-message]");
  var button = document.querySelector("[data-action]");
  var status = document.querySelector("[data-form-status]");
  var next = document.querySelector("[data-next]");

  function setStatus(text, kind) {
    status.className = "form-status" + (kind ? " is-" + kind : "");
    status.textContent = text;
  }

  function finish(heading, text, product) {
    title.textContent = heading;
    message.textContent = text;
    button.hidden = true;
    setStatus("");
    var link = next.querySelector("a");
    if (product && PRODUCT_PAGES[product]) {
      link.href = PRODUCT_PAGES[product];
      link.textContent = "Back to " + PRODUCT_NAMES[product];
    }
    next.hidden = false;
  }

  function post(path, data, onSuccess) {
    button.disabled = true;
    setStatus("Working…");
    fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.ok) {
          onSuccess(body);
        } else {
          var text = body.error || "Something went wrong.";
          setStatus(text.charAt(0).toUpperCase() + text.slice(1) + ".", "error");
          next.hidden = false;
        }
      });
    }, function () {
      setStatus("We couldn't reach our server. Please try again in a moment.", "error");
    }).then(function () {
      button.disabled = false;
    });
  }

  if (confirmToken) {
    title.textContent = "Confirm your signup";
    message.textContent = "Press the button to confirm that you'd like to hear from us. We'll only email you about the product you signed up for.";
    button.textContent = "Confirm my signup";
    button.hidden = false;
    button.addEventListener("click", function () {
      post("/signups/confirm", { token: confirmToken }, function (body) {
        finish("You're on the list",
          "Thanks for confirming. We'll email you about " + (body.name || "it") + " when there's news, and we've sent a welcome email with an unsubscribe link.",
          body.product);
      });
    });
  } else if (unsubId && unsubSig) {
    title.textContent = "Unsubscribe";
    message.textContent = "Press the button to stop receiving emails about this product. We'll delete your address within 30 days.";
    button.textContent = "Unsubscribe me";
    button.hidden = false;
    button.addEventListener("click", function () {
      post("/signups/unsubscribe", { id: unsubId, sig: unsubSig }, function (body) {
        finish("You're unsubscribed",
          "You won't receive any more emails" + (body.name ? " about " + body.name : "") + ". Changed your mind? You can sign up again anytime.",
          body.product);
      });
    });
  } else {
    next.hidden = false;
  }
})();
