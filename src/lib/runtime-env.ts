type RuntimeEnvName =
  | "VITE_ADMIN_USERNAME"
  | "VITE_ADMIN_PASSWORD"
  | "VITE_TOKENU_API_BASE_URL"
  | "VITE_TOKENU_OAUTH_API_BASE_URL";

type RuntimeEnvMap = Partial<Record<RuntimeEnvName, string>>;

declare global {
  interface Window {
    __TOKENU_RUNTIME_ENV__?: RuntimeEnvMap;
  }
}

function getRuntimeEnv() {
  if (typeof window === "undefined") {
    return {} as RuntimeEnvMap;
  }

  return window.__TOKENU_RUNTIME_ENV__ ?? {};
}

export function readRuntimeEnv(name: RuntimeEnvName) {
  const runtimeValue = getRuntimeEnv()[name];
  if (typeof runtimeValue === "string" && runtimeValue.length > 0) {
    return runtimeValue;
  }

  const buildValue = import.meta.env[name];
  return typeof buildValue === "string" && buildValue.length > 0 ? buildValue : undefined;
}
