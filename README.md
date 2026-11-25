# Medi-Tree

A lightweight, self-hosted decision-tree and workflow guide designed for Medinetz volunteers.

Medi-Tree turns organisational guidance into interactive workflows. Volunteers can follow questions, explore a flowchart and work through action checklists, while administrators maintain the underlying guidance through a visual editor.

The application is designed to support consultations without creating individual case records. It is not an electronic health record, diagnostic system or substitute for professional judgement.

## Features

### Volunteer guide (`/`)

- Step-by-step navigation through configurable questions and outcomes.
- Interactive flowchart with zoom, direct node navigation and path highlighting.
- Combined, step-only and map-only views.
- Breadcrumb navigation and temporary action checklists.
- New Case control to reset consultation progress.
- No volunteer account required.

### Admin studio (`/admin`)

- Password-protected editing interface.
- Visual creation, positioning and connection of question and outcome nodes.
- Editable branch labels, guidance, outcome categories and checklists.
- Automatic graph layout and validation feedback.
- Separate draft and published versions of a single workflow.
- JSON import and export; SVG, Mermaid and Markdown export options.

## Quick start

Requirements: Python 3.10 or newer, Git (for cloning), and a modern web browser. No third-party Python packages or frontend build step are required.

```sh
git clone https://github.com/hrshe/medi-tree.git
cd medi-tree
python3 server.py --port 8080
```

| Interface | URL |
| --- | --- |
| Volunteer guide | http://127.0.0.1:8080/ |
| Admin studio | http://127.0.0.1:8080/admin |
| Health endpoint | http://127.0.0.1:8080/api/health |

The application initialises its SQLite database and example workflow when no existing records are present.

### Administrator setup

**No default administrator password is created on a fresh database.** Configure `MEDINETZ_ADMIN_USER` and `MEDINETZ_ADMIN_PASSWORD` (at least 12 characters) before first startup, or create an administrator using the CLI. Existing accounts are not changed by these settings; rotate any old default credentials before deployment.

To update an existing account locally, use the Account dialog in the admin studio or the CLI:

```sh
python3 server.py --set-admin admin 'REPLACE_WITH_A_UNIQUE_STRONG_PASSWORD'
```

The CLI accepts the password as an argument, which may expose it through shell history or process listings. Prefer the Account dialog for password changes where possible. Creating a new username does not remove existing administrators.

## Editing a workflow

1. Sign in to the admin studio.
2. Add question and outcome nodes using the palette.
3. Connect nodes and configure answer labels, guidance and checklists.
4. Select the starting node and arrange the graph.
5. Save a draft without changing the public guide.
6. Review the workflow for correctness, completeness and confidentiality.
7. Publish the reviewed workflow to make it available to volunteers.

Use JSON exports to keep independent copies of workflow definitions. The current version stores the draft and published tree, not a full revision history.

## Privacy and data handling

Volunteer navigation and checklist progress are held in browser memory. The volunteer interface retrieves the published workflow from the server but does not intentionally transmit individual answers or checklist selections to it.

SQLite stores administrator accounts, password hashes, hashed session tokens, draft and published workflow definitions, and associated metadata. Administrator sessions use an HTTP-only cookie.

The published workflow is publicly accessible in the current implementation. Never add personal data, case records or confidential internal contacts to published content. Do not enter identifying information into draft content either.

Hosting infrastructure, browser extensions and reverse proxies may retain additional technical information such as access logs. Deployment operators are responsible for reviewing their logging, retention, access controls and applicable data protection requirements. This design is not a claim of certified security or legal compliance.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Local server bind address |
| `PORT` | `8080` | Local server port |
| `MEDINETZ_DATA_DIR` | `data/` in the project directory | SQLite storage directory |
| `MEDINETZ_ADMIN_USER` | `admin` | Initial administrator username |
| `MEDINETZ_ADMIN_PASSWORD` | Unset; no automatic admin creation | Initial administrator password |

`--host` and `--port` override the corresponding environment variables for the standalone server.

## Deployment

The standalone server is intended for local development. For a hosted installation, use a production WSGI server or managed WSGI hosting platform with HTTPS. The entry point is `wsgi:application`.

### PythonAnywhere or other managed WSGI hosting

Clone the repository, configure secure initial credentials and a persistent writable data directory, then configure the hosting service to import the application. For example, a WSGI configuration can contain:

```python
import sys

sys.path.insert(0, '/home/YOUR_USERNAME/medi-tree')
from wsgi import application
```

Replace the path with your installation directory. Configure environment variables before importing the application, enable HTTPS and reload the service. The application can serve its own static files.

Before operational use, review authentication, rate limiting, request protections, logging and workflow validation. Keep the database outside publicly served directories, restrict filesystem permissions and make consistent SQLite backups. Do not commit runtime databases or credentials to Git.

## Technology and project structure

Medi-Tree uses Python's standard library, WSGI, SQLite, HTML, CSS, native JavaScript modules and SVG.

```text
medi-tree/
├── server.py          # HTTP API, authentication and persistence
├── wsgi.py            # WSGI deployment entry point
├── sample_tree.py     # Initial example workflow
├── static/
│   ├── index.html     # Volunteer interface
│   ├── admin.html     # Admin interface
│   ├── volunteer.js   # Volunteer navigation
│   ├── admin.js       # Workflow editing
│   ├── graph-core.js  # Shared graph functionality
│   └── styles.css     # Application styling
├── tests/             # Automated backend tests
├── data/              # Runtime SQLite storage (default)
└── README.md
```

## Testing

Run the standard-library test suite from the repository root:

```sh
python3 -m unittest discover -s tests -v
```

The existing tests cover backend behaviour including public routes, authentication, persistence and the draft/publish workflow. Browser interaction and deployment-specific privacy controls require separate testing.

## Project status and limitations

Medi-Tree is under active development. The bundled decision tree is illustrative and must be reviewed and adapted by the responsible organisation before use in real consultations. The software does not independently verify medical, legal or administrative guidance.

The current implementation supports one active published workflow and its draft. Full revision history, stronger publication checks and deployment hardening are areas for further development.

## Contributing

Feedback, bug reports and contributions are welcome through the [issue tracker](https://github.com/hrshe/medi-tree/issues). Include reproduction steps and synthetic example workflows; never include real patient or consultation information in an issue, screenshot or test fixture.

## License

No license has been specified in the repository at the time of writing. Contact the maintainer regarding reuse or distribution until licensing terms are established.

## Publication checks

Drafts may contain incomplete paths. Publication rejects cycles, unreachable nodes, non-finite coordinates, missing or duplicate branch labels, questions without branches, and outcomes with outgoing branches. Password changes revoke existing sessions; sign in again afterward. Set `MEDINETZ_PUBLIC_ORIGIN` to the exact HTTPS origin in production. Published content remains public.
