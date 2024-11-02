declare module "bun" {
  interface Env {
    SERVICE_PORT: number;
    LOKI_HOST: string;
    LOKI_USER: string;
    LOKI_PASSWORD: string;
    LOKI_LABEL: string;
    FORCE_USE_PROXY: "true" | "false";
  }
}
