
window.CubyzMigrationRulesCache = null;

async function loadRulesForFlow() {
    if (window.CubyzMigrationRulesCache) return window.CubyzMigrationRulesCache;
    const res = await fetch("migrations/cubyz-addon-migrations.json");
    if (!res.ok) throw new Error("Failed to load version list.");
    window.CubyzMigrationRulesCache = await res.json();
    return window.CubyzMigrationRulesCache;
}

function latestReleasedVersion(rules) {
    const released = rules.versions.filter((v) => v.released);
    return released[released.length - 1]?.version || "0.3.0";
}

// The version new projects should target: the `unreleased` channel when the
// rules define one, otherwise the newest tagged release.
function latestVersion(rules) {
    return rules.versions.some((v) => v.version === "unreleased")
        ? "unreleased"
        : latestReleasedVersion(rules);
}

window.showMigrationResults = function (summary, fromVersion, toVersion, cavesMissingLayer) {
    return new Promise((resolve) => {
        const modal = document.getElementById("migrationResultsModal");
        const body = document.getElementById("migrationResultsBody");
        if (!modal || !body) return resolve();

        const { appliedSteps = [], conflicts = [], unresolved = [], changes = [] } = summary || {};

        let html = fromVersion === toVersion
            ? `<p style="margin-top:0;">Imported at <strong>v${versionLabel(toVersion)}</strong>.</p>`
            : `<p style="margin-top:0;">Migrated project data from <strong>v${versionLabel(fromVersion)}</strong> to <strong>v${versionLabel(toVersion)}</strong>.</p>`;

        if (fromVersion !== toVersion) {
            const realChanges = changes.filter((c) => c.changeType !== "no_change");
            const noChangeNotes = changes.filter((c) => c.changeType === "no_change");

            html += `<div style="margin-bottom:14px;"><div style="font-weight:600; color:#aaa; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Changelog</div>`;
            if (realChanges.length) {
                const grouped = {};
                realChanges.forEach((c) => {
                    if (!grouped[c.category]) grouped[c.category] = [];
                    grouped[c.category].push(c);
                });
                html += Object.keys(grouped).map((cat) => {
                    const lines = grouped[cat].map((c) => {
                        let line;
                        if (c.changeType === "id_rename" || c.changeType === "id_merge") {
                            line = `${c.old} → ${c.new}${c.note ? ` (${c.note})` : ""}`;
                        } else if (c.changeType === "tag_rename") {
                            line = `${c.itemId}: ${c.note}`;
                        } else if (c.changeType === "field_rename") {
                            line = `${c.old} → ${c.new} (${c.note})`;
                        } else if (c.changeType === "removed_field") {
                            line = `${c.itemId}: ${c.old} → ${c.new} (${c.note})`;
                        } else if (c.changeType === "recipe_string_rename") {
                            line = `"${c.old}" → "${c.new}" (${c.note})`;
                        } else if (c.changeType === "block_entity_rename") {
                            line = c.note;
                        } else {
                            line = `${c.old} → ${c.new}${c.note ? ` (${c.note})` : ""}`;
                        }
                        return `<li>${line}</li>`;
                    }).join("");
                    return `<div style="margin-bottom:8px;"><div style="font-weight:600; font-size:13px; color:#ddd; margin-bottom:2px;">${cat}</div><ul style="margin:0; padding-left:18px; font-size:13px; color:#ccc;">${lines}</ul></div>`;
                }).join("");
            } else {
                html += `<p style="margin:0; font-size:13px; color:#888;">No changes were needed - versions are already compatible.</p>`;
            }
            html += `</div>`;

            if (noChangeNotes.length) {
                html += `<div style="margin-bottom:14px;"><div style="font-weight:600; color:#aaa; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">No Changes Needed</div>`;
                html += `<ul style="margin:0; padding-left:18px; font-size:13px; color:#888;">${noChangeNotes.map((n) => `<li>${n.note}</li>`).join("")}</ul></div>`;
            }
        }

        if (conflicts.length) {
            html += `<div style="margin-bottom:14px;"><div style="font-weight:600; color:#ff9800; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Needs Manual Review (${conflicts.length})</div>`;
            html += `<ul style="margin:0; padding-left:18px; font-size:13px; color:#ffcc80;">${conflicts.map((c) => `<li>${c.reason}</li>`).join("")}</ul></div>`;
        }

        if (unresolved.length) {
            html += `<div style="margin-bottom:0;"><div style="font-weight:600; color:var(--danger); font-size:12px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Known Gaps</div>`;
            html += `<ul style="margin:0; padding-left:18px; font-size:13px; color:#ff9999;">${unresolved.map((u) => `<li>${u.description}${u.reason ? ` <span style="color:#c77;">(${u.reason})</span>` : ""}</li>`).join("")}</ul></div>`;
        }

        if (cavesMissingLayer?.length) {
            html += `<div style="margin-bottom:0;"><div style="font-weight:600; color:var(--danger); font-size:12px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Cave Biomes Missing a Layer (${cavesMissingLayer.length})</div>`;
            html += `<ul style="margin:0; padding-left:18px; font-size:13px; color:#ff9999;">${cavesMissingLayer.map((id) => `<li><strong>${id}</strong> has no cave layer selected - it will never spawn in-game until you set one in the Biomes panel.</li>`).join("")}</ul></div>`;
        }

        body.innerHTML = html;
        modal.style.display = "flex";

        const done = () => { modal.style.display = "none"; resolve(); };
        document.getElementById("migrationResultsOkBtn").onclick = done;
    });
};

