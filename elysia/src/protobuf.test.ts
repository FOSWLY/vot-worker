import { describe, expect, test } from "bun:test";
import { BadRequestError, ValidationRequestError } from "@/errors";
import {
  decodeVotHeaders,
  mediaType,
  resolveByteRouteBody,
  resolveFailAudioJsBody,
} from "@/protobuf";

function encode(headers: Record<string, string>, pad: "pad" | "nopad" = "nopad"): string {
  const b64 = Buffer.from(JSON.stringify(headers), "utf8").toString("base64");
  return pad === "pad" ? b64 : b64.replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64").replace(/=+$/, "");
}

function byteRequest(
  contentType: string | null,
  body: BodyInit | null,
  votHeaders?: string,
): Request {
  const headers: Record<string, string> = {};
  if (contentType !== null) headers["content-type"] = contentType;
  if (votHeaders !== undefined) headers["x-vot-headers"] = votHeaders;
  return new Request("http://localhost/video-translation/translate", {
    method: "POST",
    headers,
    body,
  });
}

describe("mediaType", () => {
  test("parses case-insensitively and ignores parameters", () => {
    expect(mediaType("application/x-protobuf")).toBe("application/x-protobuf");
    expect(mediaType("Application/X-Protobuf; charset=utf-8")).toBe("application/x-protobuf");
    expect(mediaType("  APPLICATION/JSON ;charset=binary  ")).toBe("application/json");
    expect(mediaType(null)).toBe("");
    expect(mediaType(undefined)).toBe("");
  });
});

describe("decodeVotHeaders", () => {
  const headers = { "content-type": "application/x-protobuf", "Vtrans-Signature": "abc" };

  test("accepts padded and unpadded Base64", () => {
    expect(decodeVotHeaders(encode(headers, "pad"))).toEqual(headers);
    expect(decodeVotHeaders(encode(headers, "nopad"))).toEqual(headers);
  });

  test("rejects missing, empty, and malformed values", () => {
    expect(decodeVotHeaders(null)).toBeNull();
    expect(decodeVotHeaders(undefined)).toBeNull();
    expect(decodeVotHeaders("")).toBeNull();
    expect(decodeVotHeaders("!!!not-base64!!!")).toBeNull();
  });

  test("accepts the standard base64 alphabet and rejects the url-safe one", () => {
    // `~~~` encodes with a `+` in standard base64.
    const standard = Buffer.from(JSON.stringify({ a: "~~~" }), "utf8").toString("base64");
    expect(standard).toContain("+");
    expect(decodeVotHeaders(standard)).toEqual({ a: "~~~" });
    expect(decodeVotHeaders(standard.replace(/\+/g, "-"))).toBeNull();
    expect(decodeVotHeaders("YWJj-_==")).toBeNull();
  });

  test("decodes non-ASCII bytes with atob Latin-1 semantics, not UTF-8", () => {
    // `{"a":"é"}` as UTF-8; `atob` maps each byte to one code unit (Ã©).
    const encoded = Buffer.from(JSON.stringify({ a: "é" }), "utf8").toString("base64");
    expect(decodeVotHeaders(encoded)).toEqual({ a: "\u00c3\u00a9" });
  });

  test("rejects non-object JSON and non-string values", () => {
    expect(decodeVotHeaders(encodeJson([1, 2]))).toBeNull();
    expect(decodeVotHeaders(encodeJson(null))).toBeNull();
    expect(decodeVotHeaders(encodeJson("str"))).toBeNull();
    expect(decodeVotHeaders(encodeJson({ a: 1 }))).toBeNull();
    expect(decodeVotHeaders(encodeJson({ a: null }))).toBeNull();
    expect(decodeVotHeaders(encodeJson({}))).toEqual({});
  });

  test("drops transport headers case-insensitively, keeps the rest", () => {
    expect(
      decodeVotHeaders(
        encode({
          Host: "x",
          "Content-Length": "3",
          Connection: "keep-alive",
          "Transfer-Encoding": "chunked",
          "X-VOT-Headers": "y",
          "Vtrans-Signature": "sig",
          "content-type": "application/x-protobuf",
        }),
      ),
    ).toEqual({
      "Vtrans-Signature": "sig",
      "content-type": "application/x-protobuf",
    });
  });
});

