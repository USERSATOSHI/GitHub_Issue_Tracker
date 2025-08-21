// content.js - Detects reactions on GitHub issues
(function () {
    "use strict";

    // Emoji configuration (will be loaded from storage)
    let TODO_EMOJI = "👀";
    let IN_PROGRESS_EMOJI = "🚀";
    let DONE_EMOJI = "✅";

    // Extract issue information from the current page
    function getIssueInfo() {
        const pathParts = window.location.pathname.split("/");
        const owner = pathParts[1];
        const repo = pathParts[2];
        const issueNumber = pathParts[4];

        const titleElement = document.querySelector(
            "[data-testId='issue-title']",
        );
        const title = titleElement
            ? titleElement.textContent.trim()
            : "Unknown Issue";

        return {
            owner,
            repo,
            issueNumber: parseInt(issueNumber),
            title,
            url: window.location.href,
        };
    }

    // Check if user has reacted with specific emoji (robust for new GitHub DOM)
    function hasUserReacted(reactionButton, emoji) {
        // Find the emoji in the leadingVisual span
        const emojiSpan = reactionButton.querySelector(
            '[data-component="leadingVisual"]',
        );
        if (!emojiSpan) return false;

        const emojiText = emojiSpan.textContent.trim().normalize();
        const emojiConfig = emoji.normalize();
        // aria-checked="true" means *you* have reacted
        const isMine = reactionButton.getAttribute("aria-checked") === "true";

        console.log("[GitHub Issue Tracker] Comparing emoji:", {
            emojiText,
            emojiConfig,
            isMine,
        });
        return emojiText === emojiConfig && isMine;
    }

    // Monitor for reaction changes
    function setupReactionMonitor() {
        const reactionButtons = document.querySelectorAll(
            'button[class*="ReactionButton-module__reactionToggleButton"]',
        );

        reactionButtons.forEach((button) => {
            button.addEventListener("click", () => {
                // Wait a bit for the UI to update
                setTimeout(() => {
                    checkReactions();
                }, 1000);
            });
        });
    }

    // Check current reactions and send to background script
    // Debounce and deduplicate reaction detection
    let lastSentReactions = {};

    function debounce(fn, delay) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    const debouncedCheckReactions = debounce(checkReactions, 500);

    function checkReactions() {
        const issueInfo = getIssueInfo();
        const reactionButtons = document.querySelectorAll(
            'button[class*="ReactionButton-module__reactionToggleButton"]',
        );

        const reactions = {
            todo: false,
            inProgress: false,
            done: false,
        };

        reactionButtons.forEach((button, idx) => {
            if (hasUserReacted(button, TODO_EMOJI)) {
                reactions.todo = true;
            }
            if (hasUserReacted(button, IN_PROGRESS_EMOJI)) {
                reactions.inProgress = true;
            }
            if (hasUserReacted(button, DONE_EMOJI)) {
                reactions.done = true;
            }
        });

        // Only send if reactions changed
        if (
            reactions.todo !== lastSentReactions.todo ||
            reactions.inProgress !== lastSentReactions.inProgress ||
            reactions.done !== lastSentReactions.done
        ) {
            lastSentReactions = { ...reactions };

            let targetStatus = null;
            if (reactions.done) targetStatus = "Done";
            else if (reactions.inProgress) targetStatus = "In Progress";
            else if (reactions.todo) targetStatus = "Todo";

            if (targetStatus) {
                console.log(
                    "[GitHub Issue Tracker] Sending ADD_TO_PROJECT message:",
                    { issueInfo, targetStatus },
                );

                chrome.runtime.sendMessage(
                    {
                        type: "ADD_TO_PROJECT",
                        issueInfo,
                        targetStatus,
                    },
                    (response) => {
                        console.log(
                            "[GitHub Issue Tracker] Background response to ADD_TO_PROJECT:",
                            response,
                        );
                    },
                );
            } else {
                console.log(
                    "[GitHub Issue Tracker] No relevant reactions detected for this user.",
                );
            }
        }
    }

    // Initialize when page loads
    function observeReactionsToolbar() {
        const toolbar = document.querySelector(
            'div[role="toolbar"][aria-label="Reactions"]',
        );
        if (!toolbar) return;

        const observer = new MutationObserver(() => {
            console.log(
                "[GitHub Issue Tracker] Reactions toolbar changed, re-checking reactions.",
            );
            debouncedCheckReactions();
            setupReactionMonitor(); // re-attach listeners if needed
        });

        observer.observe(toolbar, { childList: true, subtree: true });
    }

    function initialize() {
        // Load emoji settings from chrome.storage.sync
        chrome.storage.sync.get(
            ["todoEmoji", "progressEmoji", "doneEmoji"],
            (result) => {
                TODO_EMOJI = result.todoEmoji || "👀";
                IN_PROGRESS_EMOJI = result.progressEmoji || "🚀";
                DONE_EMOJI = result.doneEmoji || "✅";
                console.log("[GitHub Issue Tracker] Loaded emoji config:", {
                    TODO_EMOJI,
                    IN_PROGRESS_EMOJI,
                    DONE_EMOJI,
                });

                if (window.location.pathname.includes("/issues/")) {
                    console.log(
                        "[GitHub Issue Tracker] Initializing on issue page:",
                        window.location.pathname,
                    );
                    setupReactionMonitor();
                    debouncedCheckReactions(); // Check existing reactions on page load
                    observeReactionsToolbar();
                    observeReactionButtonStates();
                } else {
                    console.log(
                        "[GitHub Issue Tracker] Not an issue page:",
                        window.location.pathname,
                    );
                }
            },
        );
    }

    // Observe aria-checked changes on reaction buttons to detect user reactions to existing emojis
    function observeReactionButtonStates() {
        const toolbar = document.querySelector(
            'div[role="toolbar"][aria-label="Reactions"]',
        );
        if (!toolbar) return;

        // Observe attribute changes on all reaction buttons
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (
                    mutation.type === "attributes" &&
                    mutation.attributeName === "aria-checked"
                ) {
                    const button = mutation.target;
                    if (button.getAttribute("aria-checked") === "true") {
                        console.log(
                            "[GitHub Issue Tracker] aria-checked changed to true on button, re-checking reactions.",
                        );
                        checkReactions();
                    }
                }
            }
        });

        // Attach observer to each reaction button
        function attachToButtons() {
            const buttons = toolbar.querySelectorAll(
                'button[class*="ReactionButton-module__reactionToggleButton"]',
            );
            buttons.forEach((btn) => {
                observer.observe(btn, {
                    attributes: true,
                    attributeFilter: ["aria-checked"],
                });
            });
        }

        // Attach initially and whenever toolbar changes
        attachToButtons();
        const toolbarObserver = new MutationObserver(attachToButtons);
        toolbarObserver.observe(toolbar, { childList: true, subtree: true });
    }

    // Run initialization
    initialize();

    // Handle navigation changes (GitHub is a SPA)
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            setTimeout(initialize, 1000); // Wait for page to load
        }
    }).observe(document, { subtree: true, childList: true });

    // Log for debugging
    console.log("GitHub Issue Tracker extension loaded");

    // Listen for toast feedback from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log(
            "[GitHub Issue Tracker] Received message from background:",
            message,
        );
        if (message.type === "SHOW_TOAST") {
            showToast(`Issue moved to <b>${message.status}</b> column!`, 3500);
        }
    });

    // Toast function
    function showToast(html, duration = 3000) {
        // Remove any existing toast
        const oldToast = document.getElementById("github-issue-tracker-toast");
        if (oldToast) oldToast.remove();

        const toast = document.createElement("div");
        toast.id = "github-issue-tracker-toast";
        toast.innerHTML = html;
        Object.assign(toast.style, {
            position: "fixed",
            bottom: "32px",
            right: "32px",
            background: "#24292e",
            color: "#fff",
            padding: "14px 24px",
            borderRadius: "8px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
            fontSize: "15px",
            zIndex: 99999,
            fontWeight: "500",
            opacity: "0",
            transition: "opacity 0.3s",
            pointerEvents: "none",
        });
        document.body.appendChild(toast);
        setTimeout(() => (toast.style.opacity = "1"), 10);
        setTimeout(() => {
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
})();
