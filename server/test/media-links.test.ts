import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sp-medialinks-"));
const { directDownloadUrl } = await import("../src/services/media.js");

test("paylaşım bağlantıları doğrudan indirme adresine çevrilir", () => {
  assert.equal(directDownloadUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"), "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t");
  assert.equal(directDownloadUrl("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp"), "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t");
  assert.equal(directDownloadUrl("https://www.dropbox.com/scl/fi/abc/foto.jpg?rlkey=xyz&dl=0"), "https://www.dropbox.com/scl/fi/abc/foto.jpg?rlkey=xyz&dl=1");
  assert.equal(directDownloadUrl("https://ornek.com/a.jpg"), "https://ornek.com/a.jpg");
  assert.equal(directDownloadUrl("bozuk adres"), "bozuk adres");
  assert.equal(directDownloadUrl("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"), "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", "klasör bağlantısı çevrilmez");
});
