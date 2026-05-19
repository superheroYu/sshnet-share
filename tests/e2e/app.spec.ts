import { expect, Page, test } from "@playwright/test";

type ProxyProtocol = "http" | "socks5";
type AuthMethod = "key" | "agent" | "password";

interface Profile {
  id: string;
  schemaVersion: number;
  name: string;
  localProxyHost: "127.0.0.1";
  localProxyPort: number;
  localProxyProtocol: ProxyProtocol;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  authMethod: AuthMethod;
  privateKeyPath: string;
  connectTimeoutSeconds: number;
  reconnectEnabled: boolean;
  reconnectIntervalSeconds: number;
  rememberSshPassword: boolean;
  remoteBindHost: "127.0.0.1";
  remoteProxyPort: number;
  noProxy: string[];
}

declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args?: Record<string, any>) => Promise<unknown>;
      transformCallback: (callback?: (event: any) => void) => number;
      unregisterCallback: (id: number) => undefined;
      convertFileSrc: (filePath: string) => string;
      metadata: {
        currentWindow: { label: string };
        currentWebview: { label: string };
      };
    };
    __SSHNET_TEST_CONTROLS__?: {
      holdStart?: boolean;
      holdStop?: boolean;
      releaseStart?: () => void;
      releaseStop?: () => void;
      hostKeyTrustAction?: "new" | "unchanged" | "replace";
      trustHostKeyRequests?: Array<{ allowReplace?: boolean }>;
      lastExportFilter?: {
        levels: string[];
        profileId: string | null;
        source: string | null;
        fromTimestampMs?: number | null;
        toTimestampMs?: number | null;
      };
      lastPreviewFilter?: {
        levels: string[];
        profileId: string | null;
        source: string | null;
        fromTimestampMs?: number | null;
        toTimestampMs?: number | null;
      };
      clearLogCount?: number;
      diagnosticBundleExportCount?: number;
      updateAvailable?: boolean;
      updateCheckCount?: number;
      updateInstallCount?: number;
      restartCount?: number;
      dialogOpenResult?: string | string[] | null;
      lastSavedProfiles?: Profile[];
      lastStartupPreferences?: { silentStartOnBoot: boolean };
      lastRevealedPath?: string;
      emitTauriEvent?: (event: string, payload: unknown) => void;
      setTunnelStatus?: (profileId: string, status: unknown) => void;
    };
  }
}

function profile(overrides: Partial<Profile>): Profile {
  return {
    id: "profile-office",
    schemaVersion: 2,
    name: "Office Proxy",
    localProxyHost: "127.0.0.1",
    localProxyPort: 2334,
    localProxyProtocol: "http",
    sshHost: "office.example.com",
    sshPort: 22,
    sshUser: "appuser",
    authMethod: "key",
    privateKeyPath: "C:\\Users\\user\\.ssh\\id_ed25519",
    connectTimeoutSeconds: 10,
    reconnectEnabled: false,
    reconnectIntervalSeconds: 10,
    rememberSshPassword: false,
    remoteBindHost: "127.0.0.1",
    remoteProxyPort: 27890,
    noProxy: ["localhost", "127.0.0.1", "::1"],
    ...overrides,
  };
}

