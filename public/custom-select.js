const openInstances = new Set();

export { openInstances, closeOthers };

function closeOthers(el, ownClose) {
  openInstances.forEach((entry) => {
    if (entry.close === ownClose) return;
    if (entry.el && el && entry.el.contains(el)) return;
    entry.close();
  });
}

export function enhanceSelect(selectEl, { labelPrefix } = {}) {
  if (!selectEl || selectEl.dataset.enhanced) return;
  selectEl.dataset.enhanced = "1";

  const wrapper = document.createElement("div");
  wrapper.className = "custom-select";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger " + selectEl.className;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  let prefixEl = null;
  if (labelPrefix) {
    prefixEl = document.createElement("span");
    prefixEl.className = "custom-select-label-prefix";
    prefixEl.textContent = labelPrefix;
  }

  const label = document.createElement("span");
  label.className = "custom-select-label";

  const arrow = document.createElement("span");
  arrow.className = "custom-select-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "▾";

  if (prefixEl) trigger.append(prefixEl, label, arrow);
  else trigger.append(label, arrow);

  const listbox = document.createElement("div");
  listbox.className = "custom-select-list";
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;

  function optionsFromSelect() {
    return Array.from(selectEl.options);
  }

  function syncLabel() {
    const selected = selectEl.options[selectEl.selectedIndex];
    label.textContent = selected ? selected.textContent : "";
  }

  function renderList() {
    listbox.innerHTML = "";
    optionsFromSelect().forEach((opt) => {
      const item = document.createElement("div");
      item.className = "custom-select-option";
      item.setAttribute("role", "option");
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;
      if (opt.value === selectEl.value) {
        item.setAttribute("aria-selected", "true");
        item.classList.add("active");
      }
      item.addEventListener("click", () => {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        syncLabel();
        closeList();
      });
      listbox.appendChild(item);
    });
  }

  const selfEntry = { close: closeList, el: wrapper };

  function openList() {
    closeOthers(wrapper, closeList);
    renderList();
    listbox.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    openInstances.add(selfEntry);
  }

  function closeList() {
    listbox.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    openInstances.delete(selfEntry);
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (listbox.hidden) openList();
    else closeList();
  });

  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) closeList();
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeList();
  });

  selectEl.addEventListener("change", syncLabel);
  // Let callers refresh the trigger label after programmatically setting the
  // native select's value (used by the forum filters).
  selectEl._syncCustomLabel = syncLabel;

  syncLabel();
  selectEl.hidden = true;
  if (selectEl.id) wrapper.id = selectEl.id + "-wrapper";
  selectEl.insertAdjacentElement("afterend", wrapper);
  wrapper.append(trigger, listbox);
}
