
# GitHub Issue Tracker Extension

Automatically move GitHub issues to your project board columns when you react with specific emojis.

---

## Features

- **Emoji-based workflow:** Move issues to "Todo", "In Progress", or "Done" by reacting with your configured emoji.
- **Supports GitHub Projects (beta):** Works with the new Projects (beta) using Status fields.
- **Visual feedback:** See a toast notification on GitHub when an issue is moved.
- **Activity log:** View recently processed issues in the extension popup.
- **Customizable:** Set your own emojis and project details.

---

## Installation

1. **Clone or Download this Repository**
2. **Go to `chrome://extensions` in your browser**
3. **Enable "Developer mode"**
4. **Click "Load unpacked" and select the `browser extension` directory**

---

## Setup

### 1. Open the Extension Popup

Click the GitHub Issue Tracker icon in your browser toolbar.

### 2. Fill in the Settings

#### **Required Fields**

- **GitHub Personal Access Token:**
  Create one at [github.com/settings/tokens](https://github.com/settings/tokens)
  _Required scopes:_ `repo`, `read:project`

- **Project Owner:**
  Your GitHub username or organization name.

- **Project Number:**
  The number from your project URL (e.g., `/users/your-username/projects/3` → `3`).

#### **For GitHub Projects (beta) — Required!**

- **Project ID:**
  The node ID of your project (e.g., `PVT_xxx`).
  _How to get it:_
  Use the GitHub GraphQL Explorer with:
  ```graphql
  query {
    user(login: "YOUR_USERNAME") {
      projectV2(number: YOUR_PROJECT_NUMBER) {
        id
      }
    }
  }
  ```
  Replace `YOUR_USERNAME` and `YOUR_PROJECT_NUMBER`.
  Copy the returned `id` value.

- **Status Field ID:**
  The node ID of your "Status" field (e.g., `PVTSSF_xxx`).
  _How to get it:_
  Use the GraphQL Explorer:
  ```graphql
  query {
    node(id: "YOUR_PROJECT_ID") {
      ... on ProjectV2 {
        fields(first: 20) {
          nodes {
            ... on ProjectV2FieldCommon {
              id
              name
            }
          }
        }
      }
    }
  }
  ```
  Find the field named "Status" and copy its `id`.

- **Todo/In Progress/Done Column IDs:**
  These are the option IDs for your Status field.
  _How to get them:_
  In the same query above, find the "Status" field, then look for its `options`:
  ```json
  {
    "name": "Status",
    "id": "PVTSSF_xxx",
    "options": [
      { "id": "aaa", "name": "Todo" },
      { "id": "bbb", "name": "In Progress" },
      { "id": "ccc", "name": "Done" }
    ]
  }
  ```
  Use these IDs for the corresponding columns.

#### **Emoji Settings**

- **Todo Emoji:** Emoji to trigger "Todo" (e.g., 👀)
- **In Progress Emoji:** Emoji to trigger "In Progress" (e.g., 🚀)
- **Done Emoji:** Emoji to trigger "Done" (e.g., ✅)

You can use any emoji you like!

---

### 3. Save Settings

Click **Save Settings** in the popup.

---

## Usage

1. **Go to a GitHub issue page.**
2. **React to the issue with your configured emoji** (e.g., 👀 for Todo).
3. **Watch for a toast notification** confirming the move.
4. **Check your project board:**
   The issue will appear in the correct column/status.

---

## Example Configuration

Suppose your project has:

- **Project ID:** `PVT_xxx`
- **Status Field ID:** `PVTSSF_xxx`
- **Todo Column ID:** `aaa`
- **In Progress Column ID:** `bbb`
- **Done Column ID:** `ccc`
- **Emojis:** 👀 (Todo), 🚀 (In Progress), ✅ (Done)

Fill the popup as follows:

| Field                | Value                                  |
|----------------------|----------------------------------------|
| Project ID           | PVT_xxx                                |
| Status Field ID      | PVTSSF_xxx                             |
| Todo Column ID       | aaa                                    |
| In Progress Column ID| bbb                                    |
| Done Column ID       | ccc                                    |
| Todo Emoji           | 👀                                     |
| In Progress Emoji    | 🚀                                     |
| Done Emoji           | ✅                                     |

---

## Troubleshooting

- **Toast appears but issue is not moved:**
  Double-check your Project ID, Status Field ID, and column IDs.
- **"Could not resolve to a node with the global id of '3'" error:**
  You are using the project number instead of the project node ID. Use the GraphQL API to get the node ID.
- **No reaction detected:**
  Make sure your emoji config matches the emoji you use to react.

---

## Advanced

- **Automate ID fetching:**
  You can use the GitHub GraphQL Explorer to fetch all required IDs.
- **Support for classic projects:**
  This extension is optimized for Projects (beta). Classic project support would require different API calls.

---

## Contributing

PRs and issues welcome!

---

## License

Apache 2.0

---

**Enjoy automating your GitHub workflow!**