async function installTauriMock(page: Page) {
  await page.addInitScript(({ initialProfiles }) => {
    window.localStorage.clear();
    window.confirm = () => true;

    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    window.__SSHNET_TEST_CONTROLS__ = {};
    let callbackId = 0;
    const callbacks = new Map<number, (event: any) => void>();
    const eventListeners = new Map<string, Set<number>>();
    const emitTauriEvent = (event: string, payload: unknown) => {
      for (const id of eventListeners.get(event) ?? []) {
        callbacks.get(id)?.({ event, payload, id });
      }
    };
    window.__SSHNET_TEST_CONTROLS__!.emitTauriEvent = emitTauriEvent;
    const waitForTestHold = (holdKey: "holdStart" | "holdStop", releaseKey: "releaseStart" | "releaseStop") =>
      new Promise<void>((resolve) => {
        const controls = window.__SSHNET_TEST_CONTROLS__;
        if (!controls?.[holdKey]) {
          resolve();
          return;
        }
        controls[releaseKey] = () => {
          controls[holdKey] = false;
          controls[releaseKey] = undefined;
          resolve();
        };
      });
    const state = {
      profiles: clone(initialProfiles),
      savedPasswords: new Set<string>(),
      startOnBoot: false,
      startupPreferences: { silentStartOnBoot: true },
      statuses: Object.fromEntries(
        initialProfiles.map((item) => [
          item.id,
          { status: "stopped", detail: "隧道未启动。", pid: null },
        ]),
      ),
      logs: [
        {
          id: 1,
          timestampMs: Date.now(),
          level: "INFO",
          source: "app",
          profileId: null,
          message: "SSHNet Share started",
        },
        {
          id: 2,
          timestampMs: Date.now(),
          level: "WARN",
          source: "ssh_stderr",
          profileId: "profile-home",
          message: "Home warning",
        },
        {
          id: 3,
          timestampMs: Date.now(),
          level: "ERROR",
          source: "ssh_stderr",
          profileId: "profile-office",
          message: "Office error",
        },
      ],
      appEvents: [] as Array<{
        id: number;
        timestampMs: number;
        level: "INFO" | "WARN" | "ERROR";
        category: string;
        title: string;
        message: string;
        profileId?: string | null;
      }>,
    };

    window.__SSHNET_TEST_CONTROLS__!.setTunnelStatus = (profileId, status) => {
      state.statuses[profileId] = clone(status);
    };

    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, any> = {}) => {
        switch (cmd) {
          case "get_environment_status":
            return [
              {
                key: "ssh",
                label: "OpenSSH Client",
                status: "ready",
                detail: "OpenSSH_for_Windows_9.5p2",
              },
              {
                key: "ssh-keyscan",
                label: "ssh-keyscan",
                status: "ready",
                detail: "available",
              },
              {
                key: "webview2",
                label: "WebView2 Runtime",
                status: "ready",
                detail: "ready",
              },
              {
                key: "profile-store",
                label: "Profile Store",
                status: "ready",
                detail: "ready",
              },
            ];
          case "load_profiles":
            return clone(state.profiles);
          case "save_profiles":
            state.profiles = clone(args.profiles);
            window.__SSHNET_TEST_CONTROLS__!.lastSavedProfiles = clone(state.profiles);
            return clone(state.profiles);
          case "plugin:dialog|open":
            return window.__SSHNET_TEST_CONTROLS__?.dialogOpenResult ?? null;
          case "list_ssh_config_hosts":
            return [
              {
                alias: "office-via-config",
                hostName: "ssh.config.example.com",
                user: "deploy",
                port: 2222,
                identityFile: "C:\\Users\\user\\.ssh\\config_key",
              },
            ];
          case "get_tunnel_status":
            return state.statuses[String(args.profileId)] ?? {
              status: "stopped",
              detail: "隧道未启动。",
              pid: null,
            };
          case "get_tunnel_logs":
            return clone(state.logs);
          case "get_app_events":
            return clone(state.appEvents);
          case "record_app_event": {
            const event = {
              id: state.appEvents.length + 1,
              timestampMs: Date.now(),
              level: args.level ?? "INFO",
              category: args.category ?? "updates",
              title: String(args.title ?? ""),
              message: String(args.message ?? ""),
              profileId: args.profileId ?? null,
            };
            state.appEvents.push(event);
            emitTauriEvent("sshnet-event", event);
            return clone(event);
          }
          case "append_app_log":
            const entry = {
              id: state.logs.length + 1,
              timestampMs: Date.now(),
              level: args.level ?? "INFO",
              source: "app",
              profileId: null,
              message: String(args.message ?? ""),
            };
            state.logs.push(entry);
            emitTauriEvent("sshnet-log-entry", entry);
            return null;
          case "clear_tunnel_logs":
            state.logs = [];
            window.__SSHNET_TEST_CONTROLS__!.clearLogCount =
              (window.__SSHNET_TEST_CONTROLS__!.clearLogCount ?? 0) + 1;
            return null;
          case "has_saved_ssh_password":
            return state.savedPasswords.has(String(args.profileId));
          case "forget_saved_ssh_password":
            state.savedPasswords.delete(String(args.profileId));
            return null;
          case "get_known_hosts_status":
            return {
              status: "missing",
              detail: "尚未信任该服务器 Host Key。",
              marker: String(args.profile?.sshHost ?? "office.example.com"),
              path: "C:\\Users\\user\\AppData\\Roaming\\sshnet\\known_hosts",
              trustedKeys: [],
              trustedKeySetId: "empty",
            };
          case "probe_local_proxy":
            return {
              reachable: true,
              protocol: args.profile?.localProxyProtocol ?? "http",
              detail: "本地代理可用。",
            };
          case "discover_local_proxies":
            return {
              candidates: [
                {
                  host: "127.0.0.1",
                  port: 2334,
                  protocol: "http",
                  source: "profile",
                  detail: "profile port",
                },
              ],
              scannedPorts: [2334, 7890],
              detail: "已发现 1 个本地代理。",
            };
          case "scan_host_keys":
            return {
              profileId: args.profile?.id ?? "profile-office",
              marker: args.profile?.sshHost ?? "office.example.com",
              host: args.profile?.sshHost ?? "office.example.com",
              port: args.profile?.sshPort ?? 22,
              hostKeys: ["office.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE2E"],
              fingerprints: [
                {
                  host: args.profile?.sshHost ?? "office.example.com",
                  algorithm: "ssh-ed25519",
                  fingerprint: "SHA256:testFingerprint",
                  keyId: "test-key",
                },
              ],
              existingKeys:
                window.__SSHNET_TEST_CONTROLS__?.hostKeyTrustAction === "replace"
                  ? [
                      {
                        host: args.profile?.sshHost ?? "office.example.com",
                        algorithm: "ssh-ed25519",
                        fingerprint: "SHA256:oldFingerprint",
                        keyId: "old-key",
                      },
                    ]
                  : [],
              existingKeySetId:
                window.__SSHNET_TEST_CONTROLS__?.hostKeyTrustAction === "replace"
                  ? "old-key-set"
                  : "empty",
              scannedKeySetId: "scan-1",
              trustAction: window.__SSHNET_TEST_CONTROLS__?.hostKeyTrustAction ?? "new",
              scannedAt: Date.now(),
              detail: "扫描到 1 条 host key。",
            };
          case "trust_host_keys":
            window.__SSHNET_TEST_CONTROLS__!.trustHostKeyRequests = [
              ...(window.__SSHNET_TEST_CONTROLS__!.trustHostKeyRequests ?? []),
              { allowReplace: args.request?.allowReplace },
            ];
            return {
              status: "trusted",
              detail: "已信任 1 条当前服务器 Host Key。",
              marker: args.profile?.sshHost ?? "office.example.com",
              path: "C:\\Users\\user\\AppData\\Roaming\\sshnet\\known_hosts",
              trustedKeys: [
                {
                  host: args.profile?.sshHost ?? "office.example.com",
                  algorithm: "ssh-ed25519",
                  fingerprint: "SHA256:testFingerprint",
                  keyId: "test-key",
                },
              ],
              trustedKeySetId: "scan-1",
            };
          case "start_tunnel": {
            const target = args.profile;
            if (target.authMethod === "password" && !args.authSecret) {
              if (!target.rememberSshPassword || !state.savedPasswords.has(target.id)) {
                throw new Error("password auth requires an authSecret");
              }
            }
            await waitForTestHold("holdStart", "releaseStart");
            if (target.authMethod === "password" && target.rememberSshPassword && args.authSecret) {
              state.savedPasswords.add(target.id);
            }
            state.statuses[target.id] = {
              status: "running",
              detail: `${target.name} SSH 反向隧道已启动，pid=42`,
              pid: 42,
              lastConnectedAt: Date.now() - 84_000,
            };
            return state.statuses[target.id];
          }
          case "stop_tunnel":
            await waitForTestHold("holdStop", "releaseStop");
            state.statuses[String(args.profileId)] = {
              status: "stopped",
              detail: "SSH 反向隧道已停止，pid=42",
              pid: null,
            };
            return state.statuses[String(args.profileId)];
          case "export_tunnel_logs":
            window.__SSHNET_TEST_CONTROLS__!.lastExportFilter = args.filter;
            state.appEvents.push({
              id: state.appEvents.length + 1,
              timestampMs: Date.now(),
              level: "INFO",
              category: "logs",
              title: "日志已导出",
              message: "已导出 2 行日志，脱敏 1 处。",
              profileId: null,
            });
            emitTauriEvent("sshnet-event", state.appEvents[state.appEvents.length - 1]);
            return {
              path: "C:\\Users\\user\\AppData\\Roaming\\sshnet\\logs\\exports\\test.log",
              directory: "C:\\Users\\user\\AppData\\Roaming\\sshnet\\logs\\exports",
              lineCount: 2,
              redactionCount: 1,
              detail: "已导出脱敏日志。",
            };
          case "preview_tunnel_logs":
            window.__SSHNET_TEST_CONTROLS__!.lastPreviewFilter = args.filter;
            return {
              lineCount: 2,
              redactionCount: 1,
              previewLines: [
                "1 [ERROR] ssh_stderr profile=<profile-name> Office error",
                "2 [INFO] app SSHNet Share started",
              ],
            };
          case "get_log_storage_info":
            return {
              logDir: "C:\\Users\\user\\AppData\\Roaming\\sshnet\\logs",
              currentFile: "C:\\Users\\user\\AppData\\Roaming\\sshnet\\logs\\current.jsonl",
              totalBytes: 1536,
              fileCount: 3,
            };
          case "export_diagnostic_bundle": {
            window.__SSHNET_TEST_CONTROLS__!.diagnosticBundleExportCount =
              (window.__SSHNET_TEST_CONTROLS__!.diagnosticBundleExportCount ?? 0) + 1;
            const event = {
              id: state.appEvents.length + 1,
              timestampMs: Date.now(),
              level: "INFO" as const,
              category: "diagnostics",
              title: "诊断包已导出",
              message: "诊断包已保存到本地，不会自动上传。",
              profileId: null,
            };
            state.appEvents.push(event);
            emitTauriEvent("sshnet-event", event);
            return {
              path: "C:\\Users\\user\\AppData\\Roaming\\sshnet\\logs\\diagnostics\\sshnet-diagnostic-test.zip",
              directory: "C:\\Users\\user\\AppData\\Roaming\\sshnet\\logs\\diagnostics",
              detail: "诊断包已导出：sshnet-diagnostic-test.zip",
            };
          }
          case "plugin:autostart|is_enabled":
            return state.startOnBoot;
          case "plugin:autostart|enable":
            state.startOnBoot = true;
            return null;
          case "plugin:autostart|disable":
            state.startOnBoot = false;
            return null;
          case "get_startup_preferences":
            return clone(state.startupPreferences);
          case "set_startup_preferences":
            state.startupPreferences = clone(args.preferences);
            window.__SSHNET_TEST_CONTROLS__!.lastStartupPreferences = clone(
              state.startupPreferences,
            );
            return clone(state.startupPreferences);
          case "plugin:updater|check":
            window.__SSHNET_TEST_CONTROLS__!.updateCheckCount =
              (window.__SSHNET_TEST_CONTROLS__!.updateCheckCount ?? 0) + 1;
            return window.__SSHNET_TEST_CONTROLS__?.updateAvailable
              ? {
                  rid: 42,
                  currentVersion: "0.1.0",
                  version: "0.1.1",
                  date: "2026-05-19T00:00:00Z",
                  body: "Test update",
                  rawJson: {},
                }
              : null;
          case "plugin:updater|download_and_install":
            window.__SSHNET_TEST_CONTROLS__!.updateInstallCount =
              (window.__SSHNET_TEST_CONTROLS__!.updateInstallCount ?? 0) + 1;
            args.onEvent?.onmessage?.({ event: "Started", data: { contentLength: 1024 } });
            args.onEvent?.onmessage?.({ event: "Finished" });
            return null;
          case "plugin:process|restart":
            window.__SSHNET_TEST_CONTROLS__!.restartCount =
              (window.__SSHNET_TEST_CONTROLS__!.restartCount ?? 0) + 1;
            return null;
          case "plugin:opener|reveal_item_in_dir":
            window.__SSHNET_TEST_CONTROLS__!.lastRevealedPath =
              typeof args === "string"
                ? args
                : String(
                    args.path ??
                      args.item ??
                      args.filePath ??
                      args.pathToReveal ??
                      JSON.stringify(args),
                  );
            return null;
          case "plugin:event|listen": {
            const listeners = eventListeners.get(String(args.event)) ?? new Set<number>();
            listeners.add(Number(args.handler));
            eventListeners.set(String(args.event), listeners);
            return Number(args.handler);
          }
          case "plugin:event|unlisten": {
            eventListeners.get(String(args.event))?.delete(Number(args.eventId));
            callbacks.delete(Number(args.eventId));
            return null;
          }
          default:
            throw new Error(`Unhandled mock command: ${cmd}`);
        }
      },
      transformCallback: (callback?: (event: any) => void) => {
        callbackId += 1;
        if (callback) {
          callbacks.set(callbackId, callback);
        }
        return callbackId;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
        return undefined;
      },
      convertFileSrc: (filePath: string) => filePath,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    };
  }, {
    initialProfiles: [
      profile({}),
      profile({
        id: "profile-home",
        name: "Home Lab",
        localProxyPort: 1081,
        sshHost: "lab.home.local",
        remoteProxyPort: 27901,
        localProxyProtocol: "socks5",
      }),
    ],
  });
}

