(function () {
  var links = document.querySelectorAll("[data-telegram]");
  for (var i = 0; i < links.length; i++) {
    links[i].href = TELEGRAM_URL;
    links[i].target = "_blank";
    links[i].rel = "noopener noreferrer";
  }

  var nodes = document.querySelectorAll(".reveal");
  if (!nodes.length) return;

  function show(el) {
    el.classList.add("is-in");
  }

  // Reveal as a block nears the viewport, including after a fast or anchor scroll.
  function scan() {
    var limit = window.innerHeight * 0.92;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].classList.contains("is-in")) continue;
      if (nodes[i].getBoundingClientRect().top < limit) show(nodes[i]);
    }
  }

  requestAnimationFrame(function () {
    requestAnimationFrame(scan);
  });
  window.addEventListener("scroll", scan, { passive: true });
  window.addEventListener("resize", scan);

  var header = document.querySelector(".nav");
  if (!header) return;

  function onScroll() {
    header.classList.toggle("is-stuck", window.scrollY > 8);
  }

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();
