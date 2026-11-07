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
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  getExternalToolPresentation,
  type NativeToolApp,
} from "@getpaseo/protocol/external-tool-presentation";

const execute = promisify(execFile);
const cache = new Map<string, { expires: number; value: Promise<string | undefined> }>();
let queue: Promise<unknown> = Promise.resolve();

/** Resolve on the provider host so remote clients never read icons from the wrong machine. */
export async function decorateNativeToolIcon(item: ToolCallTimelineItem): Promise<void> {
  const presentation = getExternalToolPresentation(item);
  const app = presentation.source?.icon?.app ?? presentation.icon?.app;
  if (!app) return;
  try {
    const icon = await resolveNativeToolIcon(app);
    if (icon) item.metadata = { ...item.metadata, nativeToolIcon: icon };
  } catch (error) {
    process.emitWarning(`Unable to resolve tool app icon: ${String(error)}`);
  }
}

export function resolveNativeToolIcon(app: NativeToolApp): Promise<string | undefined> {
  if (process.platform !== "darwin") return Promise.resolve(undefined);
  const key = JSON.stringify(app);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = queue.then(() => readIcon(app));
  queue = value.catch(() => undefined);
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 3_600_000, value });
  // Icon availability must not determine whether a tool result reaches the timeline.
  return value.catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
}

async function readIcon(app: NativeToolApp): Promise<string | undefined> {
  if (
    !app.value ||
    app.value.length > 512 ||
    [...app.value].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return undefined;
  const escaped = app.value.replace(/([\\'*?])/gu, "\\$1");
  const field = app.kind === "appId" ? "kMDItemCFBundleIdentifier" : "kMDItemDisplayName";
  const found = await command("/usr/bin/mdfind", [
    `kMDItemContentType == 'com.apple.application-bundle' && ${field} == '${escaped}'`,
  ]);
  const appPath = found.split(/\r?\n/u).find((path) => path.endsWith(".app"));
  if (!appPath) return undefined;
  const resources = await realpath(join(appPath, "Contents", "Resources"));
  const plist = JSON.parse(
    await command("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      join(appPath, "Contents", "Info.plist"),
    ]),
  ) as Record<string, unknown>;
  const iconName = plist.CFBundleIconFile ?? plist.CFBundleIconName;
  const entries = await readdir(resources);
  let file: string | undefined;
  if (typeof iconName === "string" && basename(iconName) === iconName) {
    const candidate = extname(iconName) ? iconName : `${iconName}.icns`;
    if (entries.includes(candidate)) file = candidate;
  }
  file ??=
    entries.find((entry) => entry === "AppIcon.icns") ??
    entries.find((entry) => entry.endsWith(".icns"));
  if (!file) return undefined;
  const source = await realpath(join(resources, file));
  const path = relative(resources, source);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return undefined;
  const directory = await mkdtemp(join(tmpdir(), "paseo-tool-icon-"));
  try {
    const target = join(directory, "icon.png");
    await command("/usr/bin/sips", [
      "-z",
      "64",
      "64",
      "-s",
      "format",
      "png",
      source,
      "--out",
      target,
    ]);
    const bytes = await readFile(target);
    return bytes.length <= 32768 ? `data:image/png;base64,${bytes.toString("base64")}` : undefined;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function command(file: string, args: string[]): Promise<string> {
  const result = await execute(file, args, { timeout: 5000, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}
