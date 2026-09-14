const ASSETS_DIR = `${import.meta.dir}/../assets`;

// Fixed UUID used in emitted translation/HLS URLs. The route accepts any
// valid `<uuid>.mp3` filename, not just this one.
const AUDIO_ID = crypto.randomUUID();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$/i;

export function audioUrl(origin: string): string {
  return `${origin}/tts/prod/${AUDIO_ID}.mp3`;
}

export function streamUrl(origin: string): string {
  return `${origin}/stream-translation/stream-proxy/mock.m3u8`;
}

export function playlist(origin: string): string {
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.0,\n${audioUrl(origin)}\n#EXT-X-ENDLIST\n`;
}

export function isAudioFile(file: string): boolean {
  return AUDIO_FILE_RE.test(file);
}

export function isUuid(uuid: string): boolean {
  return UUID_RE.test(uuid);
}

export async function serveAsset(
  request: Request,
  file: string,
  contentType: string,
): Promise<Response> {
  const data = new Uint8Array(await Bun.file(`${ASSETS_DIR}/${file}`).arrayBuffer());
  const size = data.length;
  const baseHeaders = {
    "accept-ranges": "bytes",
    "content-type": contentType,
  };
  // HEAD keeps the explicit `content-length`/`content-range` headers but a
  // null body, mirroring what Elysia would strip for us on a GET route.
  const isHead = request.method === "HEAD";
  const range = request.headers.get("range");
  if (range) {
    const slice = parseRange(range, size);
    if (!slice) {
      return new Response(isHead ? null : "Range Not Satisfiable", {
        status: 416,
        headers: { ...baseHeaders, "content-range": `bytes */${size}` },
      });
    }
    return new Response(isHead ? null : data.slice(slice.start, slice.end + 1), {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-range": `bytes ${slice.start}-${slice.end}/${size}`,
        "content-length": String(slice.end - slice.start + 1),
      },
    });
  }
  return new Response(isHead ? null : data, {
    headers: { ...baseHeaders, "content-length": String(size) },
  });
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  let start: number;
  let end: number;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (end >= size) end = size - 1;
  }
  if (start < 0 || start >= size || end < start) return null;
  return { start, end };
}
