declare module "bun" {
  interface Env {
    SERVICE_PORT: number;
    LOKI_HOST: string;
    LOKI_USER: string;
    LOKI_PASSWORD: string;
    LOKI_LABEL: string;
    PROXY_FORCE: "true" | "false";
    PROXY_IGNORE_S3: "true" | "false";
  }
}
