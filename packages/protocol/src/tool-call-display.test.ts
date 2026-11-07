import { getExternalToolPresentation } from "./external-tool-presentation.js";
import { describe, expect, it } from "vitest";

import { buildToolCallDisplayModel } from "./tool-call-display.js";

describe("shared tool-call display mapping", () => {
  it("builds summary from canonical detail", () => {
    const display = buildToolCallDisplayModel({
      name: "read_file",
      status: "running",
      error: null,
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
      },
      cwd: "/tmp/repo",
    });

    expect(display).toEqual({
      displayName: "Read",
      summary: "src/index.ts",
    });
  });

  it("does not infer summaries from unknown raw detail", () => {
    const display = buildToolCallDisplayModel({
      name: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: { command: "npm test" },
        output: null,
      },
    });

    expect(display).toEqual({
      displayName: "Exec command",
    });
  });

  it("uses sub-agent detail for task label and description", () => {
    const display = buildToolCallDisplayModel({
      name: "task",
      status: "running",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        log: "[Read] README.md",
      },
    });

    expect(display).toEqual({
      displayName: "Explore",
      summary: "Inspect repository structure",
    });
  });

  it("builds display model for worktree setup detail", () => {
    const display = buildToolCallDisplayModel({
      name: "paseo_worktree_setup",
      status: "running",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath: "/tmp/repo/.paseo/worktrees/repo/branch",
        branchName: "feature-branch",
        log: "==> [1/1] Running: npm install\n",
        commands: [
          {
            index: 1,
            command: "npm install",
            cwd: "/tmp/repo/.paseo/worktrees/repo/branch",
            log: "==> [1/1] Running: npm install\n",
            status: "running",
            exitCode: null,
          },
        ],
      },
    });

    expect(display).toEqual({
      displayName: "Worktree setup",
      summary: "feature-branch",
    });
  });

  it("provides errorText for failed calls", () => {
    const display = buildToolCallDisplayModel({
      name: "shell",
      status: "failed",
      error: { message: "boom" },
      detail: {
        type: "unknown",
        input: null,
        output: null,
      },
    });

    expect(display.errorText).toBe('{\n  "message": "boom"\n}');
  });

  it("labels terminal interaction rows without a summary when no command is available", () => {
    const display = buildToolCallDisplayModel({
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        icon: "square_terminal",
      },
    });

    expect(display).toEqual({
      displayName: "Terminal",
    });
  });

  it("uses the command as terminal interaction summary when available", () => {
    const display = buildToolCallDisplayModel({
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        label: "npm run test",
        icon: "square_terminal",
      },
    });

    expect(display).toEqual({
      displayName: "Terminal",
      summary: "npm run test",
    });
  });

  it("humanizes Paseo MCP tool names (Claude Code format)", () => {
    const display = buildToolCallDisplayModel({
      name: "mcp__paseo__create_agent",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Create agent");
  });

  it("humanizes Paseo MCP tool names (Codex format)", () => {
    const display = buildToolCallDisplayModel({
      name: "paseo.create_agent",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Create agent");
  });

  it("humanizes list_agents Paseo tool", () => {
    const display = buildToolCallDisplayModel({
      name: "mcp__paseo__list_agents",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("List agents");
  });

  it("does not override speak tool display name", () => {
    const display = buildToolCallDisplayModel({
      name: "speak",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Speak");
  });

  it("labels plan detail rows as Plan", () => {
    const display = buildToolCallDisplayModel({
      name: "plan",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "### Login Screen\n- Build layout",
      },
    });

    expect(display).toEqual({
      displayName: "Plan",
    });
  });
});

describe("external tool presentation", () => {
  function present(
    name: string,
    input: unknown,
    output: unknown = null,
    metadata?: Record<string, unknown>,
  ) {
    return getExternalToolPresentation({
      name,
      detail: { type: "unknown", input, output },
      metadata,
    });
  }

  it.each(["cua_repl.js", "mcp__cua_repl__js", "node_repl.js", "js"])(
    "uses the operation title for %s",
    (name) => {
      const display = buildToolCallDisplayModel({
        name,
        status: "running",
        error: null,
        detail: { type: "unknown", input: { title: "Inspect application windows" }, output: null },
      });
      expect(display.displayName).toBe("Inspect application windows");
    },
  );

  it("keeps computer-use identity before results arrive and recognizes older sky calls", () => {
    expect(present("cua_repl.js", {}).source?.name).toBe("Computer Use");
    expect(present("node_repl.js", { code: "await sky.getApp()" }).source?.name).toBe(
      "Computer Use",
    );
    expect(present("node_repl.js", {}).title).toBe("Run JavaScript");
  });

  it.each(["Chrome", "Safari", "Firefox", "Microsoft Edge", "Arc", "Custom Browser"])(
    "identifies %s browser metadata",
    (name) => {
      const result = present(
        "cua_repl.js",
        { title: "Inspect tabs" },
        {
          _meta: {
            "codex/toolSurface": {
              kind: "browserUse",
              browserFamily: name,
              screenshot: {
                pageUrl: "https://example.com/page",
                faviconUrl: "https://example.com/icon.png",
              },
            },
          },
        },
      );
      expect(result.source?.name).toBe(name);
      expect(result.icon?.url).toBe("https://example.com/icon.png");
      expect(result.source?.icon?.app?.value).toBe(name === "Chrome" ? "Google Chrome" : name);
    },
  );

  it("preserves arbitrary native applications and their provider-host icons", () => {
    const result = present(
      "cua_repl.js",
      {},
      {
        _meta: {
          "codex/toolSurface": {
            kind: "computerUse",
            app: { kind: "appId", appId: "com.example.editor" },
          },
        },
      },
      {
        codexAppContext: { appName: "Example Editor" },
        nativeToolIcon: "data:image/png;base64,YQ==",
      },
    );
    expect(result.source).toMatchObject({
      name: "Example Editor",
      key: "app:appId:com.example.editor",
    });
    expect(result.icon).toEqual({
      app: { kind: "appId", value: "com.example.editor" },
      url: "data:image/png;base64,YQ==",
    });
  });

  it("uses MCP integration names, action titles and themed logos", () => {
    const result = present(
      "mcp__calendar__list_events",
      {},
      {
        _meta: {
          source: {
            name: "Calendar",
            logoUrl: "https://example.com/light.png",
            logoUrlDark: "https://example.com/dark.png",
          },
        },
      },
      { codexAppContext: { actionName: "Read today's events", connectorId: "calendar" } },
    );
    expect(result.title).toBe("Read today's events");
    expect(result.source?.name).toBe("Calendar");
    expect(result.icon).toEqual({
      url: "https://example.com/light.png",
      darkUrl: "https://example.com/dark.png",
    });
  });

  it("rejects executable URLs, file URLs, malformed app identities and oversized titles", () => {
    const result = present(
      "cua_repl.js",
      { title: "a".repeat(513) },
      {
        _meta: {
          "codex/toolSurface": {
            kind: "computerUse",
            app: { kind: "appId", appId: "../../secret" },
            logoUrl: "file:///etc/passwd",
            logoUrlDark: "javascript:alert(1)",
          },
        },
      },
    );
    expect(result.title).toBe("Computer use");
    expect(result.icon).toBeUndefined();
    expect(result.source?.name).toBe("Computer Use");
  });

  it("keeps canonical and Paseo tools in their existing presentation", () => {
    expect(present("paseo.list_agents", {})).toEqual({});
    expect(
      getExternalToolPresentation({
        name: "read_file",
        detail: { type: "read", filePath: "/tmp/file" },
      }),
    ).toEqual({});
  });
});

it("does not infer favicon requests against a remote browser's localhost", () => {
  const presentation = getExternalToolPresentation({
    name: "cua_repl.js",
    detail: {
      type: "unknown",
      input: {},
      output: {
        _meta: {
          "codex/toolSurface": {
            kind: "browserUse",
            browserFamily: "chrome",
            screenshot: {
              pageUrl: "http://localhost:3001/",
              faviconUrl: "http://localhost:3001/favicon.ico",
            },
          },
        },
      },
    },
  });
  expect(presentation.icon?.url).toBeUndefined();
  expect(presentation.icon?.app?.value).toBe("Google Chrome");
});