function profileName(page: Page, name: string) {
  return page.locator(".name-cell strong", { hasText: name });
}

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await expect(profileName(page, "Office Proxy")).toBeVisible();
});

test("keeps profile actions scoped to workspace pages", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeHidden();

  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();

  await page.getByRole("button", { name: "日志" }).click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeHidden();
  await expect(page.getByRole("button", { name: "新建配置" })).toBeHidden();
  await expect(page.getByRole("button", { name: "清空" })).toBeVisible();

  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "语言设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建配置" })).toBeHidden();
});

test("hides profile management toolbar on the connections page", async ({ page }) => {
  await page.getByRole("button", { name: "活动连接" }).click();

  await expect(page.locator(".top-tabs button", { hasText: "活动连接" })).toHaveClass(/active/);
  const topology = page.locator(".connection-topology");
  await expect(topology).toContainText("本地代理");
  await expect(topology).toContainText("活动隧道");
  await expect(topology).toContainText("SSH 服务器");
  await expect(topology).toContainText("0 个");
  await expect(topology).toContainText("0 台");
  await expect(page.locator(".table-head")).toContainText("连接时长");
  await expect(page.locator(".table-head")).not.toContainText("最后连接");
  await expect(page.locator(".config-table .check-cell")).toHaveCount(0);
  await expect(page.locator(".table-footer")).not.toContainText("已选择");
  await expect(page.locator(".action-row .primary-actions")).toHaveCount(0);
  await expect(page.locator(".action-row .search-tools")).toBeVisible();
  await expect(page.locator(".profiles-empty").getByRole("button", { name: "前往配置列表" })).toBeVisible();
  await expect(page.locator(".action-row").getByRole("button", { name: "新建配置" })).toHaveCount(0);
  await expect(page.locator(".action-row").getByRole("button", { name: "启动" })).toHaveCount(0);
  await expect(page.locator(".action-row").getByRole("button", { name: "停止" })).toHaveCount(0);
  await expect(page.locator(".action-row").getByRole("button", { name: "编辑" })).toHaveCount(0);
  await expect(page.locator(".action-row").getByRole("button", { name: "复制" })).toHaveCount(0);
  await expect(page.locator(".action-row").getByRole("button", { name: "删除" })).toHaveCount(0);
});

