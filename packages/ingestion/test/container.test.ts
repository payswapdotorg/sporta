/**
 * W101 container sniffing tests: table-driven magic-byte fixtures built
 * inline as Uint8Arrays (no fixture files). Every buffer is deterministic —
 * no I/O, no clock, no randomness (docs/testing/HARNESS.md).
 */
import { describe, expect, test } from "bun:test";
import { sniffContainer } from "../src/index";
import type { Container, ContainerInfo } from "../src/index";

/** Builds a Uint8Array from a hex string (whitespace tolerated). */
function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex fixture: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isInteger(byte)) throw new Error(`bad hex byte in fixture: ${hex}`);
    out[i] = byte;
  }
  return out;
}

/** A 189-byte MPEG-TS-shaped buffer: 0x47 at 0 and 188, filler elsewhere. */
function mpegtsBytes(fill = 0x11): Uint8Array {
  const bytes = new Uint8Array(189);
  bytes[0] = 0x47;
  bytes[188] = 0x47;
  bytes.fill(fill, 1, 188);
  return bytes;
}

const CASES: ReadonlyArray<{
  name: string;
  bytes: Uint8Array;
  expected: Container;
  mimeType: string;
}> = [
  {
    // size=0x20 (32), "ftyp", brand "isom", then padding to the box size.
    name: "mp4: ftyp box with isom brand",
    bytes: fromHex("00000020 66747970 69736F6D 00000000" + "00".repeat(20)),
    expected: "mp4",
    mimeType: "video/mp4",
  },
  {
    name: "mp4: ftyp box with qt brand",
    bytes: fromHex("00000018 66747970 71742020 00000000" + "00".repeat(12)),
    expected: "mp4",
    mimeType: "video/mp4",
  },
  {
    // Minimum buffer carrying a complete ftyp signature at 4..8.
    name: "mp4: exactly 8 bytes (size box + ftyp)",
    bytes: fromHex("00000008 66747970"),
    expected: "mp4",
    mimeType: "video/mp4",
  },
  {
    // Sniffing is magic-byte level only: the size box is not validated.
    name: "mp4: nonsense box size still matches (size is not validated)",
    bytes: fromHex("FFFFFFFF 66747970 69736F6D"),
    expected: "mp4",
    mimeType: "video/mp4",
  },
  {
    // EBML magic, header-size vint, DocType element (0x4282, len 4, "webm").
    name: "webm: EBML magic + DocType 'webm'",
    bytes: fromHex("1A45DFA3 84 428284776562 6D" + "00".repeat(19)),
    expected: "webm",
    mimeType: "video/webm",
  },
  {
    // Realistic header: other EBML children precede the DocType element.
    name: "webm: DocType after sibling header elements",
    bytes: fromHex("1A45DFA3 9F 42868101 42F78101 42F28104 42F38108 4282847765626D"),
    expected: "webm",
    mimeType: "video/webm",
  },
  {
    name: "mkv: EBML magic + DocType 'matroska'",
    bytes: fromHex("1A45DFA3 84 4282886D6174726F736B61" + "00".repeat(16)),
    expected: "mkv",
    mimeType: "video/x-matroska",
  },
  {
    // No readable DocType: EBML family defaults to Matroska (documented rule).
    name: "mkv: EBML magic without a readable DocType defaults to matroska",
    bytes: fromHex("1A45DFA3 84 42868101 42F78101" + "00".repeat(24)),
    expected: "mkv",
    mimeType: "video/x-matroska",
  },
  {
    // The bare magic is a complete EBML signature -> Matroska family default.
    name: "mkv: bare 4-byte EBML magic",
    bytes: fromHex("1A45DFA3"),
    expected: "mkv",
    mimeType: "video/x-matroska",
  },
  {
    name: "mpegts: 0x47 sync bytes at offsets 0 and 188",
    bytes: mpegtsBytes(),
    expected: "mpegts",
    mimeType: "video/mp2t",
  },
  {
    name: "avi: RIFF header with 'AVI ' form type",
    bytes: fromHex("52494646 00001000 41564920" + "00".repeat(52)),
    expected: "avi",
    mimeType: "video/x-msvideo",
  },
  {
    name: "unknown: empty buffer",
    bytes: new Uint8Array(0),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
  {
    name: "unknown: garbage bytes",
    bytes: fromHex("DEADBEEF CAFEBABE 01234567 89ABCDEF"),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
  {
    name: "unknown: 3-byte garbage",
    bytes: fromHex("667479"),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
  {
    // 7 bytes: 'ftyp' would need offset 4..8, so the signature is incomplete.
    name: "unknown: truncated ftyp prefix (7 bytes)",
    bytes: fromHex("00000020 667479"),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
  {
    name: "unknown: truncated EBML magic (3 bytes)",
    bytes: fromHex("1A45DF"),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
  {
    // 0x47 at offset 0 but NOT at 188: no packet alignment.
    name: "unknown: 0x47 at 0 but not at 188",
    bytes: (() => {
      const bytes = mpegtsBytes();
      bytes[188] = 0x00;
      return bytes;
    })(),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
  {
    // Fewer than 189 bytes: offset 188 cannot even be checked.
    name: "unknown: 100 bytes starting with 0x47 (too short for alignment)",
    bytes: (() => {
      const bytes = new Uint8Array(100);
      bytes[0] = 0x47;
      bytes.fill(0x11, 1);
      return bytes;
    })(),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
  {
    // RIFF is not enough: the form type must be "AVI ".
    name: "unknown: RIFF header with 'WAVE' form type (not AVI)",
    bytes: fromHex("52494646 00001000 57415645" + "00".repeat(52)),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
  {
    // "RIFF" alone is only 4 bytes; "AVI " at 8..12 needs >= 12 bytes.
    name: "unknown: RIFF header too short to carry the AVI form type",
    bytes: fromHex("52494646 000010"),
    expected: "unknown",
    mimeType: "application/octet-stream",
  },
];

describe("sniffContainer", () => {
  test("classifies each magic-byte fixture", () => {
    for (const fixture of CASES) {
      const info: ContainerInfo = sniffContainer(fixture.bytes);
      expect(info.container).toBe(fixture.expected);
      expect(info.mimeType).toBe(fixture.mimeType);
    }
  });

  test("is pure: repeated calls return deep-equal results", () => {
    const bytes = fromHex("00000020 66747970 69736F6D");
    expect(sniffContainer(bytes)).toEqual(sniffContainer(bytes));
  });

  test("describes the mp4 detection rule via detectedBy", () => {
    const info = sniffContainer(fromHex("00000020 66747970 69736F6D"));
    expect(info.detectedBy).toContain("ftyp");
    expect(info.detectedBy).toContain("offset 4");
  });

  test("describes the webm detection rule via detectedBy", () => {
    const info = sniffContainer(fromHex("1A45DFA3 84 4282847765626D"));
    expect(info.detectedBy).toContain("EBML");
    expect(info.detectedBy).toContain("webm");
  });

  test("describes the mkv-with-DocType detection rule via detectedBy", () => {
    const info = sniffContainer(fromHex("1A45DFA3 84 4282886D6174726F736B61"));
    expect(info.detectedBy).toContain("EBML");
    expect(info.detectedBy).toContain("matroska");
  });

  test("documents the mkv fallback when DocType is unreadable", () => {
    const info = sniffContainer(fromHex("1A45DFA3 84 42868101 42F78101"));
    expect(info.detectedBy).toContain("defaulted");
  });

  test("describes the mpegts and avi detection rules via detectedBy", () => {
    expect(sniffContainer(mpegtsBytes()).detectedBy).toContain("0x47");
    expect(sniffContainer(fromHex("52494646 00001000 41564920")).detectedBy).toContain("RIFF");
  });

  test("describes the unknown result as signature-free", () => {
    const info = sniffContainer(new Uint8Array(0));
    expect(info.detectedBy.toLowerCase()).toContain("no known");
  });
});
