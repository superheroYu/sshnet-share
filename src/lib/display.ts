import type { KnownHostKeyInfo, KnownHostsStatus, Profile, TunnelStatus } from "../types/domain";
import type { LocaleText } from "../i18n/localeText";
import type { LanguageSetting } from "../types/domain";
import { localeText } from "../i18n/localeText";

export function tunnelStatusLabel(status: TunnelStatus["status"] | undefined, text: LocaleText) {
  switch (status) {
    case "connecting":
      return text.status.connecting;
    case "authenticating":
      return text.status.authenticating;
    case "running":
      return text.status.running;
    case "stopping":
      return text.status.stopping;
    case "reconnecting":
      return text.status.reconnecting;
    case "failed":
      return text.status.failed;
    default:
      return text.status.stopped;
  }
}

export function knownHostsStatusLabel(status: KnownHostsStatus["status"] | undefined, text: LocaleText) {
  switch (status) {
    case "trusted":
      return text.status.trusted;
    case "error":
      return text.status.knownHostError;
    default:
      return text.status.untrusted;
  }
}

export function displayProfileName(name: string, text: LocaleText) {
  if (
    name === localeText["zh-CN"].profile.defaultName ||
    name === localeText["en-US"].profile.defaultName
  ) {
    return text.profile.defaultName;
  }

  if (
    name === localeText["zh-CN"].profile.newBase ||
    name === localeText["en-US"].profile.newBase
  ) {
    return text.profile.newBase;
  }

  const zhNewName = /^新建配置\s+(\d+)$/.exec(name);
  if (zhNewName) {
    return text.profile.newName(Number(zhNewName[1]));
  }

  const enNewName = /^New Profile\s+(\d+)$/.exec(name);
  if (enNewName) {
    return text.profile.newName(Number(enNewName[1]));
  }

  return name;
}

export function displayTunnelDetail(status: TunnelStatus | undefined, text: LocaleText) {
  if (!status) {
    return text.table.waiting;
  }
  if (status.status === "connecting") {
    return text.table.tunnelConnectingDetail;
  }
  if (status.status === "authenticating") {
    return text.table.tunnelAuthenticatingDetail;
  }
  if (status.status === "stopping") {
    return text.table.tunnelStoppingDetail;
  }
  if (status.status === "reconnecting") {
    return text.table.tunnelReconnectingDetail;
  }
  if (status.pid) {
    return `pid ${status.pid}`;
  }

  switch (status.detail) {
    case "隧道未启动。":
      return text.table.tunnelStoppedDetail;
    case "SSH 反向隧道正在运行。":
      return text.table.tunnelRunningDetail;
    case "SSH 反向隧道已停止。":
      return text.table.tunnelStoppedResult;
    default:
      return displayBackendDetail(status.detail, text);
  }
}

