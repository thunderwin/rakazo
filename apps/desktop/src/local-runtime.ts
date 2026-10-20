import path from "node:path";
import { LocalRuntimeService, type ModelGateway } from "@rakazo/local-runtime";

export interface DesktopLocalRuntimeOptions {
  userDataDir: string;
  gateway: ModelGateway;
}

/** The desktop process owns one SQLite database under its userData directory. */
export function createDesktopLocalRuntime(
  options: DesktopLocalRuntimeOptions,
): LocalRuntimeService {
  return new LocalRuntimeService({
    databasePath: path.join(options.userDataDir, "local", "rakazo.sqlite"),
    gateway: options.gateway,
  });
}
