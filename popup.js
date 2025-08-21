// popup.js - Handles popup UI and settings
class PopupManager {
    constructor() {
        this.initializeEventListeners();
        this.loadSettings();
        this.loadProcessedIssues();
    }

    initializeEventListeners() {
        // Tab switching
        document.querySelectorAll(".tab").forEach((tab) => {
            tab.addEventListener("click", (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Settings buttons
        document.getElementById("test-token").addEventListener("click", () => {
            this.testToken();
        });

        document
            .getElementById("save-settings")
            .addEventListener("click", () => {
                this.saveSettings();
            });

        // Auto-save on input change for emojis
        ["todo-emoji", "progress-emoji", "done-emoji"].forEach((id) => {
            document.getElementById(id).addEventListener("input", () => {
                this.saveSettings(false); // Silent save
            });
        });
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll(".tab").forEach((tab) => {
            tab.classList.toggle("active", tab.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll(".tab-content").forEach((content) => {
            content.classList.toggle("active", content.id === `${tabName}-tab`);
        });

        // Load activity when switching to activity tab
        if (tabName === "activity") {
            this.loadProcessedIssues();
        }
    }

    async loadSettings() {
        try {
            const settings = await this.sendMessage({ type: "GET_SETTINGS" });
            // debug log removed: loaded settings

            if (settings.githubToken) {
                document.getElementById("github-token").value =
                    settings.githubToken;
            }
            if (settings.projectOwner) {
                document.getElementById("project-owner").value =
                    settings.projectOwner;
            }
            if (settings.projectNumber) {
                document.getElementById("project-number").value =
                    settings.projectNumber;
            }

            // Load Project ID if saved
            if (settings.projectId) {
                document.getElementById("project-id").value =
                    settings.projectId;
            }

            // Update emojis if saved
            if (settings.todoEmoji) {
                document.getElementById("todo-emoji").value =
                    settings.todoEmoji;
            }
            if (settings.progressEmoji) {
                document.getElementById("progress-emoji").value =
                    settings.progressEmoji;
            }
            if (settings.doneEmoji) {
                document.getElementById("done-emoji").value =
                    settings.doneEmoji;
            }

            // Load allowed repos and apply-to-all
            if (settings.allowedRepos) {
                document.getElementById("allowed-repos").value =
                    settings.allowedRepos.join("\n");
            }
            document.getElementById("apply-to-all").checked = !!settings.applyToAll;

            // Load column IDs if saved
            if (settings.todoColumnId) {
                document.getElementById("todo-column-id").value =
                    settings.todoColumnId;
            }
            if (settings.inProgressColumnId) {
                document.getElementById("inprogress-column-id").value =
                    settings.inProgressColumnId;
            }
            if (settings.doneColumnId) {
                document.getElementById("done-column-id").value =
                    settings.doneColumnId;
            }

            // Load Status Field ID if saved
            if (settings.statusFieldId) {
                document.getElementById("status-field-id").value =
                    settings.statusFieldId;
            }

            this.updateStatus(settings);
        } catch (error) {
            // console.error removed: Error loading settings
        }
    }

    async saveSettings(showFeedback = true) {
        const settings = {
            githubToken: document.getElementById("github-token").value,
            projectOwner: document.getElementById("project-owner").value,
            projectNumber: document.getElementById("project-number").value,
            todoEmoji: document.getElementById("todo-emoji").value,
            progressEmoji: document.getElementById("progress-emoji").value,
            doneEmoji: document.getElementById("done-emoji").value,
            todoColumnId: document.getElementById("todo-column-id").value,
            inProgressColumnId: document.getElementById("inprogress-column-id")
                .value,
            doneColumnId: document.getElementById("done-column-id").value,
            statusFieldId: document.getElementById("status-field-id").value,
            projectId: document.getElementById("project-id").value,
            allowedRepos: document
                .getElementById("allowed-repos")
                .value.split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean),
            applyToAll: document.getElementById("apply-to-all").checked,
        };
        // debug log removed: settings

        try {
            await this.sendMessage({ type: "SAVE_SETTINGS", settings });

            if (showFeedback) {
                const button = document.getElementById("save-settings");
                const originalText = button.textContent;
                button.textContent = "Saved!";
                button.style.background = "#28a745";

                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = "";
                }, 2000);
            }

            this.updateStatus(settings);
        } catch (error) {
            // console.error removed: Error saving settings
        }
    }

    async testToken() {
        const token = document.getElementById("github-token").value;
        if (!token) {
            alert("Please enter a GitHub token first");
            return;
        }

        const button = document.getElementById("test-token");
        const originalText = button.textContent;
        button.textContent = "Testing...";
        button.disabled = true;

        try {
            const result = await this.sendMessage({
                type: "TEST_TOKEN",
                token,
            });

            if (result.valid) {
                button.textContent = `✓ Valid (${result.username})`;
                button.style.background = "#28a745";
                button.style.color = "white";
            } else {
                button.textContent = "✗ Invalid";
                button.style.background = "#dc3545";
                button.style.color = "white";
            }
        } catch (error) {
            button.textContent = "✗ Error";
            button.style.background = "#dc3545";
            button.style.color = "white";
        }

        setTimeout(() => {
            button.textContent = originalText;
            button.style.background = "";
            button.style.color = "";
            button.disabled = false;
        }, 3000);
    }

    updateStatus(settings) {
        const statusEl = document.getElementById("status");
        const statusTextEl = document.getElementById("status-text");

        const hasRequiredSettings =
            settings.githubToken &&
            settings.projectOwner &&
            settings.projectNumber;

        if (hasRequiredSettings) {
            statusEl.className = "status connected";
            statusTextEl.textContent = "Connected and ready";
        } else {
            statusEl.className = "status disconnected";
            statusTextEl.textContent = "Configuration required";
        }
    }

    async loadProcessedIssues() {
        try {
            const result = await chrome.storage.local.get(["processedIssues"]);
            const processedIssues = result.processedIssues || [];

            const container = document.getElementById("processed-issues");

            if (processedIssues.length === 0) {
                container.innerHTML = `
          <div class="empty-state">
            No issues processed yet.<br>
            React to issues with your configured emojis to see them here.
          </div>
        `;
                return;
            }

            container.innerHTML = processedIssues
                .map(
                    (issue) => `
        <div class="issue-item">
          <div class="issue-title">${this.escapeHtml(issue.title)}</div>
          <div class="issue-meta">
            <span>${issue.owner}/${issue.repo} #${issue.issueNumber}</span>
            <span class="issue-status ${issue.status.toLowerCase().replace(" ", "-")}">${issue.status}</span>
          </div>
          <div style="font-size: 11px; color: #6a737d; margin-top: 4px;">
            ${new Date(issue.processedAt).toLocaleString()}
          </div>
        </div>
      `,
                )
                .join("");
        } catch (error) {
            // console.error removed: Error loading processed issues
        }
    }

    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    sendMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, resolve);
        });
    }
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    new PopupManager();
});