test("creates profiles from the more menu and returns to the profiles page", async ({ page }) => {
  await page.getByRole("button", { name: "活动连接" }).click();
  await expect(page.locator(".top-tabs button", { hasText: "活动连接" })).toHaveClass(/active/);
  await page.getByPlaceholder("搜索配置 (Ctrl+F)").fill("no-match");

  await page.locator(".window-tool-item").last().locator("button").first().click();
  await page.locator(".quick-panel").getByRole("button", { name: "新建配置" }).click();

  await expect(page.locator(".top-tabs button", { hasText: "配置列表" })).toHaveClass(/active/);
  await expect(page.getByPlaceholder("搜索配置 (Ctrl+F)")).toHaveValue("");
  await expect(profileName(page, "新建配置 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
});

test("keeps the create button horizontal in narrow editor layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 760 });
  await profileName(page, "Office Proxy").click();

  const createButton = page.locator(".action-row").getByRole("button", { name: "新建配置" });
  await expect(createButton).toBeVisible();
  await expect(createButton).toHaveCSS("white-space", "nowrap");

  const box = await createButton.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(box!.height * 2);
});

test("switches language and color mode without leaking Chinese labels", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: /English/ }).click();
  await expect(page.getByRole("button", { name: "Profiles" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Default Profile Settings" })).toBeVisible();
  await expect(page.getByText("语言设置")).toBeHidden();

  await page.getByRole("button", { name: /Light/ }).click();
  await expect(page.locator("main.app-frame")).toHaveClass(/theme-light/);

  await page.getByRole("button", { name: /Dark/ }).click();
  await expect(page.locator("main.app-frame")).toHaveClass(/theme-dark/);
});

test("configures silent launch at startup", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click();
  const behaviorSection = page.locator(".settings-section", {
    has: page.getByRole("heading", { name: "应用行为" }),
  });
  const startRow = behaviorSection.locator(".settings-toggle-row").nth(0);
  const silentRow = behaviorSection.locator(".settings-toggle-row").nth(1);

  await expect(startRow).toContainText("开机自启动");
  await expect(silentRow).toContainText("开机静默启动");
  await expect(silentRow).toContainText("只保留托盘入口");
  const silentSwitch = silentRow.locator(".switch-button");
  await expect(silentSwitch).toHaveAttribute("aria-checked", "true");
  await expect(silentSwitch).toBeDisabled();

  await startRow.locator(".switch-button").click();
  await expect(startRow.locator(".switch-button")).toHaveAttribute("aria-checked", "true");
  await expect(silentSwitch).toBeEnabled();

  await silentSwitch.click();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.lastStartupPreferences))
    .toEqual({ silentStartOnBoot: false });
  await expect(silentSwitch).toHaveAttribute("aria-checked", "false");
});

test("does not offer Pageant authentication in profile or settings controls", async ({ page }) => {
  await page.locator(".top-tabs button").nth(3).click();
  await expect(page.locator('option[value="pageant"]')).toHaveCount(0);

  await page.locator(".top-tabs button").first().click();
  await profileName(page, "Office Proxy").click();
  await expect(page.locator('option[value="pageant"]')).toHaveCount(0);
});

test("checks for updates and installs only after user confirmation", async ({ page }) => {
  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__!.updateAvailable = true;
  });

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.locator(".settings-page");
  await settings.getByRole("button", { name: "检查更新" }).click();
  await expect(settings).toContainText("发现 0.1.1");
  await expect(settings).toContainText("当前版本 0.1.0");
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.updateInstallCount ?? 0))
    .toBe(0);

  await page.locator(".window-tool-item").first().getByRole("button").click();
  await expect(page.locator(".notifications-panel")).toContainText("发现新版本");
  await page.keyboard.press("Escape");

  await settings.getByRole("button", { name: "下载并安装" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.updateInstallCount ?? 0))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.restartCount ?? 0))
    .toBe(1);
});

test("toggles runtime log dock visibility and expansion", async ({ page }) => {
  const dock = page.locator(".log-dock");
  await expect(dock).toBeVisible();
  await expect(dock).toContainText("SSHNet Share started");
  await expect(dock.locator(".compact-controls")).toBeVisible();
  await expect(dock.locator(".compact-filter-group select")).toHaveValue("all");
  await expect(dock.locator(".compact-filter-group .level-filter button")).toHaveText([
    "INFO",
    "WARN",
    "ERROR",
  ]);
  await expect(dock.locator(".compact-action-group button")).toHaveCount(3);
  await expect(dock.locator(".compact-action-group button").nth(1)).toBeDisabled();
  await expect(dock.getByRole("button", { name: "预览导出" })).toHaveCount(0);
  await expect(dock.locator(".log-date-filter")).toHaveCount(0);

  await dock.locator(".compact-action-group button").first().click();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.lastExportFilter))
    .toEqual({
      levels: ["INFO", "WARN", "ERROR"],
      profileId: null,
      source: null,
      fromTimestampMs: null,
      toTimestampMs: null,
    });
  await expect(dock.locator(".compact-action-group button").nth(1)).toBeEnabled();
  await dock.locator(".compact-action-group button").nth(1).click();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.lastRevealedPath ?? ""))
    .toContain("test.log");

  await dock.getByRole("button", { name: "隐藏" }).click();
  await expect(page.getByRole("button", { name: "显示运行日志" })).toBeVisible();
  await expect(dock).toBeHidden();

  await page.getByRole("button", { name: "显示运行日志" }).click();
  await dock.getByRole("button", { name: "展开" }).click();
  await expect(dock.getByRole("button", { name: "收起" })).toBeVisible();
});

