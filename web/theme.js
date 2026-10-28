// Applies a saved light/dark choice before first paint (a separate file so the CSP can forbid inline scripts).
try {
  var saved = localStorage.getItem("dcf-theme");
  if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
} catch (e) { /* storage unavailable: follow the OS setting */ }
