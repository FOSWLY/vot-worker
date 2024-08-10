export type FileProxyOpts = {
  params: { "*": string };
  query: Record<string, string | undefined>;
  request: Request;
};
