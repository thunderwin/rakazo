import { spawn } from "node:child_process";

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not launch application (exit ${code ?? 1})`));
    });
  });
}

export async function launchLocalApplication(
  application: string,
  uri?: string,
  platform = process.platform,
): Promise<void> {
  if (platform === "darwin") {
    await run("/usr/bin/open", ["-a", application, ...(uri ? [uri] : [])]);
    return;
  }
  if (platform === "win32") {
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "if ($env:ERICBOT_LAUNCH_URI) { Start-Process -FilePath $env:ERICBOT_LAUNCH_APP -ArgumentList $env:ERICBOT_LAUNCH_URI } else { Start-Process -FilePath $env:ERICBOT_LAUNCH_APP }",
      ],
      {
        ERICBOT_LAUNCH_APP: application,
        ...(uri ? { ERICBOT_LAUNCH_URI: uri } : { ERICBOT_LAUNCH_URI: "" }),
      },
    );
    return;
  }
  if (platform === "linux") {
    if (uri) throw new Error("Opening a URI by application name is unsupported on Linux");
    await run("gtk-launch", [application]);
    return;
  }
  throw new Error("Launching graphical applications is unsupported on this platform");
}
