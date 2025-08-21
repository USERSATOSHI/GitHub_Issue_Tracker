// background.js - Handles GitHub API calls and project board management
class GitHubTracker {
    constructor() {
        this.apiBase = "https://api.github.com";
        this.setupMessageListener();
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener(
            (message, sender, sendResponse) => {
                // console.log removed

                if (message.type === "REACTION_DETECTED") {
                    this.handleReaction(message.issueInfo, message.reactions);
                } else if (message.type === "GET_SETTINGS") {
                    this.getSettings().then(sendResponse);
                    return true;
                } else if (message.type === "SAVE_SETTINGS") {
                    this.saveSettings(message.settings).then(() => {
                        sendResponse({ success: true });
                    });
                    return true;
                } else if (message.type === "TEST_TOKEN") {
                    this.testGitHubToken(message.token).then(sendResponse);
                    return true;
                } else if (message.type === "ADD_TO_PROJECT") {
                    // New explicit command to add issue to project
                    this.addIssueExplicitly(
                        message.issueInfo,
                        message.targetStatus, // "Todo" | "In Progress" | "Done"
                    ).then(sendResponse);
                    return true;
                }
            },
        );
    }

    async addIssueExplicitly(issueInfo, status) {
        const settings = await this.getSettings();

        if (
            !settings.githubToken ||
            !settings.projectNumber ||
            !settings.statusFieldId
        ) {
            return { success: false, error: "GitHub settings not configured" };
        }

        // Map human-readable status → optionId (from settings)
        let optionId = null;
        if (status === "Todo") optionId = settings.todoColumnId;
        else if (status === "In Progress")
            optionId = settings.inProgressColumnId;
        else if (status === "Done") optionId = settings.doneColumnId;

        if (!optionId) {
            return {
                success: false,
                error: `No optionId found for status: ${status}`,
            };
        }

            try {
            // debug log removed: adding issue to project
            const addResult = await this.addIssueToProject(
                issueInfo,
                optionId,
                settings,
            );

            // debug log removed: addResult

            const itemId =
                addResult?.data?.updateProjectV2ItemFieldValue?.projectV2Item
                    ?.id;
            if (!itemId) {
                return {
                    success: false,
                    error: "Failed to add issue to project",
                };
            }

            // Track for popup display
            await this.storeProcessedIssue(issueInfo, status);
            if (chrome && chrome.tabs && issueInfo.url) {
                chrome.tabs.query({ url: issueInfo.url }, (tabs) => {
                    if (tabs && tabs.length > 0) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: "SHOW_TOAST",
                            status,
                            issueInfo,
                        });
                    }
                });
            }
            return { success: true, itemId, status };
            } catch (err) {
            // console.error removed: Error in addIssueExplicitly
            return { success: false, error: err.message };
        }
    }

    async getSettings() {
        const result = await chrome.storage.sync.get([
            "githubToken",
            "projectOwner",
            "projectNumber",
            "todoColumnId",
            "inProgressColumnId",
            "doneColumnId",
            "todoEmoji",
            "progressEmoji",
            "doneEmoji",
            "statusFieldId",
            "projectId",
			"allowedRepos",
			"applyToAll"
        ]);
        return result;
    }

    async saveSettings(settings) {
        // debug log removed: settings
        await chrome.storage.sync.set(settings);
    }

    async testGitHubToken(token) {
        try {
            const response = await fetch(`${this.apiBase}/user`, {
                headers: {
                    Authorization: `token ${token}`,
                    Accept: "application/vnd.github.v3+json",
                },
            });

            if (response.ok) {
                const user = await response.json();
                return { valid: true, username: user.login };
            } else {
                return { valid: false, error: "Invalid token" };
            }
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    async handleReaction(issueInfo, reactions) {
        try {
            const settings = await this.getSettings();

            // debug log removed: handleReaction called with issueInfo, reactions, settings

            if (
                !settings.githubToken ||
                !settings.projectOwner ||
                !settings.projectNumber
            ) {
                // debug log removed: settings not configured
                return;
            }

            // Determine which column to move to based on reactions
            let targetColumnId = null;
            let status = null;

            if (reactions.done && settings.doneColumnId) {
                targetColumnId = settings.doneColumnId;
                status = "Done";
            } else if (reactions.inProgress && settings.inProgressColumnId) {
                targetColumnId = settings.inProgressColumnId;
                status = "In Progress";
            } else if (reactions.todo && settings.todoColumnId) {
                targetColumnId = settings.todoColumnId;
                status = "Todo";
            }

            // debug log removed: reaction status

            if (targetColumnId) {
                await this.moveIssueToProject(
                    issueInfo,
                    targetColumnId,
                    status,
                    settings,
                );
            } else {
                // debug log removed: no target column matched for reactions
            }
        } catch (error) {
            // console.error removed: GitHub Tracker error
        }
    }

    async moveIssueToProject(issueInfo, columnId, status, settings) {
        try {
            // First, check if issue is already in the project
            const existingItem = await this.findProjectItem(
                issueInfo,
                settings,
            );

            let itemId = null;
            if (existingItem) {
                // Update existing item (set status field)
                itemId = existingItem.id;
                await this.updateProjectItem(itemId, columnId, settings);
                // debug log removed: moved issue to status
            } else {
                // Add new item to project
                const addResult = await this.addIssueToProject(
                    issueInfo,
                    columnId,
                    settings,
                );
                // Try to extract itemId from GraphQL response
                itemId = addResult?.data?.addProjectV2ItemById?.item?.id;
                // debug log removed: added issue to project
            }

            // For GitHub Projects (beta): Set the Status field if statusFieldId is present
            if (itemId && settings.statusFieldId && columnId) {
                await this.setProjectStatusField(
                    settings.projectNumber,
                    itemId,
                    settings.statusFieldId,
                    columnId,
                    settings,
                );
                // debug log removed: set status field for issue
            }

            // Store in local storage for popup display
            await this.storeProcessedIssue(issueInfo, status);
            // debug log removed: issueInfo
            // Send feedback to content script (toast)
            // Find the tab with the issue URL and send a message
            if (chrome && chrome.tabs && issueInfo.url) {
                chrome.tabs.query({ url: issueInfo.url }, (tabs) => {
                    if (tabs && tabs.length > 0) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: "SHOW_TOAST",
                            status,
                            issueInfo,
                        });
                    }
                });
            }
        } catch (error) {
            // console.error removed: Error moving issue to project
        }
    }

    async findProjectItem(issueInfo, settings) {
        // This is a simplified version - in practice, you'd need to query the project items
        // GitHub's GraphQL API would be better for this, but REST API is simpler to set up
        return null; // For now, always add as new item
    }

    async addIssueToProject(issueInfo, columnId, settings) {
        // Step 1: get the issue's nodeId
        const issueNodeId = await this.getIssueNodeId(issueInfo, settings);

        // Step 2: add the issue to the project
        const addMutation = `
          mutation {
            addProjectV2ItemById(input: {
              projectId: "${settings.projectId}"
              contentId: "${issueNodeId}"
            }) {
              item {
                id
              }
            }
          }
        `;

        const addResponse = await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${settings.githubToken}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: addMutation }),
        });

        const addResult = await addResponse.json();
        if (addResult.errors) {
            // console.error removed: Error adding issue to project
            return addResult;
        }

        const itemId = addResult.data.addProjectV2ItemById.item.id;

        // Step 3: update the item's status field → TODO
        // You'll need to hardcode or load these from settings
        const statusFieldId = settings.statusFieldId; // "Status" field ID

        const updateMutation = `
          mutation {
            updateProjectV2ItemFieldValue(input: {
              projectId: "${settings.projectId}"
              itemId: "${itemId}"
              fieldId: "${statusFieldId}"
              value: { singleSelectOptionId: "${columnId}" }
            }) {
              projectV2Item {
                id
              }
            }
          }
        `;

        const updateResponse = await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${settings.githubToken}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: updateMutation }),
        });

        return updateResponse.json();
    }

    async getIssueNodeId(issueInfo, settings) {
        const response = await fetch(
            `${this.apiBase}/repos/${issueInfo.owner}/${issueInfo.repo}/issues/${issueInfo.issueNumber}`,
            {
                headers: {
                    Authorization: `token ${settings.githubToken}`,
                    Accept: "application/vnd.github.v3+json",
                },
            },
        );

        const issue = await response.json();
    // debug log removed: issue
        return issue.node_id;
    }

    async updateProjectItem(itemId, columnId, settings) {
        // Implementation for updating project item status
        // This would use GraphQL mutations for the new Projects API
        // For Projects (beta), this is handled by setProjectStatusField
    }

    // Set the Status field for a project item (for Projects beta)
    async setProjectStatusField(
        projectId,
        itemId,
        statusFieldId,
        optionId,
        settings,
    ) {
        const mutation = `
          mutation {
            updateProjectV2ItemFieldValue(
              input: {
                projectId: "${projectId}"
                itemId: "${itemId}"
                fieldId: "${statusFieldId}"
                value: { singleSelectOptionId: "${optionId}" }
              }
            ) {
              projectV2Item {
                id
              }
            }
          }
        `;

        const response = await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
                Authorization: `token ${settings.githubToken}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: mutation }),
        });

        return response.json();
    }

    async storeProcessedIssue(issueInfo, status) {
        const timestamp = new Date().toISOString();
        const processedIssue = {
            ...issueInfo,
            status,
            processedAt: timestamp,
        };

        // Get existing processed issues
        const result = await chrome.storage.local.get(["processedIssues"]);
        const processedIssues = result.processedIssues || [];

        // Add new issue (keep only last 100)
        processedIssues.unshift(processedIssue);
        const trimmedIssues = processedIssues.slice(0, 100);

        await chrome.storage.local.set({ processedIssues: trimmedIssues });
    }
}

// Initialize the tracker
new GitHubTracker();
