const host = "0.0.0.0"; // 0.0.0.0 - for global access, localhost - for local access
const port = 7699;
const version = "1.0.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const yandexUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36";

const s3Urls = {
  audio: "vtrans.s3-private.mds.yandex.net/tts/prod/",
  subs: "brosubs.s3-private.mds.yandex.net/vtrans/",
};

export { corsHeaders, version, host, port, yandexUserAgent, s3Urls };