export function formatLastConnection(
  timestampMs: number | null | undefined,
  language: LanguageSetting,
) {
  if (!timestampMs) {
    return "-";
  }

  return new Date(timestampMs).toLocaleString(language, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatConnectionDuration(
  startedAtMs: number | null | undefined,
  nowMs: number,
) {
  if (!startedAtMs) {
    return "-";
  }

  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function displayKnownHostsDetail(status: KnownHostsStatus | null, text: LocaleText) {
  if (!status) {
    return text.editor.hostKeyUnread;
  }

  switch (status.detail) {
    case "尚未信任该服务器 Host Key。":
      return text.editor.hostKeyUntrustedDetail;
    case "known_hosts 存在，但未找到当前服务器记录。":
      return text.editor.hostKeyMissingDetail;
    default: {
      const trustedCount = /^已信任 (\d+) 条当前服务器 Host Key。$/.exec(status.detail);
      if (trustedCount) {
        return text.editor.trustedHostKeyCount(Number(trustedCount[1]));
      }
      return status.detail;
    }
  }
}

export function formatHostKeyFingerprint(item: KnownHostKeyInfo) {
  return `${item.algorithm} ${item.fingerprint}`;
}

export function displayBackendDetail(detail: string, text: LocaleText) {
  if (text !== localeText["en-US"]) {
    return detail;
  }

  let match = /^(.+) 正在启动$/.exec(detail);
  if (match) {
    return text.messages.startingProfile(displayProfileName(match[1], text));
  }

  match = /^(.+) 配置已保存$/.exec(detail);
  if (match) {
    return text.messages.profileSaved(displayProfileName(match[1], text));
  }

  match = /^已删除 (\d+) 个配置$/.exec(detail);
  if (match) {
    return text.messages.deletedProfiles(Number(match[1]));
  }

  match = /^(.+) Host Key 已写入应用 known_hosts$/.exec(detail);
  if (match) {
    return text.messages.trustedHostKey(displayProfileName(match[1], text));
  }

  match = /^(.+) 已取消密码认证启动$/.exec(detail);
  if (match) {
    return text.messages.passwordCancelled(displayProfileName(match[1], text));
  }

  match = /^(.+) 未找到已保存密码，需要输入一次 SSH 密码$/.exec(detail);
  if (match) {
    return text.messages.savedPasswordMissing(displayProfileName(match[1], text));
  }

  match = /^(.+) 已清除已保存 SSH 密码$/.exec(detail);
  if (match) {
    return text.messages.forgotSavedPassword(displayProfileName(match[1], text));
  }

  match = /^(.+) 服务器端代理命令已复制$/.exec(detail);
  if (match) {
    return text.messages.copiedServerCommand(displayProfileName(match[1], text));
  }

  match = /^(.+) SSH 隧道命令已复制$/.exec(detail);
  if (match) {
    return text.messages.copiedSshCommand(displayProfileName(match[1], text));
  }

  const sshFailureTranslations = [
    [
      "SSH Host Key 校验失败：请重新扫描并确认服务器指纹。",
      "SSH host key verification failed. Rescan and confirm the server fingerprint.",
    ],
    [
      "SSH 认证失败：请检查用户名、密码/密钥，或服务器是否允许当前认证方式。",
      "SSH authentication failed. Check the username, password/key, or whether the server allows this auth method.",
    ],
    [
      "SSH 连接超时：请检查服务器地址、端口、防火墙或网络连通性。",
      "SSH connection timed out. Check the server address, port, firewall, or network reachability.",
    ],
    [
      "SSH 连接被拒绝：请确认服务器 SSH 端口正在监听且防火墙允许连接。",
      "SSH connection was refused. Confirm the SSH port is listening and allowed by the firewall.",
    ],
    [
      "SSH 主机名解析失败：请检查服务器 Host 是否正确。",
      "SSH hostname lookup failed. Check the server host value.",
    ],
    [
      "SSH 网络不可达：请检查本机网络或服务器路由。",
      "SSH network is unreachable. Check local networking or server routing.",
    ],
    [
      "SSH 反向隧道被服务器拒绝：服务器的 sshd 配置可能禁用了 TCP 转发（AllowTcpForwarding/GatewayPorts），请联系服务器管理员。",
      "SSH reverse tunnel was refused by the server: sshd may have TCP forwarding disabled (AllowTcpForwarding/GatewayPorts). Contact the server administrator.",
    ],
    [
      "SSH 反向隧道建立失败：远端端口可能已被占用，请换一个端口或先在服务器上释放该端口。",
      "SSH reverse tunnel failed: the remote port may already be in use. Try another port or free the port on the server first.",
    ],
    [
      "SSH 密码输入失败：askpass helper 未能向 ssh.exe 提供本次连接密码。",
      "SSH password input failed. The askpass helper could not provide this connection password to ssh.exe.",
    ],
  ] as const;

  for (const [source, replacement] of sshFailureTranslations) {
    if (detail.startsWith(source)) {
      return detail
        .replace(source, replacement)
        .replace(" 原始错误：", " Original error: ");
    }
  }

  match = /^(.+) 正在启动 ssh\.exe 反向隧道$/.exec(detail);
  if (match) {
    return `Starting ${displayProfileName(match[1], text)} ssh.exe reverse tunnel`;
  }

  match = /^(.+) 已在运行。$/.exec(detail);
  if (match) {
    return `${displayProfileName(match[1], text)} is already running.`;
  }

  match = /^(.+) SSH 反向隧道已启动。$/.exec(detail);
  if (match) {
    return `${displayProfileName(match[1], text)} SSH reverse tunnel started.`;
  }

  match = /^(.+) SSH 反向隧道已启动，pid=(\d+)$/.exec(detail);
  if (match) {
    return `${displayProfileName(match[1], text)} SSH reverse tunnel started, pid=${match[2]}`;
  }

  match = /^(.+) 已自动采用本地代理 127\.0\.0\.1:(\d+) \((Http|Socks5)\)$/.exec(detail);
  if (match) {
    return `${displayProfileName(match[1], text)} automatically adopted local proxy 127.0.0.1:${match[2]} (${match[3].toUpperCase()})`;
  }

  match = /^扫描到 (\d+) 条 host key。$/.exec(detail);
  if (match) {
    const count = Number(match[1]);
    return `Scanned ${count} host key${count === 1 ? "" : "s"}.`;
  }

  match = /^SSH 反向隧道已停止，pid=(\d+)$/.exec(detail);
  if (match) {
    return `SSH reverse tunnel stopped, pid=${match[1]}`;
  }

  if (detail.startsWith("ssh.exe 已退出：")) {
    return detail.replace("ssh.exe 已退出：", "ssh.exe exited: ").split("；").join("; ");
  }

  switch (detail) {
    case "隧道未启动。":
      return text.table.tunnelStoppedDetail;
    case "SSH 反向隧道正在运行。":
      return text.table.tunnelRunningDetail;
    case "SSH 反向隧道已停止。":
      return text.table.tunnelStoppedResult;
    case "没有正在运行的隧道。":
      return "No tunnel is running.";
    case "隧道已经在运行。":
      return "Tunnel is already running.";
    case "尚未信任 SSH Host Key，请先扫描并确认服务器指纹。":
      return "SSH host key is not trusted yet. Scan and confirm the server fingerprint first.";
    default:
      return detail;
  }
}

export function displayError(error: unknown, text: LocaleText) {
  return displayBackendDetail(String(error), text);
}

export function logMessageMentionsProfile(
  originalMessage: string,
  renderedMessage: string,
  profile: Profile,
  text: LocaleText,
) {
  const displayName = displayProfileName(profile.name, text);
  return (
    originalMessage.includes(profile.name) ||
    originalMessage.includes(displayName) ||
    renderedMessage.includes(profile.name) ||
    renderedMessage.includes(displayName)
  );
}

