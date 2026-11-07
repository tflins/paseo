/*!
 * Adapted from T3 Code tool presentation and native icon resolution.
 * https://github.com/pingdotgg/t3code/tree/83a3674ffd84ffb33de768210c806cb1ac53fd80
 *
 * MIT License
 *
 * Copyright (c) 2026 T3 Tools Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { ToolCallDetail } from "./agent-types.js";

export interface NativeToolApp {
  kind: "appId" | "displayName";
  value: string;
}

export interface ExternalToolIcon {
  url?: string;
  darkUrl?: string;
  app?: NativeToolApp;
}

export interface ExternalToolSource {
  key: string;
  name: string;
  kind: "browser" | "computer" | "integration";
  icon?: ExternalToolIcon;
}

export interface ExternalToolPresentation {
  title?: string;
  icon?: ExternalToolIcon;
  source?: ExternalToolSource;
}

interface ExternalToolInput {
  name: string;
  detail: ToolCallDetail;
  metadata?: Record<string, unknown>;
}

interface ToolContext {
  server?: string;
  tool: string;
  args?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  surface?: Record<string, unknown>;
  appContext?: Record<string, unknown>;
  source?: Record<string, unknown>;
  nativeUrl?: string;
}

/** Provider metadata remains optional; absent metadata never changes canonical tool details. */
export function getExternalToolPresentation(input: ExternalToolInput): ExternalToolPresentation {
  if (input.detail.type !== "unknown") return {};
  const context = toolContext(input);
  if (context.server === "paseo") return {};
  const title = operationTitle(context);
  const logo =
    logoIcon(context.surface) ?? logoIcon(context.source) ?? logoIcon(context.appContext);
  if (context.surface?.kind === "browserUse")
    return { title, ...browserPresentation(context, logo) };
  if (context.surface?.kind === "computerUse" || isComputerUse(context))
    return { title, ...computerPresentation(context, logo) };
  return integrationPresentation(context, { title, icon: logo });
}

function toolContext(input: ExternalToolInput): ToolContext {
  const qualified = /^mcp__(.+?)__(.+)$/u.exec(input.name) ?? /^([^.]+)\.(.+)$/u.exec(input.name);
  const detail = input.detail.type === "unknown" ? input.detail : undefined;
  const result = record(detail?.output);
  const meta = record(result?._meta);
  return {
    server: qualified?.[1],
    tool: qualified?.[2] ?? input.name,
    args: record(detail?.input),
    meta,
    surface: record(meta?.["codex/toolSurface"]),
    appContext: record(input.metadata?.codexAppContext),
    source: record(meta?.source),
    nativeUrl: imageUrl(input.metadata?.nativeToolIcon),
  };
}

function isRepl(tool: string): boolean {
  return ["js", "cua_repl.js", "node_repl.js"].includes(tool);
}

