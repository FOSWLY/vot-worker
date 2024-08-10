export type FileProxyOpts = {
  params: { fileName: string };
  query: Record<string, string | undefined>;
  request: Request;
};