window.runMigrationAndShowResults = async function (projectData, fromVersion, toVersion, cavesMissingLayer) {
    try {
        const summary = await window.migrateProject(projectData, fromVersion, toVersion);
        await window.showMigrationResults(summary, fromVersion, toVersion, cavesMissingLayer);
        return summary;
    } catch (err) {
        alert(`Migration failed: ${err.message}`);
        return null;
    }
};

window.maybeOfferMigrationAfterLoad = async function (savedGameVersion) {
    try {
        const rules = await loadRulesForFlow();
        const latest = latestVersion(rules);
        if (!savedGameVersion || savedGameVersion === latest) return;
        if (versionIdxForFlow(rules, savedGameVersion) === -1) return;

        const banner = document.getElementById("migrationOfferBanner");
        const text = document.getElementById("migrationOfferText");
        if (!banner || !text) return;

        text.textContent = `This project was made for version ${savedGameVersion} - would you like to update it to ${latest}?`;
        banner.style.display = "flex";

        const dismiss = () => { banner.style.display = "none"; };
        document.getElementById("migrationOfferYesBtn").onclick = async () => {
            dismiss();
            await window.runMigrationAndShowResults(window.projectData, savedGameVersion, latest);
            if (typeof window.updateSidebarProjectTree === "function") window.updateSidebarProjectTree();
            if (typeof window.markFormAsDirty === "function") window.markFormAsDirty();
        };
        document.getElementById("migrationOfferNoBtn").onclick = dismiss;
    } catch (_) {
    }
};

function versionIdxForFlow(rules, version) {
    return rules.versions.findIndex((v) => v.version === version);
}

window.openUpdateVersionPicker = function (currentVersion) {
    return new Promise(async (resolve) => {
        const modal = document.getElementById("updateVersionPickerModal");
        const select = document.getElementById("updateVersionPickerSelect");
        const label = document.getElementById("updateVersionPickerCurrent");
        if (!modal || !select) return resolve(null);

        let rules;
        try {
            rules = await loadRulesForFlow();
        } catch (err) {
            alert(`Couldn't load version list: ${err.message}`);
            return resolve(null);
        }

        const latest = latestVersion(rules);
        const choices = rules.versions.filter((v) => v.released || v.version === "unreleased");
        select.innerHTML = choices.map((v) =>
            `<option value="${v.version}" ${v.version === latest ? "selected" : ""}>${versionLabel(v.version)}</option>`
        ).join("");
        if (label) label.textContent = versionLabel(currentVersion) || "unknown";

        modal.style.display = "flex";

        const cleanup = () => { modal.style.display = "none"; };
        document.getElementById("updateVersionPickerCancelBtn").onclick = () => { cleanup(); resolve(null); };
        document.getElementById("updateVersionPickerGoBtn").onclick = () => { cleanup(); resolve(select.value); };
    });
};

