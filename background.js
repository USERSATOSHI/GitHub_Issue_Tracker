// background.js - Handles GitHub API calls and project board management
class GitHubTracker {
	constructor() {
		this.apiBase = 'https://api.github.com';
		this.setupMessageListener();
	}

	setupMessageListener() {
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			if (message.type === 'REACTION_DETECTED') {
				this.handleReaction(message.issueInfo, message.reactions);
			} else if (message.type === 'GET_SETTINGS') {
				this.getSettings().then(sendResponse);
				return true;
			} else if (message.type === 'SAVE_SETTINGS') {
				this.saveSettings(message.settings).then(() => {
					sendResponse({ success: true });
				});
				return true;
			} else if (message.type === 'TEST_TOKEN') {
				this.testGitHubToken(message.token).then(sendResponse);
				return true;
			} else if (message.type === 'ADD_TO_PROJECT') {
				// New explicit command to add issue to project
				this.addIssueExplicitly(
					message.issueInfo,
					message.targetStatus, // "Todo" | "In Progress" | "Done"
				).then(sendResponse);
				return true;
			}
		});
	}

	async addIssueExplicitly(issueInfo, status) {
		const settings = await this.getSettings();

		if (!settings.githubToken || !settings.projectNumber || !settings.statusFieldId) {
			return { success: false, error: 'GitHub settings not configured' };
		}

		// Map human-readable status → optionId (from settings)
		let optionId = null;
		if (status === 'Todo') optionId = settings.todoColumnId;
		else if (status === 'In Progress') optionId = settings.inProgressColumnId;
		else if (status === 'Done') optionId = settings.doneColumnId;

		if (!optionId) {
			return {
				success: false,
				error: `No optionId found for status: ${status}`,
			};
		}

		try {
			// Check if issue is already in the project
			const existingItem = await this.findExistingProjectItem(issueInfo, settings);

			if (existingItem) {
				// If existingItem is in same status, no need to update
				if (existingItem.content && existingItem.currentStatusOptionId === optionId) {
					return {
						success: true,
						itemId: existingItem.id,
						status,
						updated: false,
					};
				}
				// Issue already exists in project, just update its status
				await this.updateProjectItemStatus(existingItem.id, optionId, settings);

				// Track for popup display
				await this.storeProcessedIssue(issueInfo, status);

				if (chrome && chrome.tabs && issueInfo.url) {
					chrome.tabs.query({ url: issueInfo.url }, tabs => {
						if (tabs && tabs.length > 0) {
							chrome.tabs.sendMessage(tabs[0].id, {
								type: 'SHOW_TOAST',
								status,
								issueInfo,
							});
						}
					});
				}

				return {
					success: true,
					itemId: existingItem.id,
					status,
					updated: true,
				};
			}

			// Issue doesn't exist, add it to project
			const addResult = await this.addIssueToProject(issueInfo, optionId, settings);

			const itemId = addResult?.data?.updateProjectV2ItemFieldValue?.projectV2Item?.id;
			if (!itemId) {
				return {
					success: false,
					error: 'Failed to add issue to project',
				};
			}

			// Track for popup display
			await this.storeProcessedIssue(issueInfo, status);
			if (chrome && chrome.tabs && issueInfo.url) {
				chrome.tabs.query({ url: issueInfo.url }, tabs => {
					if (tabs && tabs.length > 0) {
						chrome.tabs.sendMessage(tabs[0].id, {
							type: 'SHOW_TOAST',
							status,
							issueInfo,
						});
					}
				});
			}
			return { success: true, itemId, status, added: true };
		} catch (err) {
			return { success: false, error: err.message };
		}
	}

	async getSettings() {
		const result = await chrome.storage.sync.get([
			'githubToken',
			'projectOwner',
			'projectNumber',
			'todoColumnId',
			'inProgressColumnId',
			'doneColumnId',
			'todoEmoji',
			'progressEmoji',
			'doneEmoji',
			'statusFieldId',
			'projectId',
			'allowedRepos',
			'applyToAll',
		]);
		return result;
	}

	async saveSettings(settings) {
		await chrome.storage.sync.set(settings);
	}

	async testGitHubToken(token) {
		try {
			const response = await fetch(`${this.apiBase}/user`, {
				headers: {
					Authorization: `token ${token}`,
					Accept: 'application/vnd.github.v3+json',
				},
			});

			if (response.ok) {
				const user = await response.json();
				return { valid: true, username: user.login };
			} else {
				return { valid: false, error: 'Invalid token' };
			}
		} catch (error) {
			return { valid: false, error: error.message };
		}
	}

	async handleReaction(issueInfo, reactions) {
		try {
			const settings = await this.getSettings();

			if (!settings.githubToken || !settings.projectOwner || !settings.projectNumber) {
				return;
			}

			// Determine which column to move to based on reactions
			let targetColumnId = null;
			let status = null;

			if (reactions.done && settings.doneColumnId) {
				targetColumnId = settings.doneColumnId;
				status = 'Done';
			} else if (reactions.inProgress && settings.inProgressColumnId) {
				targetColumnId = settings.inProgressColumnId;
				status = 'In Progress';
			} else if (reactions.todo && settings.todoColumnId) {
				targetColumnId = settings.todoColumnId;
				status = 'Todo';
			}

			if (targetColumnId) {
				await this.moveIssueToProject(issueInfo, targetColumnId, status, settings);
			}
		} catch (error) {
			// Handle error silently
		}
	}

	async moveIssueToProject(issueInfo, columnId, status, settings) {
		try {
			// First, check if issue is already in the project
			const existingItem = await this.findExistingProjectItem(issueInfo, settings);

			let itemId = null;
			if (existingItem) {
				// Update existing item (set status field)
				itemId = existingItem.id;
				if (existingItem.currentStatusOptionId === columnId) {
					// No change needed
					return;
				}
				await this.updateProjectItemStatus(itemId, columnId, settings);
			} else {
				// Add new item to project
				const addResult = await this.addIssueToProject(issueInfo, columnId, settings);
				// Try to extract itemId from GraphQL response
				itemId = addResult?.data?.addProjectV2ItemById?.item?.id;
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
			}

			// Store in local storage for popup display
			await this.storeProcessedIssue(issueInfo, status);

			// Send feedback to content script (toast)
			if (chrome && chrome.tabs && issueInfo.url) {
				chrome.tabs.query({ url: issueInfo.url }, tabs => {
					if (tabs && tabs.length > 0) {
						chrome.tabs.sendMessage(tabs[0].id, {
							type: 'SHOW_TOAST',
							status,
							issueInfo,
						});
					}
				});
			}
		} catch (error) {
			// Handle error silently
		}
	}

	/**
	 * Search for an existing project item using the issue's node ID
	 * Uses pagination to handle large projects (up to 1000 items)
	 */
	async findExistingProjectItem(issueInfo, settings) {
		try {
			// Get the issue's node ID for reliable comparison
			const issueNodeId = await this.getIssueNodeId(issueInfo, settings);

			let hasNextPage = true;
			let cursor = null;
			let pageCount = 0;
			const maxPages = 10; // Search up to 1000 items (100 per page)

			while (hasNextPage && pageCount < maxPages) {
				const query = `
                    query {
                        node(id: "${settings.projectId}") {
                            ... on ProjectV2 {
                                items(first: 100${cursor ? `, after: "${cursor}"` : ''}) {
                                    nodes {
                                        id
                                        content {
                                            ... on Issue {
                                                id
                                            }
                                        }
                                        fieldValues(first: 10) {
                                            nodes {
                                                ... on ProjectV2ItemFieldSingleSelectValue {
                                                    field {
                                                        ... on ProjectV2SingleSelectField {
                                                            id
                                                        }
                                                    }
                                                    optionId
                                                }
                                            }
                                        }
                                    }
                                    pageInfo {
                                        hasNextPage
                                        endCursor
                                    }
                                }
                            }
                        }
                    }
                `;

				const response = await fetch('https://api.github.com/graphql', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${settings.githubToken}`,
						Accept: 'application/vnd.github.v3+json',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ query }),
				});

				const result = await response.json();

				if (result.errors) {
					console.error('Error querying project items:', result.errors);
					return null;
				}

				const items = result.data?.node?.items?.nodes || [];

				// Find the item that matches our issue's node ID
				const matchingItem = items.find(item => {
					return item.content && item.content.id === issueNodeId;
				});

				if (matchingItem) {
					// Extract current status optionId from field values
					const statusFieldValue = matchingItem.fieldValues?.nodes?.find(
						fieldValue => fieldValue.field?.id === settings.statusFieldId,
					);

					return {
						...matchingItem,
						currentStatusOptionId: statusFieldValue?.optionId || null,
					};
				}

				hasNextPage = result.data?.node?.items?.pageInfo?.hasNextPage;
				cursor = result.data?.node?.items?.pageInfo?.endCursor;
				pageCount++;
			}

			return null;
		} catch (error) {
			console.error('Error finding existing project item:', error);
			return null;
		}
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

		const addResponse = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${settings.githubToken}`,
				Accept: 'application/vnd.github.v3+json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ query: addMutation }),
		});

		const addResult = await addResponse.json();
		if (addResult.errors) {
			return addResult;
		}

		const itemId = addResult.data.addProjectV2ItemById.item.id;

		// Step 3: update the item's status field
		const statusFieldId = settings.statusFieldId;

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

		const updateResponse = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${settings.githubToken}`,
				Accept: 'application/vnd.github.v3+json',
				'Content-Type': 'application/json',
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
					Accept: 'application/vnd.github.v3+json',
				},
			},
		);

		const issue = await response.json();
		return issue.node_id;
	}

	/**
	 * Update the status of an existing project item
	 */
	async updateProjectItemStatus(itemId, optionId, settings) {
		const mutation = `
          mutation {
            updateProjectV2ItemFieldValue(input: {
              projectId: "${settings.projectId}"
              itemId: "${itemId}"
              fieldId: "${settings.statusFieldId}"
              value: { singleSelectOptionId: "${optionId}" }
            }) {
              projectV2Item {
                id
              }
            }
          }
        `;

		const response = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${settings.githubToken}`,
				Accept: 'application/vnd.github.v3+json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ query: mutation }),
		});

		return response.json();
	}

	// Set the Status field for a project item (for Projects beta)
	async setProjectStatusField(projectId, itemId, statusFieldId, optionId, settings) {
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

		const response = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: {
				Authorization: `token ${settings.githubToken}`,
				Accept: 'application/vnd.github.v3+json',
				'Content-Type': 'application/json',
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
		const result = await chrome.storage.local.get(['processedIssues']);
		const processedIssues = result.processedIssues || [];

		// Add new issue (keep only last 100)
		processedIssues.unshift(processedIssue);
		const trimmedIssues = processedIssues.slice(0, 100);

		await chrome.storage.local.set({ processedIssues: trimmedIssues });
	}
}

// Initialize the tracker
new GitHubTracker();
