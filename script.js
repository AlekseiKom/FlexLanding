/* ============================================================
   Global IT-Concierge — script.js
   Шапка / мобильное меню / reveal / параллакс / счётчики
   Всё отключается при prefers-reduced-motion: reduce.
   ============================================================ */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches;

  /* ---------- Шапка: фон при скролле ---------- */
  var header = document.querySelector('.site-header');
  function onScroll() {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 24);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Мобильное меню (бургер) ---------- */
  var burger = document.querySelector('.burger');
  function setNav(open) {
    document.body.classList.toggle('nav-open', open);
    if (burger) burger.setAttribute('aria-expanded', String(open));
  }
  if (burger) {
    burger.addEventListener('click', function () {
      setNav(!document.body.classList.contains('nav-open'));
    });
    document.querySelectorAll('.main-nav a').forEach(function (a) {
      a.addEventListener('click', function () { setNav(false); });
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setNav(false);
    });
  }

  /* ---------- Появление секций (reveal) ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reducedMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Параллакс при скролле ([data-parallax]) ---------- */
  var parallaxEls = Array.prototype.slice.call(
    document.querySelectorAll('[data-parallax]')
  );
  function updateParallax() {
    if (reducedMotion || !parallaxEls.length) return;
    var vh = window.innerHeight;
    for (var i = 0; i < parallaxEls.length; i++) {
      var el = parallaxEls[i];
      var rect = el.getBoundingClientRect();
      if (rect.bottom < -80 || rect.top > vh + 80) continue;
      var progress = (vh - rect.top) / (vh + rect.height); // 0..1 через экран
      var speed = parseFloat(el.getAttribute('data-parallax')) || 0.05;
      el.style.transform = 'translate3d(0,' + ((progress - 0.5) * speed * vh).toFixed(2) + 'px,0)';
    }
  }

  /* ---------- Параллакс по мыши (цветные пятна) ---------- */
  var mouseEls = Array.prototype.slice.call(
    document.querySelectorAll('.blob-wrap[data-mouse]')
  );
  function updateMouseParallax() {
    if (!mouseEls.length || reducedMotion || !finePointer) return;
    for (var j = 0; j < mouseEls.length; j++) {
      var el2 = mouseEls[j];
      var r = el2.parentElement.getBoundingClientRect();
      var cx = window.innerWidth / 2 - (r.left + r.width / 2);
      var cy = window.innerHeight / 2 - (r.top + r.height / 2);
      el2.style.setProperty('--mx', (cx / window.innerWidth).toFixed(4));
      el2.style.setProperty('--my', (cy / window.innerHeight).toFixed(4));
    }
  }

  /* ---------- Счётчики [data-count] ---------- */
  var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
  function runCounter(el) {
    var target = parseFloat(el.getAttribute('data-count')) || 0;
    var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var suffix = el.getAttribute('data-suffix') || '';
    if (reducedMotion) {
      el.textContent = target.toFixed(decimals).replace('.', ',') + suffix;
      return;
    }
    var start = null;
    var duration = 1800;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = (target * eased).toFixed(decimals).replace('.', ',') + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window && counters.length) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        runCounter(entry.target);
        cio.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { cio.observe(el); });
  } else {
    counters.forEach(runCounter);
  }

  /* ---------- Один rAF-цикл для параллаксов ---------- */
  var ticking = false;
  function onFrame() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      updateParallax();
      updateMouseParallax();
      ticking = false;
    });
  }
  window.addEventListener('scroll', onFrame, { passive: true });
  window.addEventListener('resize', onFrame);
  document.addEventListener('mousemove', onFrame, { passive: true });
  onFrame();

  /* ---------- Год в футере ---------- */
  var yearEl = document.getElementById('yearNow');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