test("updates tunnel status and runtime logs from backend events", async ({ page }) => {
  const officeRow = page.locator(".table-row", {
    has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
  });

  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__?.emitTauriEvent?.("sshnet-status-changed", {
      profileId: "profile-office",
      status: {
        status: "running",
        detail: "event tunnel running",
        pid: 77,
        lastConnectedAt: Date.now() - 15_000,
      },
    });
    window.__SSHNET_TEST_CONTROLS__?.emitTauriEvent?.("sshnet-log-entry", {
      id: 99,
      timestampMs: Date.now(),
      level: "ERROR",
      source: "ssh_stderr",
      profileId: "profile-office",
      message: "event pushed stderr line",
    });
  });

  await expect(officeRow.locator(".status-cell")).toHaveClass(/running/);
  await expect(page.locator(".log-dock")).toContainText("event pushed stderr line");
});

test("shows local app events in the notification center", async ({ page }) => {
  const notificationButton = page.locator(".window-tool-item").first().getByRole("button");

  await notificationButton.click();
  await expect(page.locator(".notifications-panel")).toContainText("暂时没有事件。");

  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__?.emitTauriEvent?.("sshnet-event", {
      id: 99,
      timestampMs: Date.now(),
      level: "WARN",
      category: "tray",
      title: "托盘启动失败",
      message: "请查看运行日志获取详情。",
      profileId: null,
    });
  });

  await expect(page.locator(".notifications-panel")).toContainText("托盘启动失败");
  await expect(page.locator(".notifications-panel")).toContainText("请查看运行日志获取详情。");
});

test("exports a local diagnostic bundle from the help panel", async ({ page }) => {
  await page.locator(".window-tool-item").nth(1).getByRole("button").click();

  const helpPanel = page.locator(".help-panel");
  await expect(helpPanel).toContainText("诊断包");
  await expect(helpPanel).toContainText("不会自动上传");

  await helpPanel.getByRole("button", { name: "导出诊断包" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.diagnosticBundleExportCount ?? 0),
    )
    .toBe(1);
  await expect(helpPanel).toContainText("sshnet-diagnostic-test.zip");

  await helpPanel.getByRole("button", { name: "在文件管理器中定位" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.lastRevealedPath ?? ""))
    .toContain("sshnet-diagnostic-test.zip");
});

test("filters logs by profile and level before exporting", async ({ page }) => {
  await page.getByRole("button", { name: "日志" }).click();
  const logPage = page.locator(".log-page");

  await expect(logPage.getByText("SSHNet Share started")).toBeVisible();
  await expect(logPage.getByText("Home warning")).toBeVisible();
  await expect(logPage.getByText("Office error")).toBeVisible();

  await logPage.getByRole("button", { name: "INFO" }).click();
  await logPage.getByRole("button", { name: "WARN" }).click();
  await expect(logPage.getByText("Home warning")).toBeHidden();
  await expect(logPage.getByText("Office error")).toBeVisible();

  await logPage.getByLabel("配置过滤").selectOption("profile-home");
  await expect(logPage.getByText("Office error")).toBeHidden();

  await logPage.getByRole("button", { name: "导出", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.lastExportFilter))
    .toEqual({
      levels: ["ERROR"],
      profileId: "profile-home",
      source: null,
      fromTimestampMs: null,
      toTimestampMs: null,
    });

  await logPage.getByLabel("配置过滤").selectOption("app");
  await logPage.getByLabel("起始时间").fill("2026-05-19T10:00");
  await logPage.getByLabel("结束时间").fill("2026-05-19T11:00");
  await logPage.getByRole("button", { name: "预览导出" }).click();
  await expect(logPage.getByText("导出预览")).toBeVisible();
  await expect(logPage.getByText("匹配 2 行，已脱敏 1 处。")).toBeVisible();
  await expect(logPage.getByText("Office error")).toBeVisible();
  const previewFilter = await page.evaluate(
    () => window.__SSHNET_TEST_CONTROLS__?.lastPreviewFilter,
  );
  expect(previewFilter?.levels).toEqual(["ERROR"]);
  expect(previewFilter?.profileId).toBeNull();
  expect(previewFilter?.source).toBe("app");
  expect(typeof previewFilter?.fromTimestampMs).toBe("number");
  expect(typeof previewFilter?.toTimestampMs).toBe("number");

  await logPage.getByRole("button", { name: "导出", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.lastExportFilter))
    .toMatchObject({
      levels: ["ERROR"],
      profileId: null,
      source: "app",
    });
  await expect(logPage.getByText("日志目录：1.5 KB，3 个文件")).toBeVisible();

  await logPage.getByLabel("配置过滤").selectOption("all");
  await logPage.getByRole("button", { name: "INFO" }).click();
  await logPage.getByRole("button", { name: "WARN" }).click();
  await page.locator(".top-tabs").getByRole("button", { name: "配置列表", exact: true }).click();
  const dock = page.locator(".log-dock");
  await expect(dock).toContainText("SSHNet Share started");
  await expect(dock).toContainText("Home warning");
  await expect(dock).toContainText("Office error");

  await page.locator(".window-tool-item").first().getByRole("button").click();
  await expect(page.locator(".notifications-panel")).toContainText("日志已导出");
});

