import type { Profile } from "../types/domain";

export function buildServerCommand(profile: Profile) {
  const proxyUrl =
    profile.localProxyProtocol === "http"
      ? `http://${profile.remoteBindHost}:${profile.remoteProxyPort}`
      : `socks5h://${profile.remoteBindHost}:${profile.remoteProxyPort}`;
  const noProxy = profile.noProxy.join(",");

  if (profile.localProxyProtocol === "http") {
    return [
      `export HTTP_PROXY=${proxyUrl}`,
      "export HTTPS_PROXY=$HTTP_PROXY",
      "export http_proxy=$HTTP_PROXY",
      "export https_proxy=$HTTPS_PROXY",
      `export NO_PROXY=${noProxy}`,
      "export no_proxy=$NO_PROXY",
    ].join("\n");
  }

  return [
    `export ALL_PROXY=${proxyUrl}`,
    "export all_proxy=$ALL_PROXY",
    `export NO_PROXY=${noProxy}`,
    "export no_proxy=$NO_PROXY",
  ].join("\n");
}

export function buildSshPreview(profile: Profile) {
  const privateKeyArg =
    profile.authMethod === "key" && profile.privateKeyPath.trim()
      ? [`  -i ${profile.privateKeyPath.trim()}`]
      : [];

  return [
    "ssh -N -T",
    "  -o ExitOnForwardFailure=yes",
    "  -o ServerAliveInterval=30",
    "  -o ServerAliveCountMax=3",
    profile.authMethod === "password" ? "  -o BatchMode=no" : "  -o BatchMode=yes",
    "  -o StrictHostKeyChecking=yes",
    "  -o UserKnownHostsFile=<app known_hosts>",
    `  -o ConnectTimeout=${profile.connectTimeoutSeconds}`,
    ...(profile.authMethod === "password"
      ? [
          "  -o PreferredAuthentications=password,keyboard-interactive",
          "  -o PubkeyAuthentication=no",
          "  -o NumberOfPasswordPrompts=1",
          profile.rememberSshPassword
            ? "  # SSH_ASKPASS=<app helper>; password can be loaded from Windows Credential Manager"
            : "  # SSH_ASKPASS=<app helper>; password is requested at start and not saved",
        ]
      : []),
    `  -R ${profile.remoteBindHost}:${profile.remoteProxyPort}:${profile.localProxyHost}:${profile.localProxyPort}`,
    `  -p ${profile.sshPort}`,
    ...privateKeyArg,
    `  ${profile.sshUser}@${profile.sshHost}`,
  ].join("\n");
}

