export const NAV_ITEMS = [
  { key: "homework", label: "Homework", href: "/admin/homework" },
  { key: "timetable", label: "Timetable", href: "/admin/timetable" },
  { key: "appointments", label: "Appointments", href: "/admin/appointments" },
  { key: "tests", label: "Tests", href: "/admin/tests" },
  { key: "knowledge", label: "Knowledge", href: "/admin/knowledge" },
  { key: "groups", label: "Groups", href: "/admin/groups" },
];

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const q = (id) => document.getElementById(id);

export async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return response.json().catch(() => ({}));
}

export function normalizeOptional(value) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

export function valueOrEmpty(value) {
  return value == null ? "" : String(value);
}

export function createEmpty(message) {
  const el = document.createElement("div");
  el.className = "empty";
  el.textContent = message;
  return el;
}

export function setStatus(message, isError = false) {
  const statusEl = q("global-status");
  if (!statusEl) return;
  statusEl.classList.remove("hidden");
  statusEl.classList.toggle("error", isError);
  statusEl.textContent = message;
}

export function clearStatus() {
  const statusEl = q("global-status");
  if (!statusEl) return;
  statusEl.classList.add("hidden");
  statusEl.classList.remove("error");
  statusEl.textContent = "";
}

export async function withButtonBusy(button, fn) {
  if (!button) {
    return fn();
  }

  const prevDisabled = button.disabled;
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.disabled = prevDisabled;
  }
}

export async function ensureAuthenticated() {
  try {
    await api("/api/session");
    return true;
  } catch {
    return false;
  }
}

export async function initShell({ pageKey, title, subtitle, onRefresh }) {
  const authed = await ensureAuthenticated();
  if (!authed) {
    window.location.href = "/admin";
    return false;
  }

  const nav = q("sidebar-nav");
  if (nav) {
    nav.innerHTML = "";
    NAV_ITEMS.forEach((item) => {
      const link = document.createElement("a");
      link.className = `nav-link ${item.key === pageKey ? "active" : ""}`;
      link.href = item.href;
      link.textContent = item.label;
      nav.appendChild(link);
    });
  }

  const pageTitle = q("page-title");
  const pageSubtitle = q("page-subtitle");
  if (pageTitle) pageTitle.textContent = title;
  if (pageSubtitle) pageSubtitle.textContent = subtitle;

  const logoutBtn = q("logout-btn");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        await api("/api/logout", { method: "POST" });
      } finally {
        window.location.href = "/admin";
      }
    };
  }

  const refreshBtn = q("refresh-btn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      if (!onRefresh) return;
      try {
        await withButtonBusy(refreshBtn, onRefresh);
        setStatus("Refreshed.");
      } catch (error) {
        setStatus(error.message || "Refresh failed", true);
      }
    };
  }

  return true;
}

function createField(spec, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";

  const label = document.createElement("label");
  label.textContent = spec.label;
  wrapper.appendChild(label);

  let input;
  if (spec.type === "textarea") {
    input = document.createElement("textarea");
    input.value = valueOrEmpty(value);
    if (spec.rows) input.rows = spec.rows;
  } else if (spec.type === "select") {
    input = document.createElement("select");
    (spec.options || []).forEach((option) => {
      const optionEl = document.createElement("option");
      optionEl.value = String(option.value);
      optionEl.textContent = option.label;
      if (String(option.value) === String(value)) {
        optionEl.selected = true;
      }
      input.appendChild(optionEl);
    });
  } else {
    input = document.createElement("input");
    input.type = spec.type || "text";
    input.value = valueOrEmpty(value);
    if (spec.min != null) input.min = String(spec.min);
    if (spec.max != null) input.max = String(spec.max);
    if (spec.step != null) input.step = String(spec.step);
    if (spec.placeholder) input.placeholder = spec.placeholder;
  }

  wrapper.appendChild(input);

  if (spec.help) {
    const help = document.createElement("small");
    help.textContent = spec.help;
    wrapper.appendChild(help);
  }

  return { wrapper, input };
}

