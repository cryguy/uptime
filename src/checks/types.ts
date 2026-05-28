export type MonitorType = "http" | "tcp" | "ssh";

export type HttpConfig = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  auth?:
    | { type: "basic"; username: string; password: string }
    | { type: "bearer"; token: string };
  followRedirects?: boolean;
  expectedStatus?: number | number[];
  expectedBodyContains?: string;
  ignoreTlsErrors?: boolean;
};

export type TcpConfig = {
  host: string;
  port: number;
};

export type SshConfig = {
  host: string;
  port?: number;
  username: string;
  privateKey: string;
  passphrase?: string;
  command?: string;
  expectExitCode?: number;
};

export type MonitorConfig =
  | { type: "http"; config: HttpConfig }
  | { type: "tcp"; config: TcpConfig }
  | { type: "ssh"; config: SshConfig };

export type CheckOutcome = {
  ok: boolean;
  latencyMs: number;
  detail: string;
};
