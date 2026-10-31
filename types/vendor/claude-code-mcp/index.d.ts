// The inputs of the MCP tools the session had connected when this mod
// was last saved, from each server's tools/list inputSchema.
// Merges into the engine's ToolCallInput (types/ McpToolInputs) so
// `e.tool === "mcp__<server>__<tool>"` narrows to the tool's arguments.
// Written again at a save of the mod with a server connected.
export {}
declare module 'claude-code' {
  interface McpToolInputs {
    /** Create a doc, or apply several operations to one doc atomically. */
    mcp__claude_ai_Claude_Docs__batch: {
      batch?: unknown[]
      container?: {
        kind: string
        id?: string
        create?: {}
      }
      verbose?: boolean
      opId?: string
    }
    /** Create one object in a doc: a tab, its contents, a comment, an upload record. */
    mcp__claude_ai_Claude_Docs__create: {
      object: "file" | "node" | "utterance" | "enum" | "blob"
      engine?: string
      payload: {} | string
      container?: {
        kind: string
        id: string
        version?: string
      }
      verbose?: boolean
      opId?: string
      artifact?: string
    }
    /** Delete one object from a doc: a tab or a comment. A doc keeps at least one tab (deleting its last refuses `last_tab`): to start over, rewrite that tab's contents with `update`, never delete and recreate the tab. */
    mcp__claude_ai_Claude_Docs__delete: {
      ref: {
        object: "project" | "file" | "node" | "utterance"
        id: string
      }
      engine?: string
      container?: {
        kind: string
        id: string
        version?: string
      }
      payload?: {} | string
      verbose?: boolean
      opId?: string
    }
    /** Export one tab inline as base64: pdf, docx, html, text, markdown or notion (Notion-flavored markdown, what notion-create-pages takes). To just keep the file in the doc's files, create a blob {from: {object: "file", id}, format} instead (no large result). */
    mcp__claude_ai_Claude_Docs__export: {
      container: {
        kind: string
        id: string
        version?: string
      }
      file: string
      format: "markdown" | "text" | "html" | "docx" | "pdf" | "notion"
      paper?: "letter" | "a4"
      maxBytes?: number
      /** "fit": send it only when a refusal offers it or a docx's notes say `(file too large to deliver)`, and only where you have a shell or file tools (your client then saves the large result as a file). The file may keep the pictures that fit. `data.notes` counts those left out: tell the user how many. Those counts come first, in the result's first 2,000 characters. */
      pictures?: "fit"
    }
    /** Docs guides: topic.instructions repeats the server instructions. Read it only if your client dropped them. Also topic.<name>, refusal.<code>. After a doc's birth → ["topic.index"]. */
    mcp__claude_ai_Claude_Docs__guide: {
      /** topic.<name> (instructions, index, editing, tabs, comments, charts, chart-definition, diagram, uploads, sharing, skill) or refusal.<code>; several per call is fine. */
      items?: unknown[]
    }
    /** List a tab's or a doc's comment history (threads, replies, resolves). */
    mcp__claude_ai_Claude_Docs__query: {
      container?: {
        kind: string
        id: string
        version?: string
      }
      object?: "utterance"
      payload?: {} | string
    }
    /** Read a doc (lists its tabs), a tab's contents, or a comment. A claude.ai/[code/]artifact/[<title>-]<id> link → `ref {"object":"project","id":"<id>"}` first; reads inside it take `container {"kind":"project","id":"<id>"}`. */
    mcp__claude_ai_Claude_Docs__read: {
      ref: {
        object: "project" | "file" | "node" | "utterance" | "enum" | "blob"
        id: string
      }
      engine?: string
      container?: {
        kind: string
        id: string
        version?: string
      }
      payload?: {} | string
    }
    /** Edit a tab's contents, rename a doc or tab, or change a stored value. */
    mcp__claude_ai_Claude_Docs__update: {
      ref: {
        object: "project" | "file" | "node" | "utterance" | "enum"
        id: string
      }
      engine?: string
      payload: {} | string
      container?: {
        kind: string
        id: string
        version?: string
      }
      verbose?: boolean
      opId?: string
      answering?: string
    }
    /** Create a new D1 database in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_create: {
      name: string
      primary_location_hint?: "wnam" | "enam" | "weur" | "eeur" | "apac" | "oc" | null
    }
    /** Delete a d1 database in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_delete: {
      database_id: string
    }
    /** Get a D1 database in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_get: {
      database_id: string
    }
    /** Query a D1 database in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__d1_database_query: {
      database_id: string
      sql: string
      params?: string[] | null
    }
    /** List all of the D1 databases in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__d1_databases_list: {
      name?: string | null
      page?: number | null
      per_page?: number | null
    }
    /** Delete a Hyperdrive configuration in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__hyperdrive_config_delete: {
      /** The ID of the Hyperdrive configuration */
      hyperdrive_id: string
    }
    /** Edit (patch) a Hyperdrive configuration in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__hyperdrive_config_edit: {
      /** The ID of the Hyperdrive configuration */
      hyperdrive_id: string
      name?: string | null
      database?: string | null
      host?: string | null
      port?: number | null
      scheme?: "postgresql" | null
      user?: string | null
      caching_disabled?: boolean | null
      caching_max_age?: number | null
      caching_stale_while_revalidate?: number | null
    }
    /** Get details of a specific Hyperdrive configuration in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__hyperdrive_config_get: {
      /** The ID of the Hyperdrive configuration */
      hyperdrive_id: string
    }
    /** List Hyperdrive configurations in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__hyperdrive_configs_list: {
      page?: number | null
      per_page?: number | null
      order?: "id" | "name" | null
      direction?: "asc" | "desc" | null
    }
    /** Create a new kv namespace in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__kv_namespace_create: {
      /** The human-readable name/title of the KV namespace */
      title: string
    }
    /** Delete a kv namespace in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__kv_namespace_delete: {
      /** The ID of the KV namespace */
      namespace_id: string
    }
    /** Get details of a kv namespace in your Cloudflare account. Use this tool when you need to get details of a specific kv namespace in your Cloudflare account. Returns a kv namespace with the following properties: - id: The id of the kv namespace. - title: The title of the kv namespace. - supports_url_encoding: Whether the kv namespace supports url encoding. - beta: Whether the kv namespace is in beta. */
    mcp__claude_ai_Cloudflare_Developer_Platform__kv_namespace_get: {
      /** The ID of the KV namespace */
      namespace_id: string
    }
    /** Update the title of a kv namespace in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__kv_namespace_update: {
      /** The ID of the KV namespace */
      namespace_id: string
      /** The human-readable name/title of the KV namespace */
      title: string
    }
    /** List all of the kv namespaces in your Cloudflare account. Use this tool when you need to list all of the kv namespaces in your Cloudflare account. Returns a list of kv namespaces with the following properties: - id: The id of the kv namespace. - title: The title of the kv namespace. */
    mcp__claude_ai_Cloudflare_Developer_Platform__kv_namespaces_list: {
      /** Optional parameters for listing KV namespaces */
      params?: {
        /** Direction to order namespaces (asc/desc) */
        direction?: "asc" | "desc"
        /** Field to order namespaces by (id/title) */
        order?: "id" | "title"
        /** Page number of results (starts at 1) */
        page?: number
        /** Number of namespaces per page (1-100) */
        per_page?: number
      }
    }
    /** ALWAYS read this guide before migrating Pages projects to Workers. */
    mcp__claude_ai_Cloudflare_Developer_Platform__migrate_pages_to_workers_guide: {}
    /** Create a new r2 bucket in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__r2_bucket_create: {
      /** The name of the r2 bucket */
      name: string
    }
    /** Delete an R2 bucket */
    mcp__claude_ai_Cloudflare_Developer_Platform__r2_bucket_delete: {
      /** The name of the r2 bucket */
      name: string
    }
    /** Get details about a specific R2 bucket */
    mcp__claude_ai_Cloudflare_Developer_Platform__r2_bucket_get: {
      /** The name of the r2 bucket */
      name: string
    }
    /** List r2 buckets in your Cloudflare account */
    mcp__claude_ai_Cloudflare_Developer_Platform__r2_buckets_list: {
      /** Query param: Pagination cursor received during the last List Buckets call. R2 buckets are paginated using cursors instead of page numbers. */
      cursor?: string | null
      /** Direction to order buckets */
      direction?: "asc" | "desc" | null
      /** Bucket names to filter by. Only buckets with this phrase in their name will be returned. */
      name_contains?: string | null
      per_page?: number | null
      /** Bucket name to start searching after. Buckets are ordered lexicographically. */
      start_after?: string | null
    }
    /** Search the Cloudflare documentation. This tool should be used to answer any question about Cloudflare products or features, including: - Workers, Pages, R2, Images, Stream, D1, Durable Objects, KV, Workflows, Hyperdrive, Queues - AI Search, Workers AI, Vectorize, AI Gateway, Browser Run - Zero Trust, Access, Tunnel, Gateway, Browser Isolation, WARP, DDOS, Magic Transit, Magic WAN - CDN, Cache, DNS, Zaraz, Argo, Rulesets, Terraform, Account and Billing Results are returned as semantically similar chunks to the query. */
    mcp__claude_ai_Cloudflare_Developer_Platform__search_cloudflare_documentation: {
      query: string
    }
    /** Get the details of the Cloudflare Worker. */
    mcp__claude_ai_Cloudflare_Developer_Platform__workers_get_worker: {
      /** The name of the worker script to retrieve */
      scriptName: string
    }
    /** Get the source code of a Cloudflare Worker. Note: This may be a bundled version of the worker. */
    mcp__claude_ai_Cloudflare_Developer_Platform__workers_get_worker_code: {
      /** The name of the worker script to retrieve */
      scriptName: string
    }
    /** List all Workers in your Cloudflare account. If you only need details of a single Worker, use workers_get_worker. */
    mcp__claude_ai_Cloudflare_Developer_Platform__workers_list: {}
    /** Call once before creating, viewing or updating issues or viewing maps/progress, to confirm the workspace and backend. If it says no backend or no workspace, stop and call no other deck tools. */
    "mcp__mattpocock-skills-deck__deck_context": {}
    /** Create a Map, Map ticket, Spec, Spec ticket, bug or plain issue in the exact format the deck reads. On Markdown this tool writes the files; never hand-write them. A map-ticket needs a Map parent and a spec-ticket a Spec parent (parentKey, or the Map's effort / the Spec's feature). Pass idempotencyKey to make a retry return the issue it already made. */
    "mcp__mattpocock-skills-deck__deck_issue_create": {
      title: string
      kind: "map" | "map-ticket" | "spec" | "spec-ticket" | "bug" | "issue"
      /** Markdown, at most 60KB. */
      body?: string
      /** The maintainer's own words, quoted in the body; later calls only add to them. */
      originalWords?: {
        text: string
        /** Where they said it. */
        source?: string
      }
      /** map-ticket only: what kind of ticket it is. */
      label?: "wayfinder:research" | "wayfinder:prototype" | "wayfinder:grilling" | "wayfinder:task"
      /** The Map or Spec the ticket belongs to. */
      parentKey?: string | number
      /** Tickets in the same effort this one waits on. */
      blockedBy?: Array<string | number>
      labels?: string[]
      assignees?: string[]
      idempotencyKey?: string
      /** How much of the Work Route the reply carries: core (default) is ticket key, session and time for the newest 20 entries; standard adds title and action for every entry. */
      workRouteDetail?: "core" | "standard"
      /** Markdown only: the Map's .scratch/<effort> folder. Not with feature. */
      effort?: string
      /** Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort. */
      feature?: string
    }
    /** Read one issue: its body, comments, labels, assignees, parent, and blocking edges (blockedBy: what it waits on; blocks: what waits on it). Pass section to read only that '## ' section of the body, and blocking=false to skip the reverse edges. */
    "mcp__mattpocock-skills-deck__deck_issue_get": {
      /** The ticket: on GitHub its issue number (7 or #7); on Markdown <effort>/<NN> (checkout/02, the Map or Spec itself is <effort>/00), its file path, or a number with effort or feature. */
      key: string | number
      /** How many of the newest comments to return. */
      comments?: number
      /** Return only this '## ' section of the body, by its heading. */
      section?: string
      /** false skips the reverse edges (blocks). */
      blocking?: boolean
      /** Markdown only: the Map's .scratch/<effort> folder. Not with feature. */
      effort?: string
      /** Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort. */
      feature?: string
    }
    /** List issues, newest update first. Filter by state (default open), type, labels (an issue must carry every one), assignee and query (matched against the key and title). Returns at most limit items (default 50, max 200) and the total that matched; when the list may be incomplete it says so, and that sentence should be kept in anything written from it. */
    "mcp__mattpocock-skills-deck__deck_issue_list": {
      state?: "open" | "closed" | "all"
      type?: "issue" | "map" | "spec" | "all"
      /** Every one must be on the issue. */
      labels?: string[]
      /** A login (GitHub) or name (Markdown) the issue is assigned to. */
      assignee?: string
      /** Text to find in the key or title, ignoring case. */
      query?: string
      limit?: number
      /** Markdown only: the Map's .scratch/<effort> folder. Not with feature. */
      effort?: string
      /** Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort. */
      feature?: string
    }
    /** Change one issue: comment, add or remove labels, replace its assignees, retitle it, rewrite its body, add a Progress entry (newest first), record the maintainer's original words (only ever added to), or close it with a reason. It cannot reopen. A Spec closes only with a comment in the same call and with every implementation ticket already closed. Bodies are at most 60KB. */
    "mcp__mattpocock-skills-deck__deck_issue_patch": {
      /** The ticket: on GitHub its issue number (7 or #7); on Markdown <effort>/<NN> (checkout/02, the Map or Spec itself is <effort>/00), its file path, or a number with effort or feature. */
      key: string | number
      comment?: string
      addLabels?: string[]
      removeLabels?: string[]
      /** Replaces the whole list; [] clears it. */
      assignees?: string[]
      title?: string
      /** Replaces the body; its Progress and original words stay. */
      body?: string
      /** The maintainer's own words, quoted in the body; later calls only add to them. */
      originalWords?: {
        text: string
        /** Where they said it. */
        source?: string
      }
      progress?: {
        percent: number
        note?: string
      }
      /** true closes the issue. false is refused: nothing reopens. */
      close?: boolean
      /** With close: why it closed, in a sentence. It becomes the closing comment (a Map ticket: its Answer). */
      closeReason?: string
      /** How much of the Work Route the reply carries: core (default) is ticket key, session and time for the newest 20 entries; standard adds title and action for every entry. */
      workRouteDetail?: "core" | "standard"
      /** Markdown only: the Map's .scratch/<effort> folder. Not with feature. */
      effort?: string
      /** Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort. */
      feature?: string
    }
    /** Report the ticket you start, switch to, or close, so the Work Route shows what this session is working on. Call it on start, on switch and on close. Pass release=true when you stop working on the ticket. */
    "mcp__mattpocock-skills-deck__deck_issue_report": {
      /** The ticket: on GitHub its issue number (7 or #7); on Markdown <effort>/<NN> (checkout/02, the Map or Spec itself is <effort>/00), its file path, or a number with effort or feature. */
      key: string | number
      /** A few words on what you are doing. */
      note?: string
      /** How much of the Work Route the reply carries: core (default) is ticket key, session and time for the newest 20 entries; standard adds title and action for every entry. */
      workRouteDetail?: "core" | "standard"
      /** true takes the ticket off this session's Work Route. */
      release?: boolean
      /** Markdown only: the Map's .scratch/<effort> folder. Not with feature. */
      effort?: string
      /** Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort. */
      feature?: string
    }
    /** Set a ticket's parent and replace its Blocked-by list, then read the result back. Pass key with parentKey and/or blockedBy, or edges to do several in one call. blockedBy replaces the whole list. On Markdown a ticket's parent is the Map or Spec in its own folder. */
    "mcp__mattpocock-skills-deck__deck_map_link": {
      /** The ticket: on GitHub its issue number (7 or #7); on Markdown <effort>/<NN> (checkout/02, the Map or Spec itself is <effort>/00), its file path, or a number with effort or feature. */
      key?: string | number
      parentKey?: string | number
      /** Replaces the whole list; [] clears it. */
      blockedBy?: Array<string | number>
      edges?: Array<{
        /** The ticket: on GitHub its issue number (7 or #7); on Markdown <effort>/<NN> (checkout/02, the Map or Spec itself is <effort>/00), its file path, or a number with effort or feature. */
        key: string | number
        parentKey?: string | number
        blockedBy?: Array<string | number>
      }>
      /** How much of the Work Route the reply carries: core (default) is ticket key, session and time for the newest 20 entries; standard adds title and action for every entry. */
      workRouteDetail?: "core" | "standard"
      /** Markdown only: the Map's .scratch/<effort> folder. Not with feature. */
      effort?: string
      /** Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort. */
      feature?: string
    }
    /** Create a Map, its children and their edges in one call. Each child has a local key (such as D1); an edge {from:'D3', to:'D1'} makes D3 blocked by D1, and '@map' stands for the new Map. A repeated call with the same planId carries on where an interrupted one stopped. At most 60 children. */
    "mcp__mattpocock-skills-deck__deck_map_plan_create": {
      title: string
      body?: string
      /** Makes a retry resume this plan instead of starting another. */
      planId?: string
      children: Array<{
        /** A local id for edges, such as D1. */
        key: string
        title: string
        body?: string
        kind?: "map-ticket" | "bug" | "issue"
        label?: "wayfinder:research" | "wayfinder:prototype" | "wayfinder:grilling" | "wayfinder:task"
        labels?: string[]
        assignees?: string[]
      }>
      edges?: Array<{
        from: string
        to: string
        type?: "blocked-by" | "parent"
      }>
      labels?: string[]
      /** How much of the Work Route the reply carries: core (default) is ticket key, session and time for the newest 20 entries; standard adds title and action for every entry. */
      workRouteDetail?: "core" | "standard"
      /** Markdown only: the Map's .scratch/<effort> folder. Not with feature. */
      effort?: string
      /** Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort. */
      feature?: string
    }
    /** Read a Map (or Spec) in one call: its children with each one's status (ready, blocked, claimed, open or closed), Level and blockers, the stats across them, and the body's '## ' sections. frontierOnly=true returns only the Ready children; detail='thin' returns each child's key, title and status alone and leaves out the sections. */
    "mcp__mattpocock-skills-deck__deck_map_snapshot": {
      /** The ticket: on GitHub its issue number (7 or #7); on Markdown <effort>/<NN> (checkout/02, the Map or Spec itself is <effort>/00), its file path, or a number with effort or feature. */
      key: string | number
      /** Only the Ready children: open, not blocked, not claimed. */
      frontierOnly?: boolean
      detail?: "full" | "thin"
      /** Markdown only: the Map's .scratch/<effort> folder. Not with feature. */
      effort?: string
      /** Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort. */
      feature?: string
    }
    /** As the last step before replying, recommend 2 to 4 next steps; they show as Suggestion pills above the input, and picking one puts its prompt in the box for the person to send. Each item: intro (the pill text, at most 10 characters), prompt (start it with the /skill to run), reason (why this step, shown on hover) and priority (0-10, higher is more recommended). */
    "mcp__mattpocock-skills-deck__suggest_next_steps": {
      items: Array<{
        /** The pill text, at most 10 characters. */
        intro: string
        /** What the pill puts in the box; start it with the /skill to run. */
        prompt: string
        /** Why this step, shown when the pill is hovered. */
        reason: string
        /** How strongly it is recommended, 0-10. */
        priority: number
      }>
    }
  }
}