describe("resolveByteRouteBody", () => {
  const raw = new Uint8Array([1, 2, 3]);

  test("protobuf path forwards raw bytes and filtered metadata headers", () => {
    const vot = encode({ "content-type": "application/x-protobuf", Host: "evil" });
    const resolved = resolveByteRouteBody(
      byteRequest("application/x-protobuf; charset=binary", raw, vot),
      raw.buffer as ArrayBuffer,
    );
    expect(resolved.bytes).toEqual(raw);
    expect(resolved.headers).toEqual({ "content-type": "application/x-protobuf" });
  });

  test("protobuf path with missing/invalid metadata throws error-request", () => {
    for (const vot of [undefined, "bogus"]) {
      try {
        resolveByteRouteBody(byteRequest("Application/X-Protobuf", raw, vot), raw);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationRequestError);
        expect((error as ValidationRequestError).data).toBe("error-request");
      }
    }
  });

  test("legacy JSON envelope still works", () => {
    const envelope = JSON.stringify({ headers: { a: "b" }, body: [1, 2, 3] });
    const resolved = resolveByteRouteBody(
      byteRequest("application/json", envelope),
      new TextEncoder().encode(envelope).buffer as ArrayBuffer,
    );
    expect(resolved.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(resolved.headers).toEqual({ a: "b" });
  });

  test("malformed JSON envelope throws BadRequestError, bad shape throws error-content", () => {
    const malformed = "{oops";
    try {
      resolveByteRouteBody(
        byteRequest("application/json", malformed),
        new TextEncoder().encode(malformed).buffer as ArrayBuffer,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestError);
    }

    // Every envelope shape problem is `error-request`, matching Axum/Cloudflare.
    for (const envelope of [
      '{"headers":{}}',
      '{"headers":{},"body":"x"}',
      '{"body":[]}',
      "[1,2]",
      "null",
    ]) {
      try {
        resolveByteRouteBody(
          byteRequest("application/json", envelope),
          new TextEncoder().encode(envelope).buffer as ArrayBuffer,
        );
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationRequestError);
        expect((error as ValidationRequestError).data).toBe("error-request");
      }
    }
  });

  test("unknown content type throws error-content", () => {
    try {
      resolveByteRouteBody(byteRequest("text/plain", "x"), new ArrayBuffer(1));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationRequestError);
      expect((error as ValidationRequestError).data).toBe("error-content");
    }
  });
});

function rawBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function failRequest(contentType: string, votHeaders?: string): Request {
  return new Request("http://localhost/video-translation/fail-audio-js", {
    method: "PUT",
    headers: {
      "content-type": contentType,
      ...(votHeaders !== undefined ? { "x-vot-headers": votHeaders } : {}),
    },
  });
}

describe("resolveFailAudioJsBody", () => {
  test("accepts uppercase/parameterized JSON and forces upstream content type", () => {
    const resolved = resolveFailAudioJsBody(
      failRequest("Application/JSON; charset=utf-8"),
      rawBytes(JSON.stringify({ headers: { a: "b", "content-type": "text/plain" }, body: "hi" })),
    );
    expect(resolved).toEqual({
      body: "hi",
      headers: { a: "b", "Content-Type": "application/json" },
    });
  });

  test("empty request and malformed JSON throw BadRequestError", () => {
    for (const raw of [undefined, new ArrayBuffer(0), rawBytes("{oops")]) {
      try {
        resolveFailAudioJsBody(failRequest("application/json"), raw);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestError);
      }
    }
  });

  test("empty-string envelope body is valid and forwarded unchanged", () => {
    const resolved = resolveFailAudioJsBody(
      failRequest("application/json"),
      rawBytes(JSON.stringify({ headers: {}, body: "" })),
    );
    expect(resolved).toEqual({ body: "", headers: { "Content-Type": "application/json" } });
  });

  test("wrong content type throws error-content", () => {
    try {
      resolveFailAudioJsBody(
        failRequest("text/plain"),
        rawBytes(JSON.stringify({ headers: {}, body: "hi" })),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationRequestError);
      expect((error as ValidationRequestError).data).toBe("error-content");
    }
  });

  test("bad envelope shapes throw error-request", () => {
    for (const value of [
      null,
      [1, 2],
      "hi",
      {},
      { body: "hi" },
      { headers: "x", body: "hi" },
      { headers: {}, body: [1, 2] },
    ]) {
      try {
        resolveFailAudioJsBody(failRequest("application/json"), rawBytes(JSON.stringify(value)));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationRequestError);
        expect((error as ValidationRequestError).data).toBe("error-request");
      }
    }
  });

  test("plain JSON with X-VOT-Headers is forwarded unchanged", () => {
    const plain = JSON.stringify({ video_url: "https://youtu.be/x" });
    const resolved = resolveFailAudioJsBody(
      failRequest(
        "application/json",
        encode({ a: "b", Host: "evil", "content-type": "text/plain" }),
      ),
      rawBytes(plain),
    );
    expect(resolved).toEqual({
      body: plain,
      headers: { a: "b", "Content-Type": "application/json" },
    });
  });

  test("invalid X-VOT-Headers throws error-request", () => {
    for (const vot of ["bogus", encodeJson({ a: 1 })]) {
      try {
        resolveFailAudioJsBody(
          failRequest("application/json", vot),
          rawBytes(JSON.stringify({ video_url: "https://youtu.be/x" })),
        );
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationRequestError);
        expect((error as ValidationRequestError).data).toBe("error-request");
      }
    }
  });

  test("plain body is forwarded verbatim, even when it is not JSON", () => {
    const vot = encode({ a: "b" });
    for (const raw of ["{oops", "", "not JSON at all", '  {"video_url":"x"}  ']) {
      const resolved = resolveFailAudioJsBody(failRequest("application/json", vot), rawBytes(raw));
      expect(resolved.body).toBe(raw);
      expect(resolved.headers).toEqual({ a: "b", "Content-Type": "application/json" });
    }
  });

  test("wrong content type with X-VOT-Headers throws error-content", () => {
    try {
      resolveFailAudioJsBody(
        failRequest("text/plain", encode({ a: "b" })),
        rawBytes(JSON.stringify({ video_url: "https://youtu.be/x" })),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationRequestError);
      expect((error as ValidationRequestError).data).toBe("error-content");
    }
  });
});
