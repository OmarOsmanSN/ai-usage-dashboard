// Applies the saved theme before first paint. Default: follow the OS.
(function () {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.dataset.theme = t;
    }
  } catch {
    // Storage blocked: stay on the OS setting.
  }
})();