window.startManualVersionUpdate = async function () {
    const from = window.VERSION_PATH || "unreleased";
    const target = await window.openUpdateVersionPicker(from);
    if (!target) return;
    if (target === from) {
        alert(`Project is already at v${versionLabel(from)}.`);
        return;
    }
    const cavesMissingLayer = (window.projectData?.biomes || [])
        .filter((b) => b.isCave && !b.caveLayerTag)
        .map((b) => b.id);
    await window.runMigrationAndShowResults(window.projectData, from, target, cavesMissingLayer);
    window.VERSION_PATH = target;
    if (typeof window.updateSidebarProjectTree === "function") window.updateSidebarProjectTree();
    if (typeof window.markFormAsDirty === "function") window.markFormAsDirty();
};

window.showPostImportChoice = function (sourceVersion) {
    return new Promise((resolve) => {
        const modal = document.getElementById("postImportChoiceModal");
        const msg = document.getElementById("postImportChoiceMessage");
        if (!modal || !msg) return resolve();

        msg.textContent = `Imported as v${versionLabel(sourceVersion)}. What would you like to do?`;
        modal.style.display = "flex";

        const cleanup = () => { modal.style.display = "none"; };
        document.getElementById("postImportChoiceEditBtn").onclick = () => { cleanup(); resolve(); };
        document.getElementById("postImportChoiceUpdateBtn").onclick = async () => {
            cleanup();
            window.VERSION_PATH = sourceVersion;
            await window.startManualVersionUpdate();
            resolve();
        };
    });
};

window.dismissStartModal = function () {
    const modal = document.getElementById("startModal");
    if (modal) modal.style.display = "none";
    document.querySelector(".toolbar-container-block")?.style.removeProperty("display");
    const workspaceRow = document.getElementById("creatorWorkspaceRow");
    if (workspaceRow) workspaceRow.style.display = "flex";
};

async function populateStartModalVersionPicker() {
    const select = document.getElementById("startNewAddonVersion");
    if (!select) return;
    try {
        const rules = await loadRulesForFlow();
        const choices = rules.versions.filter((v) => v.released || v.version === "unreleased");
        const latest = latestVersion(rules);
        select.innerHTML = choices.map((v) =>
            `<option value="${v.version}" ${v.version === latest ? "selected" : ""}>${versionLabel(v.version)}</option>`
        ).join("");
    } catch (_) {
        select.innerHTML = `<option value="unreleased">0.4.0 (unreleased)</option>`;
    }
}

window.startModalChooseNew = function () {
    if (typeof window.clearCreatorDraft === "function") window.clearCreatorDraft();
    const select = document.getElementById("startNewAddonVersion");
    window.VERSION_PATH = select?.value || "unreleased";
    window.dismissStartModal();
};

window.startModalChooseLoad = function () {
    document.getElementById("startModal").style.display = "none";
    window.openCloudSaveModal(true);
};

window.startModalChooseImport = function () {
    window.dismissStartModal();
    document.getElementById("importAddonFile")?.click();
};

window.showStartModal = function () {
    const modal = document.getElementById("startModal");
    if (modal) modal.style.display = "flex";
    document.querySelector(".toolbar-container-block")?.style.setProperty("display", "none");
    const workspaceRow = document.getElementById("creatorWorkspaceRow");
    if (workspaceRow) workspaceRow.style.display = "none";
};

document.addEventListener("DOMContentLoaded", () => {
    populateStartModalVersionPicker();
    window.showStartModal();
});
