/** A fixture `.scratch/` tracker, keyed by repo-relative path. */
export const MARKDOWN_TRACKER: Record<string, string> = {
  'docs/agents/issue-tracker.md': '# Issue tracker: Local Markdown\n\nIssues live in `.scratch/`.\n',

  // A Map with children in mixed states.
  '.scratch/checkout-ux/map.md':
    '# Map: Checkout UX\n\n## Notes\nSome notes.\n\n## Decisions so far\nNone yet.\n\n## Fog\nEverything.\n',
  '.scratch/checkout-ux/issues/01-research-payments.md':
    '# 01: Research payment providers\n\nType: research\nStatus: resolved\n\n## Answer\nUse Stripe.\n',
  '.scratch/checkout-ux/issues/02-prototype-form.md':
    '# 02: Prototype the card form\n\nType: prototype\nBlocked by: 01\nStatus: needs-triage\n',
  '.scratch/checkout-ux/issues/03-grill-refunds.md':
    '# 03: Grill the refund policy\n\nType: grilling\nStatus: claimed\n',

  // A Spec with blocked tickets.
  '.scratch/invoice-export/spec.md':
    '# Spec: Invoice export\n\nStatus: ready-for-agent\n\n## Problem Statement\nPeople want PDFs.\n\n## Solution\nExport them.\n\n## User Stories\n1. As a user, I want a PDF.\n',
  '.scratch/invoice-export/issues/01-pdf-renderer.md':
    '# 01: PDF renderer\n\n**What to build:** Render an invoice to PDF.\n\n**Blocked by:** None\n\n**Status:** ready-for-agent\n',
  '.scratch/invoice-export/issues/02-download-button.md':
    '# 02: Download button\n\n**What to build:** A button.\n\n**Blocked by:** 01\n\n**Status:** ready-for-agent\n',

  // A standalone bug and a file that does not parse.
  '.scratch/loose/issues/01-login-crash.md':
    '# 01: Login crashes on empty password\n\nLabels: bug\nStatus: needs-triage\n',
  '.scratch/loose/issues/02-garbled.md': '\u0000\u0001 not a ticket at all',
}