function isComputerUse(context: ToolContext): boolean {
  if (context.server?.endsWith("cua_repl") || context.tool === "cua_repl.js") return true;
  const code = context.args?.code;
  return (
    isRepl(context.tool) &&
    typeof code === "string" &&
    /\b(?:sky|cua)\s*\.|["']@oai\/sky["']/u.test(code)
  );
}

function operationTitle(context: ToolContext): string | undefined {
  const action = text(context.appContext?.actionName);
  if (!isRepl(context.tool)) return action;
  return (
    text(context.args?.title) ??
    action ??
    (isComputerUse(context) ? "Computer use" : "Run JavaScript")
  );
}

function browserPresentation(
  context: ToolContext,
  logo?: ExternalToolIcon,
): ExternalToolPresentation {
  const { surface, appContext } = context;
  const name = browserName(
    text(appContext?.appName) ?? text(surface?.browserFamily) ?? surface?.backend,
  );
  const appName = name === "Chrome" ? "Google Chrome" : name;
  const app: NativeToolApp = { kind: "displayName", value: appName };
  const sourceIcon = logo ?? { app, url: context.nativeUrl };
  const icon = websiteIcon(context) ?? sourceIcon;
  return {
    icon,
    source: { key: `browser:${name.toLowerCase()}`, name, kind: "browser", icon: sourceIcon },
  };
}

function websiteIcon(context: ToolContext): ExternalToolIcon | undefined {
  const tabs = Array.isArray(context.surface?.openTabs) ? context.surface.openTabs : [];
  const pages = [
    record(context.surface?.screenshot),
    record(context.meta?.browser_use),
    ...tabs.toReversed().map(record),
  ];
  const page = pages.find((candidate) => httpUrl(candidate?.pageUrl ?? candidate?.url));
  const url = imageUrl(page?.faviconUrl ?? page?.favIconUrl);
  // Deriving /favicon.ico here would resolve a remote host's localhost on the viewing device.
  if (!url) return undefined;
  return {
    url,
    darkUrl: imageUrl(page?.faviconUrlDark ?? page?.favIconUrlDark),
  };
}

function computerPresentation(
  context: ToolContext,
  logo?: ExternalToolIcon,
): ExternalToolPresentation {
  const app = nativeApp(context.surface?.app);
  const name = computerName(context, app);
  const icon = logo ?? (app ? { app, url: context.nativeUrl } : undefined);
  const key = app ? `app:${app.kind}:${app.value.toLowerCase()}` : "computer-use";
  return { icon, source: { key, name, kind: "computer", icon } };
}

function computerName(context: ToolContext, app?: NativeToolApp): string {
  const args = context.args;
  const appName = app?.kind === "displayName" ? app.value : appNameFromId(app?.value);
  return (
    text(context.appContext?.appName) ??
    text(args?.appName) ??
    text(args?.application) ??
    text(args?.app) ??
    appName ??
    "Computer Use"
  );
}

function integrationPresentation(
  context: ToolContext,
  presentation: ExternalToolPresentation,
): ExternalToolPresentation {
  const server = text(context.appContext?.connectorId) ?? context.server;
  if (!server) return presentation;
  const name =
    text(context.appContext?.appName) ??
    text(context.source?.name) ??
    server.replace(/[_-]+/gu, " ");
  return {
    title: presentation.title ?? text(context.tool.replace(/[_-]+/gu, " ")),
    icon: presentation.icon,
    source: {
      key: `mcp:${server.toLowerCase()}`,
      name,
      kind: "integration",
      icon: presentation.icon,
    },
  };
}

function nativeApp(value: unknown): NativeToolApp | undefined {
  const app = record(value);
  if (
    app?.kind === "appId" &&
    typeof app.appId === "string" &&
    /^[A-Za-z0-9._-]{1,512}$/u.test(app.appId)
  ) {
    return { kind: "appId", value: app.appId };
  }
  const name = text(app?.displayName);
  return app?.kind === "displayName" && name ? { kind: "displayName", value: name } : undefined;
}

function browserName(value: unknown): string {
  const name = text(value);
  if (!name) return "Browser";
  const normalized = name.toLowerCase();
  for (const [match, label] of [
    ["chrome", "Chrome"],
    ["chromium", "Chrome"],
    ["edge", "Microsoft Edge"],
    ["firefox", "Firefox"],
    ["safari", "Safari"],
    ["arc", "Arc"],
  ]) {
    if (normalized.includes(match!)) return label!;
  }
  return normalized === "iab" || normalized.includes("in-app") ? "Browser" : name;
}

function appNameFromId(id: string | undefined): string | undefined {
  const names: Record<string, string> = {
    "com.apple.finder": "Finder",
    "com.apple.safari": "Safari",
    "com.google.chrome": "Chrome",
    "com.microsoft.edgemac": "Microsoft Edge",
    "org.mozilla.firefox": "Firefox",
    "company.thebrowser.browser": "Arc",
  };
  return id ? names[id.toLowerCase()] : undefined;
}

function logoIcon(value: Record<string, unknown> | undefined): ExternalToolIcon | undefined {
  const url = imageUrl(value?.logoUrl);
  return url ? { url, darkUrl: imageUrl(value?.logoUrlDark ?? value?.logoDarkUrl) } : undefined;
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/u.test(value) &&
    value.length <= 65536
  )
    return value;
  const url = httpUrl(value);
  if (!url) return undefined;
  const hostname = new URL(url).hostname;
  const loopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.");
  return loopback ? undefined : url;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 512) return undefined;
  const result = value.trim().replace(/\s+/gu, " ");
  return result || undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
