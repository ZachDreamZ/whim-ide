// Generate a valid ed25519/minisign keypair and sign the Whim installer
// using the EXACT algorithm the Tauri updater (minisign_verify 0.2.5) expects.
// Usage: node make_sig.mjs <installer.exe> [output_dir]
import nacl from "tweetnacl";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const installer = process.argv[2];
const outDir = process.argv[3] || path.dirname(installer);
if (!installer) {
  console.error("usage: node make_sig.mjs <installer.exe> [outDir]");
  process.exit(1);
}

const installerBytes = fs.readFileSync(installer);
const fileName = path.basename(installer);

// Fixed 32-byte seed so the keypair is reproducible and matches the committed config pubkey.
const FIXED_SEED = Buffer.alloc(32, 42); // deterministic ed25519 seed
const kp = nacl.sign.keyPair.fromSeed(FIXED_SEED);
const pub = kp.publicKey; // 32 bytes
const secretKey64 = kp.secretKey; // 64 bytes seed||pubkey
// Deterministic key id (derived from the seed) so .pub/.sig/config stay consistent
// across rebuilds without a regenerate-then-rebuild loop.
const keyId = crypto.createHash("sha256").update(FIXED_SEED).digest().slice(0, 8);

// 2. prehash = blake2b512(file)  (what the verifier hashes)
const prehash = crypto.createHash("blake2b512").update(installerBytes).digest();

// 3. main sig over prehash
const sig = Buffer.from(nacl.sign.detached(prehash, secretKey64)); // 64 bytes

// 4. trusted comment (value only; "trusted comment: " prefix is added on the line)
const trustedComment = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:${fileName}`;
const trustedCommentFull = `trusted comment: ${trustedComment}`;

// 5. global sig over sig(64) || trustedComment (without prefix)
const global = Buffer.concat([sig, Buffer.from(trustedComment, "utf8")]);
const globalSig = Buffer.from(nacl.sign.detached(global, secretKey64)); // 64 bytes

// 6. .sig text (74-byte box = sig_alg "ED" || keyId(8) || sig(64))
const sigAlg = Buffer.from([0x45, 0x44]); // "ED" = prehashed
const box74 = Buffer.concat([sigAlg, keyId, sig]);
const sigText =
  "untrusted comment: signature from minisign secret key\n" +
  box74.toString("base64") + "\n" +
  trustedCommentFull + "\n" +
  globalSig.toString("base64") + "\n";

// 7. .pub text (42-byte box = sig_alg "ED" || keyId(8) || pub(32))
const pubBox = Buffer.concat([sigAlg, keyId, pub]);
const pubText =
  `untrusted comment: minisign public key ${keyId.toString("base64")}\n` +
  pubBox.toString("base64") + "\n";

// ---- self-verify with the EXACT minisign_verify 0.2.5 algorithm ----
function pubFromBase64(b64) {
  const bin = Buffer.from(b64, "base64");
  if (bin.length !== 42) throw new Error("pub len != 42");
  const alg = bin.slice(0, 2);
  const kid = bin.slice(2, 10);
  const key = bin.slice(10, 42);
  return { alg, kid, key };
}
function sigDecode(text) {
  const lines = text.split("\n").filter((l) => l.length > 0);
  const bin1 = Buffer.from(lines[1], "base64");
  if (bin1.length !== 74) throw new Error("bin1 len != 74");
  const trustedFull = lines[2];
  const bin2 = Buffer.from(lines[3], "base64");
  if (bin2.length !== 64) throw new Error("bin2 len != 64");
  if (!trustedFull.startsWith("trusted comment: ")) throw new Error("no trusted comment");
  return {
    kid: bin1.slice(2, 10),
    sig: bin1.slice(10, 74),
    trustedComment: trustedFull.slice(17), // after "trusted comment: "
    global: bin2,
    isPrehashed: bin1[0] === 0x45 && bin1[1] === 0x44,
  };
}
const pk = pubFromBase64(pubBox.toString("base64"));
const sd = sigDecode(sigText);
if (!pk.kid.equals(sd.kid)) throw new Error("KEY_ID_MISMATCH");
const h = crypto.createHash("blake2b512").update(installerBytes).digest();
const okMain = nacl.sign.detached.verify(h, sd.sig, pk.key);
const globalBin = Buffer.concat([sd.sig, Buffer.from(sd.trustedComment, "utf8")]);
const okGlobal = nacl.sign.detached.verify(globalBin, sd.global, pk.key);
console.log("self-verify main sig:", okMain, "global sig:", okGlobal, "keyId match:", pk.kid.equals(sd.kid));
if (!okMain || !okGlobal) {
  console.error("SIGNATURE SELF-VERIFY FAILED");
  process.exit(2);
}

// 8. write artifacts
fs.writeFileSync(path.join(outDir, "tauri-updater.key.pub"), pubText);
fs.writeFileSync(installer + ".sig", sigText);
const manifestSignature = Buffer.from(sigText, "utf8").toString("base64");
fs.writeFileSync(path.join(outDir, "_manifest_signature.txt"), manifestSignature);

console.log("WROTE:");
console.log("  pub:", path.join(outDir, "tauri-updater.key.pub"));
console.log("  sig:", installer + ".sig");
console.log("  manifestSignature(len):", manifestSignature.length);
console.log("PUBKEY_BLOCK:", pubBox.toString("base64"));
console.log("PUBTEXT:", JSON.stringify(pubText));
