(() => {
  const iconMap = {
    "bi-activity": "activity", "bi-arrow-down-circle": "arrow-down-circle", "bi-arrow-right": "arrow-right",
    "bi-arrow-up-circle": "arrow-up-circle", "bi-award": "award", "bi-bag": "shopping-bag",
    "bi-bell": "bell", "bi-box-arrow-right": "log-out", "bi-box-seam": "package",
    "bi-camera": "camera", "bi-cart3": "shopping-cart", "bi-cart-check": "circle-check-big",
    "bi-cart-plus": "cart-plus", "bi-cash-stack": "banknote", "bi-check-circle": "circle-check",
    "bi-check-lg": "check", "bi-check2-circle": "circle-check-big", "bi-clipboard": "clipboard",
    "bi-clock-history": "history", "bi-collection": "layers", "bi-exclamation-triangle": "triangle-alert",
    "bi-gear": "settings", "bi-graph-up": "chart-line", "bi-graph-up-arrow": "chart-line",
    "bi-grid": "layout-dashboard", "bi-hourglass-split": "hourglass", "bi-inbox": "inbox",
    "bi-journal-text": "notebook-tabs", "bi-list-ul": "list", "bi-lock": "lock-keyhole",
    "bi-pencil": "pencil", "bi-people": "users", "bi-person": "user-round", "bi-phone": "smartphone",
    "bi-plus-circle": "circle-plus", "bi-plus-circle-fill": "circle-plus", "bi-plus-lg": "plus",
    "bi-printer": "printer", "bi-receipt": "receipt", "bi-search": "search", "bi-shop": "store",
    "bi-sliders": "sliders-horizontal", "bi-tags": "tags", "bi-trash": "trash-2",
    "bi-trophy": "trophy", "bi-trophy-fill": "trophy", "bi-truck": "truck", "bi-upc-scan": "scan-barcode",
    "bi-wallet2": "wallet-cards", "bi-x-circle": "circle-x", "bi-x-lg": "x"
  };

  function iconName(element) {
    return [...element.classList].find((className) => className.startsWith("bi-") && iconMap[className])
      ? iconMap[[...element.classList].find((className) => className.startsWith("bi-") && iconMap[className])]
      : "circle";
  }

  function hydrateLegacyIcons(root = document) {
    root.querySelectorAll?.("i.bi").forEach((legacyIcon) => {
      const replacement = document.createElement("i");
      replacement.setAttribute("data-lucide", iconName(legacyIcon));
      replacement.className = [...legacyIcon.classList].filter((className) => className !== "bi" && !className.startsWith("bi-")).join(" ");
      replacement.setAttribute("aria-hidden", "true");
      legacyIcon.replaceWith(replacement);
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    hydrateLegacyIcons();
    window.lucide?.createIcons();
  });
})();
