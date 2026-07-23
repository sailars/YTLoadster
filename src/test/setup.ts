import "@testing-library/jest-dom/vitest";

Object.defineProperty(window.navigator, "language", {
  configurable: true,
  get: () => "ru-RU",
});

Object.defineProperty(window.navigator, "languages", {
  configurable: true,
  get: () => ["ru-RU"],
});
