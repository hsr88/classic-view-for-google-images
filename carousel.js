const track = document.querySelector("[data-carousel-track]");

if (track) {
  const slides = [...track.querySelectorAll(".carousel-slide")];
  const previous = document.querySelector("[data-carousel-prev]");
  const next = document.querySelector("[data-carousel-next]");
  const current = document.querySelector("[data-carousel-current]");
  const dots = [...document.querySelectorAll("[data-carousel-dot]")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeIndex = 0;

  const update = (index) => {
    activeIndex = Math.max(0, Math.min(index, slides.length - 1));
    current.textContent = String(activeIndex + 1);
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === slides.length - 1;

    dots.forEach((dot, dotIndex) => {
      dot.setAttribute("aria-current", String(dotIndex === activeIndex));
    });
  };

  const goTo = (index) => {
    slides[index]?.scrollIntoView({
      behavior: reduceMotion.matches ? "auto" : "smooth",
      block: "nearest",
      inline: "start",
    });
    update(index);
  };

  previous.addEventListener("click", () => goTo(activeIndex - 1));
  next.addEventListener("click", () => goTo(activeIndex + 1));

  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => goTo(index));
  });

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visible) {
        update(slides.indexOf(visible.target));
      }
    },
    { root: track, threshold: [0.6] },
  );

  slides.forEach((slide) => observer.observe(slide));
  update(0);
}