test("confirms before clearing runtime logs", async ({ page }) => {
  await page.getByRole("button", { name: "日志" }).click();
  const logPage = page.locator(".log-page");
  await expect(logPage.getByText("Office error")).toBeVisible();

  await logPage.getByRole("button", { name: "清空", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "清空当前运行日志？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(logPage.getByText("Office error")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.clearLogCount ?? 0))
    .toBe(0);

  await logPage.getByRole("button", { name: "清空", exact: true }).click();
  await page.getByRole("button", { name: "清空日志" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.clearLogCount ?? 0))
    .toBe(1);
});

test("applies default settings to newly created profiles", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click();

  await page.getByLabel("默认本地端口").fill("3456");
  await page.getByLabel("默认代理模式").selectOption("socks5");
  await page.getByLabel("默认 SSH 端口").fill("2022");
  await page.getByLabel("默认认证方式").selectOption("agent");
  await page.getByLabel("默认连接超时").fill("12");
  await page.getByRole("switch", { name: /默认启用自动重连/ }).click();
  await page.getByLabel("默认重连间隔").fill("18");
  await page.getByLabel("默认 NO_PROXY").fill("localhost,10.0.0.0/8");

  await page.getByRole("button", { name: "配置列表" }).click();
  await page.getByRole("button", { name: "新建配置" }).click();

  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
  await expect(page.getByLabel("本地端口")).toHaveValue("3456");
  await expect(page.getByLabel("SSH 端口", { exact: true })).toHaveValue("2022");
  await expect(page.getByLabel("远端端口")).toBeVisible();

  await page.getByRole("button", { name: "高级选项" }).click();
  await expect(page.getByLabel("代理模式")).toHaveValue("socks5");
  await expect(page.getByLabel("SSH 认证方式")).toHaveValue("agent");
  await expect(page.getByLabel("连接超时")).toHaveValue("12");
  await expect(page.getByLabel("重连间隔")).toHaveValue("18");
  await expect(page.getByLabel("NO_PROXY")).toHaveValue("localhost,10.0.0.0/8");
});

test("applies SSH config hosts into the profile editor", async ({ page }) => {
  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();

  await page.locator(".host-combo select").selectOption("office-via-config");
  await expect(page.locator(".host-combo input")).toHaveValue("ssh.config.example.com");
  await expect(page.getByLabel("SSH 端口")).toHaveValue("2222");
  await expect(page.getByLabel("SSH 用户")).toHaveValue("deploy");
  await page.getByRole("button", { name: "高级选项" }).click();
  await expect(page.getByLabel("SSH 密钥路径")).toHaveValue("C:\\Users\\user\\.ssh\\config_key");
});

test("selects a private key file from the editor", async ({ page }) => {
  await profileName(page, "Office Proxy").click();
  await page.getByRole("button", { name: "高级选项" }).click();

  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__!.dialogOpenResult = "C:\\Users\\user\\.ssh\\picked_key";
  });
  await page.getByRole("button", { name: "浏览" }).click();

  await expect(page.getByLabel("SSH 密钥路径")).toHaveValue("C:\\Users\\user\\.ssh\\picked_key");
  await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();
  await expect(page.getByText("-i C:\\Users\\user\\.ssh\\picked_key")).toBeVisible();
});

test("blocks saving and starting invalid profile edits", async ({ page }) => {
  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();

  await page.getByLabel("服务器 Host").fill("");
  await expect(page.getByText("服务器 Host 不能为空。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "启动该配置" }).first()).toBeDisabled();

  await page.getByLabel("服务器 Host").fill("office.example.com");
  await page.getByLabel("远端端口").fill("80");
  await expect(page.getByText("远端端口必须在 1024-65535 范围内。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();

  await page.getByLabel("远端端口").fill("27890");
  await expect(page.getByText("远端端口必须在 1024-65535 范围内。")).toBeHidden();
  await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();
});

test("allows profiles to share the same local proxy port", async ({ page }) => {
  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();

  await page.getByLabel("本地端口").fill("1081");

  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByText("本地端口已被 Home Lab 使用。")).toBeHidden();
  await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "启动该配置" }).first()).toBeEnabled();

  await page.getByRole("button", { name: "保存" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__SSHNET_TEST_CONTROLS__?.lastSavedProfiles?.find(
            (profile) => profile.id === "profile-office",
          )?.localProxyPort,
      ),
    )
    .toBe(1081);
});

test("blocks remote port conflicts on the same SSH server", async ({ page }) => {
  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();

  await page.getByLabel("服务器 Host").fill("LAB.HOME.LOCAL");
  await page.getByLabel("远端端口").fill("27901");

  await expect(page.getByRole("alert")).toHaveText("该服务器的远端端口已被 Home Lab 使用。");
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "启动该配置" }).first()).toBeDisabled();

  await page.getByLabel("远端端口").fill("27902");
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();
});

test("scans and trusts host keys from the editor", async ({ page }) => {
  await profileName(page, "Office Proxy").click();
  await expect(page.getByText("尚未信任该服务器 Host Key。")).toBeVisible();

  await page.getByRole("button", { name: "扫描指纹" }).click();
  await expect(page.getByText(/SHA256:testFingerprint/)).toBeVisible();

  await page.getByRole("button", { name: "信任扫描结果" }).click();
  await expect(page.getByText("已信任 1 条当前服务器 Host Key。")).toBeVisible();
});

test("confirms host key replacement before trusting scanned keys", async ({ page }) => {
  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__!.hostKeyTrustAction = "replace";
  });
  await profileName(page, "Office Proxy").click();

  await page.getByRole("button", { name: "扫描指纹" }).click();
  await expect(page.getByText(/SHA256:testFingerprint/)).toBeVisible();

  await page.getByRole("button", { name: "替换 Host Key" }).click();
  const dialog = page.getByRole("dialog", { name: /替换 office\.example\.com:22/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__SSHNET_TEST_CONTROLS__?.trustHostKeyRequests?.length ?? 0),
    )
    .toBe(0);

  await page.getByRole("button", { name: "替换 Host Key" }).click();
  await dialog.getByRole("button", { name: "替换 Host Key" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__SSHNET_TEST_CONTROLS__?.trustHostKeyRequests?.at(-1)?.allowReplace,
      ),
    )
    .toBe(true);
});

test("renders selected profile checks with a checked state", async ({ page }) => {
  const homeSelection = page.getByRole("button", { name: "选择 Home Lab" });
  await expect(homeSelection).not.toHaveClass(/checked/);

  await homeSelection.click();
  await expect(homeSelection).toHaveClass(/checked/);
  await expect(page.getByText("已选择：1 个")).toBeVisible();
});

test("deletes only checked profiles", async ({ page }) => {
  await page.getByRole("button", { name: "选择 Home Lab" }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除 1 个配置？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();

  await expect(profileName(page, "Office Proxy")).toBeVisible();
  await expect(profileName(page, "Home Lab")).toBeVisible();

  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "删除配置" }).click();

  await expect(profileName(page, "Office Proxy")).toBeVisible();
  await expect(profileName(page, "Home Lab")).toBeHidden();
  await expect(page.getByText("共 1 项配置")).toBeVisible();
  await expect(page.getByText("已选择：0 个")).toBeVisible();
});

test("does not recreate a default profile after deleting every profile", async ({ page }) => {
  await page.locator(".table-body .check-cell").nth(0).click();
  await page.locator(".table-body .check-cell").nth(1).click();
  await page.locator(".primary-actions button").nth(5).click();
  await page.locator(".confirm-dialog .danger-button").click();

  await expect(profileName(page, "Office Proxy")).toBeHidden();
  await expect(profileName(page, "Home Lab")).toBeHidden();
  await expect(page.locator(".table-body .table-row")).toHaveCount(0);
  await expect(page.locator(".profiles-empty .empty-state-action")).toBeVisible();

  const savedProfiles = await page.evaluate(
    () => window.__SSHNET_TEST_CONTROLS__?.lastSavedProfiles ?? null,
  );
  expect(savedProfiles).toEqual([]);
});

