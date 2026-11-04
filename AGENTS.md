# Project rules

Write clear English and preserve program identifiers.
Do not read or print servers.local.md or private files in .agents/skills/deploy/config unless an operation needs them.
Keep service code in src, schemas and commands in its subdirectories, and tests in the root tests directory.
Keep documentation in the root docs directory.
Do not create re-exports or switches for replaced behavior; remove replaced code.
Store research data in ../TEST-OUT-DATA/model-catalog.
Read .agents/skills/deploy/SKILL.md before deployment.
Do not publish to npm without a publishing request; never include keys in Git, archives, or logs.
Show every calculation component; do not replace unknown values with zero, and explain stale values.
Write documentation in English, use relative links, and keep Markdown lines within 120 characters.
Keep deployment-specific values in private settings; use placeholders in documentation and public examples.

Do not read editor directories, temporary data, or archives listed in `.rgignore` without an explicit user request.
When cleaning up, delete only temporary files created for the current task and preserve other people's data.
Do not write to Claude Code persistent memory without explicit permission; keep shared knowledge in the project.
Write concise instructions without repetition; link specialized rules with an explicit reading condition.
A request to run code checks means `npm run test:code`, without external servers or paid requests.
