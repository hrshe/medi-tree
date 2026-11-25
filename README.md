# Medinetz Decision Tree App

A lightweight, privacy-first decision-support web application for **Medinetz** volunteers and medical professionals.

## Key Features
- **Stateless Volunteer Guide (`/`)**:
  - Zero client/patient data is ever stored on the server, in cookies, or in browser storage.
  - Supports **Both (Split)**, **Step-by-Step Wizard**, and **Interactive Flowchart** modes.
  - Breadcrumb history, keyboard navigation (`1`–`9`, `Backspace`, `R`), and ephemeral action checklists.
- **Authenticated Admin Studio (`/admin`)**:
  - Username & password login (`PBKDF2-HMAC-SHA256` + `HttpOnly` session cookies).
  - Drag-and-drop visual flowchart builder: drag Question/Outcome nodes onto the canvas, drag nodes to reposition, and drag from a node's `+` output port to connect branches.
  - Draft vs. Published workflow (`Save Draft` and `Publish Live`), live validation checks, and Auto Layout.
  - **Export & Import**: Export as **JSON (`.json`)**, **SVG Diagram (`.svg`)**, **Mermaid Flowchart (`.mmd`)**, or **Markdown Guide (`.md`)**; import JSON trees back into the studio.

## Local Quick Start

```bash
python3 server.py --port 8080
```

- Volunteer Guide: `http://127.0.0.1:8080/`
- Admin Studio: `http://127.0.0.1:8080/admin`

### Default Admin Credentials
On first launch, an admin account is seeded automatically (configurable via `MEDINETZ_ADMIN_USER` and `MEDINETZ_ADMIN_PASSWORD` environment variables, defaulting to `admin` / `medinetz-admin`).

Update or create an admin anytime via CLI or inside the Admin UI (`Account` button):
```bash
python3 server.py --set-admin <username> <new-password>
```

---

## Deploying to PythonAnywhere (Free Beginner Tier)

Because PythonAnywhere provides a **persistent local disk**, your SQLite database (`data/medinetz.db`) survives restarts without needing an external database.

1. **Upload the project**
   - Sign in to PythonAnywhere, open a **Bash console**, and upload/clone the `medinetz-decision-tree` folder into your home directory (e.g., `/home/<your-username>/medinetz-decision-tree`).
   - Change the default admin password immediately in the Bash console:
     ```bash
     cd ~/medinetz-decision-tree
     python3 server.py --set-admin admin "your-strong-password"
     ```

2. **Create the Web App**
   - Go to the **Web** tab → **Add a new web app**.
   - Choose **Manual configuration** (not Flask/Django) → select **Python 3.10** (or newer).

3. **Configure the WSGI file**
   - In the **Web** tab, click the **WSGI configuration file** link (e.g. `/var/www/<your-username>_pythonanywhere_com_wsgi.py`).
   - Replace its contents with:
     ```python
     import sys
     from pathlib import Path

     project_home = "/home/<your-username>/medinetz-decision-tree"
     if project_home not in sys.path:
         sys.path.insert(0, project_home)

     from wsgi import application  # noqa: E402, F401
     ```
     *(Replace `<your-username>` with your actual PythonAnywhere username.)*

4. **(Optional) Faster Static Files**
   - The app already serves `/static/` directly, or you can add a static mapping in the **Web** tab:
     - URL: `/static/`
     - Directory: `/home/<your-username>/medinetz-decision-tree/static`

5. **Reload & Open**
   - Click the green **Reload** button in the **Web** tab.
   - Visit `https://<your-username>.pythonanywhere.com/` (Volunteer View) and `https://<your-username>.pythonanywhere.com/admin` (Admin Studio).
   - *Reminder:* On PythonAnywhere's free tier, remember to click **"Run until 3 months from today"** in the Web tab once every 3 months.