test("keeps toolbar actions scoped to checked profiles", async ({ page }) => {
  const start = page.getByRole("button", { name: "启动", exact: true });
  const stop = page.getByRole("button", { name: "停止", exact: true });
  const edit = page.getByRole("button", { name: "编辑", exact: true });
  const copy = page.getByRole("button", { name: "复制", exact: true });
  const deleteButton = page.getByRole("button", { name: "删除", exact: true });

  await expect(start).toBeDisabled();
  await expect(stop).toBeDisabled();
  await expect(edit).toBeDisabled();
  await expect(copy).toBeDisabled();
  await expect(deleteButton).toBeDisabled();

  await page.getByRole("button", { name: "选择 Office Proxy" }).click();
  await expect(start).toBeEnabled();
  await expect(stop).toBeEnabled();
  await expect(edit).toBeEnabled();
  await expect(copy).toBeEnabled();
  await expect(deleteButton).toBeEnabled();

  await page.getByRole("button", { name: "选择 Home Lab" }).click();
  await expect(start).toBeEnabled();
  await expect(stop).toBeEnabled();
  await expect(edit).toBeDisabled();
  await expect(copy).toBeDisabled();
  await expect(deleteButton).toBeEnabled();

  await start.click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toHaveCount(2);
});

test("changes the row action from start to stop while a profile is running", async ({ page }) => {
  await page.getByRole("button", { name: "启动该配置" }).first().click();

  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();
  const officeRow = page.locator(".table-row", {
    has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
  });
  await expect(officeRow.locator(".status-cell strong")).toHaveText("运行中");

  await page.getByRole("button", { name: "活动连接" }).click();
  const topology = page.locator(".connection-topology");
  await expect(topology).toContainText("本地代理");
  await expect(topology).toContainText("活动隧道");
  await expect(topology).toContainText("SSH 服务器");
  await expect(topology).toContainText("1 个");
  await expect(topology).toContainText("1 台");
  await expect(page.locator(".table-head")).toContainText("连接时长");
  await expect(page.locator(".config-table .check-cell")).toHaveCount(0);
  await expect(page.locator(".table-footer")).not.toContainText("已选择");
  await expect(page.getByRole("button", { name: "选择 Office Proxy" })).toHaveCount(0);
  await expect(officeRow.locator(".connection-duration")).toContainText(/00:01:\d{2}/);

  await page.getByRole("button", { name: "配置列表" }).click();
  await page.getByRole("button", { name: "停止该配置" }).click();
  await expect(page.getByRole("button", { name: "启动该配置" }).first()).toBeVisible();
});

test("opens connection details panel instead of editor when clicking a running tunnel", async ({ page }) => {
  await page.getByRole("button", { name: "启动该配置" }).first().click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await page.getByRole("button", { name: "活动连接" }).click();

  const officeRow = page.locator(".table-row", {
    has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
  });
  await officeRow.click();

  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeHidden();

  const detailsPanel = page.locator(".connection-details-panel");
  await expect(detailsPanel).toBeVisible();
  await expect(detailsPanel.getByRole("heading", { name: "Office Proxy" })).toBeVisible();
  await expect(detailsPanel).toContainText("本地代理");
  await expect(detailsPanel).toContainText("SSH 服务器");
  await expect(detailsPanel).toContainText("远端端点");
  await expect(detailsPanel).toContainText("连接时长");
  await expect(detailsPanel).toContainText("进程 ID");
  await expect(detailsPanel.locator(".connection-duration-value")).toContainText(/00:01:\d{2}/);
  await expect(detailsPanel.getByRole("button", { name: "停止连接" })).toBeVisible();
  await expect(detailsPanel.getByRole("button", { name: "复制 SSH 命令" })).toBeVisible();
  await expect(detailsPanel.getByRole("button", { name: "复制服务器代理命令" })).toBeVisible();
  await expect(detailsPanel.getByRole("button", { name: "前往编辑配置" })).toBeVisible();
  await expect(officeRow).toHaveClass(/focused/);
});

test("stops the running tunnel from the connection details panel", async ({ page }) => {
  await page.getByRole("button", { name: "启动该配置" }).first().click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await page.getByRole("button", { name: "活动连接" }).click();
  await page
    .locator(".table-row", {
      has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
    })
    .click();

  const detailsPanel = page.locator(".connection-details-panel");
  await detailsPanel.getByRole("button", { name: "停止连接" }).click();

  await expect(detailsPanel.getByText("连接已停止")).toBeVisible();
  await expect(detailsPanel.getByRole("button", { name: "前往编辑配置" })).toBeVisible();
});

