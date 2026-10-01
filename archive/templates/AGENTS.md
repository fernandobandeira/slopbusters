# Project Name

<!--
  Copy this to your project root as AGENTS.md and customize.

  Setup:
  1. basic-memory project add "your-project" ./.memory
  2. mkdir -p .memory/{decisions,patterns,research,sessions,diagrams}
  3. Update **Primary** below with your project name

  Session Management:
  One orchestrator per chat. Start a new conversation when switching orchestrators.
  Each maintains persona and context throughout the session - mixing them causes confusion.
  Memory persists across sessions via Basic Memory.
-->

## Basic Memory Configuration

**Primary**: `YOUR_PROJECT_NAME`

## Templates Configuration

**Location**: `~/.djinn/templates/`

<!--
  Templates path can be:
  - `~/.djinn/templates/` - Global templates (default)
  - `templates/` - Local project templates (for per-project customization)

  Local templates override global ones.
-->

> **CRITICAL: NEVER manually read, write, or edit files in `.memory/`**
>
> The `.memory/` directory is managed exclusively by Basic Memory MCP.
> - **ALWAYS** use `mcp__basic-memory__*` tools for ALL memory operations
> - **NEVER** use Read, Write, Edit, Bash, or any file system tool on `.memory/`
> - **NEVER** use `cat`, `grep`, `find`, or any shell command on `.memory/`
>
> Manual file operations bypass indexing, break semantic links, and corrupt the knowledge graph.

<!-- Optional: shared KB for team knowledge -->
<!-- **Shared**: `company-kb` -->

### Usage

Always include `project` parameter in Basic Memory MCP calls:

```
mcp__basic-memory__search_notes(query="topic", project="YOUR_PROJECT_NAME")

mcp__basic-memory__write_note(
    title="Note Title",
    content="Content with [[wikilinks]]",
    folder="decisions",
    project="YOUR_PROJECT_NAME"
)

mcp__basic-memory__read_note(identifier="note-name", project="YOUR_PROJECT_NAME")

mcp__basic-memory__recent_activity(project="YOUR_PROJECT_NAME")

mcp__basic-memory__build_context(url="memory://topic", project="YOUR_PROJECT_NAME")
```

### Workflow

1. **Search first** - Always check what exists before creating
2. **Link notes** - Use [[wikilinks]] to connect related content
3. **Include project** - Every MCP call needs the project parameter

### Operations

Choose the right operation for the task:

| Operation | When to Use |
|-----------|-------------|
| `write_note` | Create new notes or completely rewrite existing ones |
| `edit_note` | Modify part of an existing note (append, prepend, find_replace, replace_section) |
| `move_note` | Rename a note or relocate it to a different folder |

**Prefer `edit_note` over delete + recreate** when updating existing content:

```python
# Append new section to existing note
mcp__basic-memory__edit_note(
    identifier="note-name",
    operation="append",
    content="\n\n## New Section\nAdditional content...",
    project="YOUR_PROJECT_NAME"
)

# Replace a specific section
mcp__basic-memory__edit_note(
    identifier="note-name",
    operation="replace_section",
    section="## Section Name",
    content="## Section Name\nUpdated content...",
    project="YOUR_PROJECT_NAME"
)

# Rename or move a note
mcp__basic-memory__move_note(
    identifier="old-name",
    destination_path="new-folder/new-name.md",
    project="YOUR_PROJECT_NAME"
)
```

### Folders

| Content | Folder |
|---------|--------|
| Architecture decisions | `decisions/` |
| Reusable patterns | `patterns/` |
| Research & analysis | `research/` |
| Brainstorming sessions | `sessions/` |
| Technical diagrams | `diagrams/` |

### Wikilinks

Every note should include a `## Relations` section:

```markdown
## Relations
- [[project]] - project context
- [[related-note]] - related content
```

## Web Scraping with Crawl4AI

Use **crawl4ai** MCP tools for fetching and scraping web content. Prefer crawl4ai over webfetch for better content extraction.

### Available Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mcp__crawl4ai__md` | Convert webpage to markdown | Documentation, articles, blog posts |
| `mcp__crawl4ai__html` | Get cleaned HTML | When you need raw structure |
| `mcp__crawl4ai__screenshot` | Capture full-page screenshot | Visual reference, UI analysis |
| `mcp__crawl4ai__crawl` | Crawl multiple URLs | Batch research, competitive analysis |
| `mcp__crawl4ai__execute_js` | Execute JS on page | Dynamic content, SPAs |

### Usage Examples

```python
# Fetch documentation as markdown (most common)
mcp__crawl4ai__md(url="https://docs.example.com/guide")

# Fetch with content filtering (BM25 relevance)
mcp__crawl4ai__md(url="https://example.com", f="bm25", q="authentication patterns")

# Batch crawl multiple competitor sites
mcp__crawl4ai__crawl(urls=["https://competitor1.com", "https://competitor2.com"])

# Screenshot for visual analysis
mcp__crawl4ai__screenshot(url="https://example.com/ui", screenshot_wait_for=3)
```

### Filter Strategies

| Filter | Use Case |
|--------|----------|
| `raw` | Full page content, no filtering |
| `fit` | Smart extraction of main content (default) |
| `bm25` | Query-based relevance filtering |
| `llm` | LLM-powered content extraction |

## After Delegating to Sub-agents

When you delegate to a sub-agent (market-researcher, competitive-analyzer, diagram-generator, knowledge-harvester), they return synthesis - they don't write to Basic Memory.

**You are responsible for writing their results to KB.**

Sub-agent results include:
- `synthesized_content` - Markdown ready for storage
- `suggested_title` - Recommended note title
- `suggested_folder` - Where to store (research, diagrams, etc.)

After receiving results, write to Basic Memory:
```python
mcp__basic-memory__write_note(
    title=result.suggested_title,
    content=result.synthesized_content,
    folder=result.suggested_folder,
    project="YOUR_PROJECT_NAME"
)
```

<!-- Add your project-specific instructions below -->
