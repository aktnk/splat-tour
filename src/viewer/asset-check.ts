// Checks that an asset URL serves the file before handing it to a loader.
// Missing files otherwise surface as cryptic decoder errors, and Spark keeps
// retrying: many hosts (and Vite's dev server) answer a missing path with an
// HTML page, which the RAD reader reports as "Invalid RAD magic: 0x6f64213c"
// ("<!do").

export async function assertAssetAvailable(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Range: "bytes=0-15" }, cache: "no-store" });
  } catch {
    throw new Error(`ファイルを取得できません（通信エラーまたは CORS）: ${url}`);
  }
  if (!response.ok) {
    throw new Error(`ファイルが見つかりません（${response.status}）: ${url}`);
  }
  // Judged by the first bytes, not only by Content-Type: some servers label
  // unknown extensions as HTML (Tauri's asset protocol serves .rad and .glb
  // as text/html). No splat or model format starts with "<".
  const contentType = response.headers.get("content-type") ?? "";
  const head = new Uint8Array(await response.arrayBuffer()).subarray(0, 16);
  const text = new TextDecoder().decode(head).trimStart().toLowerCase();
  const looksLikeHtml = text.startsWith("<!doctype") || text.startsWith("<html");
  if (looksLikeHtml || (contentType.includes("text/html") && text.startsWith("<"))) {
    throw new Error(`ファイルが見つかりません（代わりに HTML が返されました）: ${url}`);
  }
}
