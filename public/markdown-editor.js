
function attachMarkdownEditor(container, { getValue, onSave, placeholder, renderPreview, previewClass }) {
  let editing = false;

  function openEditor() {
    if (editing) return;
    editing = true;
    container.classList.add("md-editor-active");

    const startValue = getValue() || "";
    const wrap = document.createElement("div");
    wrap.className = "md-editor";

    const toolbar = document.createElement("div");
    toolbar.className = "md-editor-toolbar";

    const textarea = document.createElement("textarea");
    textarea.className = "md-editor-textarea inline-edit-input";
    textarea.value = startValue;
    textarea.placeholder = placeholder || "";
    textarea.rows = 10;

    const preview = document.createElement("div");
    preview.className = `md-editor-preview ${previewClass || "addon-longdesc"} hidden`;

    function wrapSelection(before, after = before) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const selected = value.slice(start, end);
      // Only format highlighted text — no placeholder insertion.
      if (!selected) return;

      const innerWrapped = selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length;
      const outerStart = start - before.length;
      const outerEnd = end + after.length;
      const outerWrapped = outerStart >= 0 && value.slice(outerStart, start) === before && value.slice(end, outerEnd) === after;

      let next, cursorStart, cursorEnd;
      if (innerWrapped) {
        const unwrapped = selected.slice(before.length, selected.length - after.length);
        next = value.slice(0, start) + unwrapped + value.slice(end);
        cursorStart = start;
        cursorEnd = start + unwrapped.length;
      } else if (outerWrapped) {
        next = value.slice(0, outerStart) + selected + value.slice(outerEnd);
        cursorStart = outerStart;
        cursorEnd = outerStart + selected.length;
      } else {
        next = value.slice(0, start) + before + selected + after + value.slice(end);
        cursorStart = start + before.length;
        cursorEnd = cursorStart + selected.length;
      }

      textarea.value = next;
      textarea.focus();
      textarea.setSelectionRange(cursorStart, cursorEnd);
    }

    function prefixLines(marker, numbered = false) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = value.indexOf("\n", end);
      if (lineEnd === -1) lineEnd = value.length;

      const block = value.slice(lineStart, lineEnd);
      const lines = block.split("\n");
      const prefixed = lines.map((line, i) => (numbered ? `${i + 1}. ${line}` : `${marker}${line}`)).join("\n");

      textarea.value = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + prefixed.length);
    }

    function insertAtCursor(text, selectFrom, selectLen) {
      const start = textarea.selectionStart;
      const value = textarea.value;
      textarea.value = value.slice(0, start) + text + value.slice(start);
      textarea.focus();
      if (selectFrom !== undefined) {
        textarea.setSelectionRange(start + selectFrom, start + selectFrom + (selectLen || 0));
      } else {
        const pos = start + text.length;
        textarea.setSelectionRange(pos, pos);
      }
    }

    const buttons = [];
    const useForum = typeof window !== "undefined" && window.ForumEditor;
    if (!useForum) {
      buttons.push(
        { label: "B", title: "Bold", className: "md-editor-btn-bold", action: () => wrapSelection("**") },
        { label: "I", title: "Italic", className: "md-editor-btn-italic", action: () => wrapSelection("_") },
        { label: "H1", title: "Heading 1", action: () => prefixLines("# ") },
        { label: "H2", title: "Heading 2", action: () => prefixLines("## ") },
        { label: "H3", title: "Heading 3", action: () => prefixLines("### ") },
        { label: "• List", title: "Bullet list", action: () => prefixLines("- ") },
        { label: "1. List", title: "Numbered list", action: () => prefixLines("", true) },
        {
          label: "Table",
          title: "Insert table",
          action: () => insertAtCursor(
            "\n| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n",
            3, 8
          )
        },
        {
          label: "Link",
          title: "Insert link",
          action: () => {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selected = textarea.value.slice(start, end);
            if (!selected) return;
            const text = `[${selected}](https://)`;
            textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
            const urlStart = start + selected.length + 3;
            textarea.focus();
            textarea.setSelectionRange(urlStart, urlStart + 8);
          }
        },
        {
          label: "Image",
          title: "Insert image",
          action: () => insertAtCursor("![alt text](https://)", 12, 8)
        },
        {
          label: "Code",
          title: "Code block",
          action: () => {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selected = textarea.value.slice(start, end);
            if (selected.includes("\n") || !selected) {
              wrapSelection("```\n", "\n```");
            } else {
              wrapSelection("`");
            }
          }
        }
      );
    }

    buttons.forEach(({ label, title, className, action }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "md-editor-btn" + (className ? ` ${className}` : "");
      btn.title = title;
      btn.textContent = label;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", action);
      toolbar.appendChild(btn);
    });

    const tabs = document.createElement("div");
    tabs.className = "md-editor-tabs";
    const editTab = document.createElement("button");
    editTab.type = "button";
    editTab.className = "md-editor-tab active";
    editTab.textContent = "Edit";
    const previewTab = document.createElement("button");
    previewTab.type = "button";
    previewTab.className = "md-editor-tab";
    previewTab.textContent = "Preview";
    tabs.append(editTab, previewTab);

    function showEdit() {
      editTab.classList.add("active");
      previewTab.classList.remove("active");
      textarea.classList.remove("hidden");
      toolbar.classList.remove("hidden");
      preview.classList.add("hidden");
    }
    function showPreview() {
      previewTab.classList.add("active");
      editTab.classList.remove("active");
      textarea.classList.add("hidden");
      toolbar.classList.add("hidden");
      preview.classList.remove("hidden");
      renderPreview(preview, textarea.value);
    }
    editTab.addEventListener("mousedown", (e) => e.preventDefault());
    editTab.addEventListener("click", showEdit);
    previewTab.addEventListener("mousedown", (e) => e.preventDefault());
    previewTab.addEventListener("click", showPreview);

    const actions = document.createElement("div");
    actions.className = "md-editor-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-primary btn-sm";
    saveBtn.textContent = "Save";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-ghost btn-sm";
    cancelBtn.textContent = "Cancel";
    actions.append(saveBtn, cancelBtn);

    function close() {
      editing = false;
      container.classList.remove("md-editor-active");
      container.innerHTML = "";
      renderPreview(container, getValue() || "");
    }

    function closeWithConfirmIfDirty() {
      if (textarea.value.trim() !== (getValue() || "").trim()) {
        if (!confirm("Discard your unsaved changes to this description?")) return;
      }
      close();
    }

    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const value = textarea.value.trim();
      editing = false;
      container.classList.remove("md-editor-active");
      container.innerHTML = "";
      onSave(value);
    });
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWithConfirmIfDirty();
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeWithConfirmIfDirty(); }
    });

    wrap.append(tabs, toolbar, textarea, preview, actions);
    container.innerHTML = "";
    container.appendChild(wrap);

    // Use the shared forum editor (image upload, [[addon]] + @mention
    // autocomplete, galleries, video embeds) when it's available.
    if (useForum) {
      toolbar.innerHTML = "";
      window.ForumEditor.attach(textarea, toolbar, {
        onError: (message) => {
          if (window.toast && typeof window.toast.error === "function") window.toast.error(message);
        },
      });
    }

    const autoGrow = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    autoGrow();
    textarea.addEventListener("input", autoGrow);
    textarea.focus();
  }

  container.addEventListener("click", () => {
    if (!editing) openEditor();
  });

  return { close: () => { editing = false; }, isEditing: () => editing };
}
