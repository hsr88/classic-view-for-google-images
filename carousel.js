const carousel = document.querySelector("[data-carousel]");

if (carousel) {
  const track = carousel.querySelector("[data-carousel-track]");
  const viewport = carousel.querySelector("[data-carousel-viewport]");
  const slides = [...carousel.querySelectorAll("[data-carousel-slide]")];
  const dots = [...carousel.querySelectorAll("[data-carousel-dot]")];
  const previous = carousel.querySelector("[data-carousel-prev]");
  const next = carousel.querySelector("[data-carousel-next]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let index = 0;
  let timer;

  const show = (nextIndex) => {
    index = (nextIndex + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    slides.forEach((slide, slideIndex) => slide.setAttribute("aria-hidden", String(slideIndex !== index)));
    dots.forEach((dot, dotIndex) => dot.setAttribute("aria-current", String(dotIndex === index)));
  };

  const stop = () => window.clearTimeout(timer);
  const start = () => {
    stop();
    if (!reduceMotion.matches) {
      timer = window.setTimeout(() => {
        show(index + 1);
        start();
      }, 3200);
    }
  };

  previous.addEventListener("click", () => { show(index - 1); start(); });
  next.addEventListener("click", () => { show(index + 1); start(); });
  dots.forEach((dot, dotIndex) => dot.addEventListener("click", () => { show(dotIndex); start(); }));
  carousel.addEventListener("mouseenter", stop);
  carousel.addEventListener("mouseleave", start);
  carousel.addEventListener("focusin", stop);
  carousel.addEventListener("focusout", (event) => { if (!carousel.contains(event.relatedTarget)) start(); });
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  reduceMotion.addEventListener("change", start);

  let touchStart = 0;
  viewport.addEventListener("touchstart", (event) => { touchStart = event.changedTouches[0].clientX; stop(); }, { passive: true });
  viewport.addEventListener("touchend", (event) => {
    const distance = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(distance) > 45) show(index + (distance < 0 ? 1 : -1));
    start();
  }, { passive: true });

  show(0);
  start();
}
