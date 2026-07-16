import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ClassifierAutoAskDecider } from "./auto-mode-classifier";
import type { PermissionSystemExtensionConfig } from "./extension-config";
import type { AutoAskDecider } from "./handlers/gates/auto-ask-decider";

interface AutoModeConfigStore {
  current(): Pick<PermissionSystemExtensionConfig, "autoMode">;
}

interface RuntimeContextStore {
  getRuntimeContext(): ExtensionContext | null;
}

type AutoModePost = (url: string, init: RequestInit) => Promise<Response>;

export function createAutoAskDecider(
  configStore: AutoModeConfigStore,
  session: RuntimeContextStore,
  post?: AutoModePost,
): AutoAskDecider {
  return new ClassifierAutoAskDecider(
    () => configStore.current().autoMode,
    () => session.getRuntimeContext(),
    post,
  );
}
