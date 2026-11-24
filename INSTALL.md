# Install AI Office: instructions for Claude

You are Claude Code, installing AI Office for the user. Most users are not technical.
**Do every step yourself.** The user only answers a few questions and says OK.

How to talk to the user:

- Short, plain sentences, in the language the user writes in. No jargon (say "the office folder", not "the working directory").
- Before you install or download anything, say what and why in one line, and ask for OK.
- When something fails, say in plain words what happened and what you will try next. Never paste a raw error without explaining it.

What AI Office is (tell the user in two lines if they ask): a PA called Hana plus 1 to 8 AI staff
that run on their own Claude account, in a folder on their computer. A live dashboard comes in a later version.

## Step 1: Find Node.js (version 18 or newer)

AI Office needs Node.js. Claude Code does not include it, so check first. Use what exists before installing anything.

1. Try `node --version` (Windows: in both Bash and PowerShell if you have both).
2. If that fails or is older than 18, look in the usual places. Use the first one that exists and is 18 or newer:

   | System | Places to check |
   |---|---|
   | Windows | `%ProgramFiles%\nodejs\node.exe`, `%LOCALAPPDATA%\Programs\nodejs\node.exe`, `%USERPROFILE%\.ai-office\node\node.exe`, `%APPDATA%\nvm\v*\node.exe`, `%LOCALAPPDATA%\Volta\bin\node.exe`, `%USERPROFILE%\scoop\apps\nodejs*\current\node.exe` |
   | Mac | `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `~/.ai-office/node/bin/node`, `~/.nvm/versions/node/*/bin/node`, `~/.volta/bin/node`, `~/.fnm` |
   | Linux | `/usr/bin/node`, `/usr/local/bin/node`, `~/.ai-office/node/bin/node`, `~/.nvm/versions/node/*/bin/node`, `~/.volta/bin/node` |

3. Found one that is not on PATH? Use its folder in the commands below (Step 3 shows how). Do not change the user's system PATH.

### No usable Node: install one

Tell the user: "AI Office needs a free program called Node.js. I can put a private copy in your home
folder. It needs no admin password and does not change anything else. OK?"

Private copy (recommended):

1. Read https://nodejs.org/dist/index.json and take the first entry where `lts` is not `false`. That is the version, for example `v24.22.3`.
2. Pick the file for this computer:
   - Windows: `node-<version>-win-x64.zip` (or `win-arm64` on ARM)
   - Mac: `node-<version>-darwin-arm64.tar.gz` (Apple chip) or `darwin-x64`
   - Linux: `node-<version>-linux-x64.tar.xz` (or `linux-arm64`)
3. Download it from `https://nodejs.org/dist/<version>/<file>`, and `SHASUMS256.txt` from the same folder.
   Check the file's SHA-256 matches its line in `SHASUMS256.txt`. If it does not match, stop and tell the user.
4. Extract it and rename the extracted folder to `.ai-office/node` in the user's home folder
   (Windows: `%USERPROFILE%\.ai-office\node`). Then check `<that folder>/node --version` works
   (Windows: `node.exe`; Mac and Linux: `bin/node`).

If the user would rather install Node for the whole computer: Windows `winget install OpenJS.NodeJS.LTS`
(Windows asks for admin), Mac `brew install node` (if Homebrew is there), otherwise the installer from https://nodejs.org.
After a system install, open a new shell before checking `node --version`.

## Step 2: Ask the setup questions

Ask everything in **one** short message, showing the defaults, so the user can just say "OK":

| Question | Default |
|---|---|
| Company name | My Company Sdn Bhd |
| Where to put the office folder | A folder named after the company in the user's home folder, for example `C:\Users\<name>\my-company` or `~/my-company`. Avoid OneDrive and cloud-synced folders |
| PA's name | Hana |
| Staff (1 to 8): name, role, what they do | Aina (Customer Service), Siti (Sales), Nurul (Finance), Ahmad (Tech). More if they want: Farah (Marketing), Mei Ling (Operations), Kumar (HR), Daniel (Admin) |
| Do they send quotations or invoices? (optional add-on Invois Online: real quotations and invoices, free plan 60 documents a month, made by the team behind AI Office) | No |

Change only what the user asks to change. A new staff needs a name, a role, and one line on what they do.

## Step 3: Install

1. Write the answers to a JSON file in a temporary folder, for example:

   ```json
   {
     "company": "Kedai Baju Ali Sdn Bhd",
     "folder": "C:\\Users\\Ali\\kedai-baju-ali",
     "pa": "Hana",
     "staff": [
       { "name": "Aina", "role": "Customer Service", "job": "Answer enquiries, FAQ and product info." },
       { "name": "Siti", "role": "Sales", "job": "Quotes from the price list, follow up leads, take orders." }
     ],
     "invois": false
   }
   ```

   For a default staff you may give only the name: `{ "name": "Nurul" }`.

2. Run the installer with that file. If Node is not on PATH, put its folder first on PATH for this one command:

   - Bash (also Git Bash on Windows): `PATH="<node folder>:$PATH" npx --yes github:epool86/ai-office --answers "<file>"`
   - PowerShell: `$env:Path = "<node folder>;" + $env:Path; npx --yes github:epool86/ai-office --answers "<file>"`

   `<node folder>` is the folder that holds `npx`: on Windows the folder with `node.exe`, on Mac and Linux its `bin` folder.
   If Node is already on PATH, just run `npx --yes github:epool86/ai-office --answers "<file>"`.

3. Lines starting with `✓` went well. A line starting with `✗` says what is wrong: fix it (for example pick another
   folder) and run again. Delete the answers file when done.

## Step 4: Tell the user what they have

In a few short lines:

- Where the office folder is, and that Hana and the staff are ready.
- How to use it: open a terminal in the office folder and run `claude`. The first time, Claude Code asks
  "Do you trust this folder?": answer yes. Then just tell Hana what you need, in your own words.
- Offer to open the office folder in their file manager.
- If they said yes to Invois Online: to connect it, run `claude` in the office folder, type `/mcp`, pick
  `invois-online`, and log in in the browser. Free account: https://invois.online/?ref=ai-office

- Do not mention PATH or Node to the user unless they ask: the office already knows where its Node is.

The dashboard arrives in a later version, so do not try to start it yet. Do not start any other web server.
Do not change anything outside the office folder and `~/.ai-office/`.