test("opens the profile editor from the connection details panel", async ({ page }) => {
  await page.getByRole("button", { name: "启动该配置" }).first().click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await page.getByRole("button", { name: "活动连接" }).click();
  await page
    .locator(".table-row", {
      has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
    })
    .click();

  await page
    .locator(".connection-details-panel")
    .getByRole("button", { name: "前往编辑配置" })
    .click();

  await expect(page.locator(".top-tabs button", { hasText: "配置列表" })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
  await expect(page.locator(".editor-header h2")).toHaveText("编辑配置");
});

test("preserves an unsaved profile draft after visiting the connection details panel", async ({
  page,
}) => {
  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
  await page.getByLabel("配置名称").fill("Office Proxy Dirty");
  await expect(page.locator(".editor-header span")).toHaveText("有未保存修改");

  await page.getByRole("button", { name: "活动连接" }).click();
  await expect(page.locator(".connection-details-panel")).toHaveCount(0);

  await page.locator(".top-tabs").getByRole("button", { name: "配置列表" }).click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
  await expect(page.getByLabel("配置名称")).toHaveValue("Office Proxy Dirty");
  await expect(page.locator(".editor-header span")).toHaveText("有未保存修改");
});

test("preserves a dirty draft when jumping from connection details back to the editor", async ({
  page,
}) => {
  await page.getByRole("button", { name: "启动该配置" }).first().click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
  await page.getByLabel("配置名称").fill("Office Proxy Dirty");
  await expect(page.locator(".editor-header span")).toHaveText("有未保存修改");

  await page.getByRole("button", { name: "活动连接" }).click();
  await page
    .locator(".table-row", {
      has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
    })
    .click();

  const detailsPanel = page.locator(".connection-details-panel");
  await expect(detailsPanel).toBeVisible();
  await detailsPanel.getByRole("button", { name: "前往编辑配置" }).click();

  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
  await expect(page.getByLabel("配置名称")).toHaveValue("Office Proxy Dirty");
  await expect(page.locator(".editor-header span")).toHaveText("有未保存修改");
});

test("opens the log page with the matching profile filter from connection details", async ({
  page,
}) => {
  await page.getByRole("button", { name: "启动该配置" }).first().click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await page.getByRole("button", { name: "活动连接" }).click();
  await page
    .locator(".table-row", {
      has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
    })
    .click();

  await page
    .locator(".connection-details-panel")
    .getByRole("button", { name: "查看该配置日志" })
    .click();

  await expect(page.locator(".top-tabs button", { hasText: "日志" })).toHaveClass(/active/);
  await expect(page.locator(".log-page").getByLabel("配置过滤")).toHaveValue("profile-office");
});

test("keeps a dirty draft after jumping to logs from the connection details panel", async ({
  page,
}) => {
  await page.getByRole("button", { name: "启动该配置" }).first().click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
  await page.getByLabel("配置名称").fill("Office Proxy Dirty");
  await expect(page.locator(".editor-header span")).toHaveText("有未保存修改");

  await page.getByRole("button", { name: "活动连接" }).click();
  await page
    .locator(".table-row", {
      has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
    })
    .click();
  await page
    .locator(".connection-details-panel")
    .getByRole("button", { name: "查看该配置日志" })
    .click();

  await expect(page.locator(".top-tabs button", { hasText: "日志" })).toHaveClass(/active/);
  await expect(page.locator(".editor-panel")).toHaveCount(0);

  await page.locator(".top-tabs").getByRole("button", { name: "配置列表" }).click();
  await profileName(page, "Office Proxy").click();
  await expect(page.getByRole("heading", { name: "编辑配置" })).toBeVisible();
  await expect(page.getByLabel("配置名称")).toHaveValue("Office Proxy Dirty");
  await expect(page.locator(".editor-header span")).toHaveText("有未保存修改");
});

test("hides the right panel on the connections page until a tunnel is selected", async ({
  page,
}) => {
  await page.getByRole("button", { name: "活动连接" }).click();
  await expect(page.locator(".connection-details-panel")).toHaveCount(0);
  await expect(page.locator(".editor-panel")).toHaveCount(0);

  await page.locator(".top-tabs").getByRole("button", { name: "配置列表" }).click();
  await page.getByRole("button", { name: "启动该配置" }).first().click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await page.getByRole("button", { name: "活动连接" }).click();
  await expect(page.locator(".connection-details-panel")).toHaveCount(0);
});

test("shows connecting and stopping lifecycle states", async ({ page }) => {
  await page.getByRole("button", { name: "选择 Office Proxy" }).click();

  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__!.holdStart = true;
  });
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByText("连接中")).toBeVisible();
  await expect(page.getByText("正在建立 SSH 连接。")).toBeVisible();
  await page.evaluate(() => window.__SSHNET_TEST_CONTROLS__!.releaseStart?.());
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__!.holdStop = true;
  });
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByText("停止中")).toBeVisible();
  await expect(page.getByText("正在停止 SSH 反向隧道。")).toBeVisible();
  await page.evaluate(() => window.__SSHNET_TEST_CONTROLS__!.releaseStop?.());
  await expect(page.getByRole("button", { name: "启动该配置" }).first()).toBeVisible();
});

test("lets terminal poll status replace a transient hold", async ({ page }) => {
  const officeRow = page.locator(".table-row", {
    has: page.locator(".name-cell strong", { hasText: "Office Proxy" }),
  });

  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__!.holdStart = true;
  });
  await officeRow.locator(".row-play").click();
  await expect(officeRow.locator(".status-cell")).toHaveClass(/connecting/);

  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__!.setTunnelStatus?.("profile-office", {
      status: "running",
      detail: "poll tunnel running",
      pid: 4242,
      lastConnectedAt: Date.now(),
    });
  });

  await expect(officeRow.locator(".status-cell")).toHaveClass(/running/, { timeout: 5_000 });
  await page.evaluate(() => window.__SSHNET_TEST_CONTROLS__!.releaseStart?.());
});

test("prompts for a one-time password when password auth starts", async ({ page }) => {
  await profileName(page, "Office Proxy").click();
  await page.getByRole("button", { name: "高级选项" }).click();
  await page.getByLabel("SSH 认证方式").selectOption("password");

  await page.getByRole("button", { name: "启动该配置" }).first().click();
  const passwordDialog = page.getByRole("dialog", { name: "输入 SSH 密码" });
  await expect(passwordDialog).toBeVisible();
  const passwordInput = passwordDialog.getByLabel("SSH 密码");
  await expect(passwordInput).toBeVisible();

  await passwordInput.fill("correct horse battery staple");
  await page.evaluate(() => {
    window.__SSHNET_TEST_CONTROLS__!.holdStart = true;
  });
  await page.getByRole("button", { name: "启动隧道" }).click();
  await expect(page.getByText("认证中")).toBeVisible();
  await page.evaluate(() => window.__SSHNET_TEST_CONTROLS__!.releaseStart?.());

  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();
});

test("can save a password and reuse it on the next start", async ({ page }) => {
  await profileName(page, "Office Proxy").click();
  await page.getByRole("button", { name: "高级选项" }).click();
  await page.getByLabel("SSH 认证方式").selectOption("password");
  await page.getByRole("switch", { name: /保存 SSH 密码/ }).click();

  await page.getByRole("button", { name: "启动该配置" }).first().click();
  const passwordDialog = page.getByRole("dialog", { name: "输入 SSH 密码" });
  await expect(passwordDialog).toBeVisible();
  await passwordDialog.getByLabel("SSH 密码").fill("stored-password");
  await page.getByRole("button", { name: "启动隧道" }).click();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();

  await page.getByRole("button", { name: "停止该配置" }).click();
  await expect(page.getByRole("button", { name: "启动该配置" }).first()).toBeVisible();

  await page.getByRole("button", { name: "启动该配置" }).first().click();
  await expect(passwordDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "停止该配置" })).toBeVisible();
});