function readFieldValue(spec, input) {
  const raw = input.value;
  if (spec.type === "number") return Number(raw);
  if (spec.nullable) return normalizeOptional(raw);
  return raw.trim();
}

export function createRecordCard({ title, meta, badge, fields, onSave, onDelete, saveLabel = "Save", deleteLabel = "Delete" }) {
  const details = document.createElement("details");
  details.className = "record";

  const summary = document.createElement("summary");
  const main = document.createElement("div");
  main.className = "record-main";

  const titleEl = document.createElement("div");
  titleEl.className = "record-title";
  titleEl.textContent = title;
  main.appendChild(titleEl);

  const metaEl = document.createElement("div");
  metaEl.className = "record-meta";
  metaEl.textContent = meta;
  main.appendChild(metaEl);

  summary.appendChild(main);

  if (badge) {
    const badgeEl = document.createElement("span");
    badgeEl.className = `chip ${badge.className || ""}`;
    badgeEl.textContent = badge.label;
    summary.appendChild(badgeEl);
  }

  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "record-body";

  const form = document.createElement("div");
  form.className = fields.length > 2 ? "field-grid" : "grid";

  const inputs = {};
  fields.forEach((field) => {
    const built = createField(field, field.value);
    inputs[field.name] = built.input;
    form.appendChild(built.wrapper);
  });

  body.appendChild(form);

  const actions = document.createElement("div");
  actions.className = "record-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn-primary";
  saveBtn.textContent = saveLabel;
  saveBtn.onclick = async () => {
    try {
      const payload = {};
      fields.forEach((field) => {
        payload[field.name] = readFieldValue(field, inputs[field.name]);
      });
      await withButtonBusy(saveBtn, () => onSave(payload));
      setStatus("Saved.");
    } catch (error) {
      setStatus(error.message || "Save failed", true);
      return;
    }

    if (typeof details.onAfterChange === "function") {
      await details.onAfterChange();
    }
  };

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = "Reset";
  resetBtn.onclick = () => {
    fields.forEach((field) => {
      inputs[field.name].value = valueOrEmpty(field.value);
    });
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-danger";
  deleteBtn.textContent = deleteLabel;
  deleteBtn.onclick = async () => {
    if (!window.confirm(`Delete ${title}?`)) return;

    try {
      await withButtonBusy(deleteBtn, onDelete);
      setStatus("Deleted.");
    } catch (error) {
      setStatus(error.message || "Delete failed", true);
      return;
    }

    if (typeof details.onAfterChange === "function") {
      await details.onAfterChange();
    }
  };

  actions.appendChild(saveBtn);
  actions.appendChild(resetBtn);
  actions.appendChild(deleteBtn);
  body.appendChild(actions);
  details.appendChild(body);

  return details;
}

export function renderEditableList({ container, items, emptyMessage, filterText = "", getTitle, getMeta, getBadge, getFields, onSave, onDelete, onAfterChange }) {
  container.innerHTML = "";

  const query = String(filterText || "").trim().toLowerCase();
  const filtered = query
    ? items.filter((item) => {
      const text = `${getTitle(item)} ${getMeta(item)}`.toLowerCase();
      return text.includes(query);
    })
    : items;

  if (!filtered || filtered.length === 0) {
    container.appendChild(createEmpty(query ? "No matching entries." : emptyMessage));
    return;
  }

  filtered.forEach((item) => {
    const card = createRecordCard({
      title: getTitle(item),
      meta: getMeta(item),
      badge: getBadge ? getBadge(item) : null,
      fields: getFields(item),
      onSave: (payload) => onSave(item, payload),
      onDelete: () => onDelete(item),
    });

    card.onAfterChange = onAfterChange;
    container.appendChild(card);
  });
}
