/**
 * REL-026 — the NEGATIVE battery: every bypass-shaped input refuses TYPED,
 * fail-closed, WITH the refusal recorded — never silently dropped.
 *
 * Table-driven over the full bypass surface of this slice:
 * - UNDECLARED BASIS shapes (store gate, pipeline driver, user-fed upload,
 *   feed hook returning null);
 * - FORGED RIGHTS shapes (a forged byte-access token, a mis-scoped token,
 *   wrong-class bases riding the wrong connector path, a malformed basis);
 * - AMBIGUOUS POLICY shapes (a reference-only restriction no basis can
 *   lift, a no-transformation restriction blocking normalization, honest
 *   bytes-unavailable, benchmark ineligibility, illegal state jumps,
 *   unknown restriction vocabulary, connector kind mismatches).
 *
 * Each row is driven through the refusal ledger's `attempt` (the audit
 * wrapper): the row must THROW the expected typed error (fail-closed —
 * the ledger never swallows), the record state must stay where the law
 * left it, and the ledger must carry the refusal afterwards with the same
 * code + failureClass. The closing assertion pins the total: every row of
 * the battery left exactly one recorded refusal — nothing was dropped.
 */
import { describe, expect, test } from "bun:test";
import {
  CorpusApiError,
  acquireSourceFromAdapter,
  createAuthorizedFeedConnector,
  createBenchmarkRegistrar,
  createCorpusStore,
  createReferenceAdapter,
  createReferenceOnlyConnector,
  createUserUploadConnector,
  createRefusalLedger,
  isCorpusError,
} from "../src";
import type { AuthorizedByteAccess, CorpusFailureClass, RefusalLedger } from "../src";
import {
  fixtureBytes,
  noTransformationMetadata,
  providerPermittedBasis,
  referenceOnlyMetadata,
  uploadMetadata,
  userOwnedBasis,
  youtubeMetadata,
} from "./fixtures";

/** One battery row. */
interface BatteryRow {
  readonly name: string;
  readonly operation: string;
  /** Sets the row up (a fresh store per row keeps the law local). */
  readonly run: (context: BatteryContext) => Promise<unknown>;
  readonly expectedCode: string;
  readonly expectedFailureClass: CorpusFailureClass;
  /** The subject the refusal is about (recorded in the ledger). */
  readonly subjectRef: string;
  /** Optional fail-closed check on the record after the refusal. */
  readonly postCheck?: (context: BatteryContext) => Promise<void>;
}

/** The per-row harness: a fresh store, adapter, registrar and ledger. */
interface BatteryContext {
  readonly store: ReturnType<typeof createCorpusStore>;
  readonly ledger: RefusalLedger;
  readonly registrar: ReturnType<typeof createBenchmarkRegistrar>;
}

/** A fixture adapter WITH bytes, over the standard youtube metadata. */
function adapterWithBytes() {
  const metadata = youtubeMetadata();
  return {
    metadata,
    adapter: createReferenceAdapter(
      { metadata: [metadata], bytes: { [metadata.canonicalUrl]: fixtureBytes("rel026-neg") } },
      { provider: "youtube-fixture" },
    ),
  };
}

/** A structurally similar object WITHOUT the module-private brand. */
function forgedToken(sourceId: string): AuthorizedByteAccess {
  return {
    sourceId,
    provider: "youtube",
    providerContentId: "vid-001",
    canonicalUrl: youtubeMetadata().canonicalUrl,
    basisDigest: "0".repeat(64),
    grantedAt: 0,
  } as unknown as AuthorizedByteAccess;
}

describe("the negative battery: every bypass shape refuses typed, fail-closed, recorded", () => {
  const rows: readonly BatteryRow[] = [
    {
      name: "authorizeAccess with NO basis (the undeclared-basis shape at the gate)",
      operation: "authorize-access",
      subjectRef: "https://www.youtube.com/watch?v=vid-001",
      run: async ({ store }) => {
        const registered = await store.registerReference(youtubeMetadata());
        return store.authorizeAccess(registered.sourceId);
      },
      expectedCode: "corpus.rights-basis-required",
      expectedFailureClass: "rights",
      postCheck: async ({ store }) => {
        const record = await store.get("source-1");
        expect(record.state).toBe("referenced");
        expect(record.rightsBasis).toBeNull();
      },
    },
    {
      name: "the pipeline driver with NO basis (the undeclared-basis shape end-to-end)",
      operation: "pipeline-acquire",
      subjectRef: "https://www.youtube.com/watch?v=vid-001",
      run: async ({ store }) => {
        const registered = await store.registerReference(youtubeMetadata());
        return acquireSourceFromAdapter(store, registered.sourceId, adapterWithBytes().adapter);
      },
      expectedCode: "corpus.rights-basis-required",
      expectedFailureClass: "rights",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("referenced");
      },
    },
    {
      name: "a MALFORMED basis (empty grant ref) is not a basis",
      operation: "authorize-access",
      subjectRef: "https://www.youtube.com/watch?v=vid-001",
      run: async ({ store }) => {
        const registered = await store.registerReference(youtubeMetadata());
        return store.authorizeAccess(registered.sourceId, {
          ...providerPermittedBasis(),
          grantRef: "",
        });
      },
      expectedCode: "corpus.rights-basis-required",
      expectedFailureClass: "rights",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("referenced");
      },
    },
    {
      name: "a FORGED byte-access token (no store-minted brand)",
      operation: "record-acquired-bytes",
      subjectRef: "https://www.youtube.com/watch?v=vid-001",
      run: async ({ store }) => {
        const registered = await store.registerReference(youtubeMetadata());
        return store.recordAcquiredBytes(
          registered.sourceId,
          forgedToken(registered.sourceId),
          fixtureBytes("forged"),
        );
      },
      expectedCode: "corpus.access-invalid",
      expectedFailureClass: "rights",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("referenced");
      },
    },
    {
      name: "a MIS-SCOPED token (minted for A, presented for B)",
      operation: "record-acquired-bytes",
      subjectRef: "https://www.youtube.com/watch?v=vid-002",
      run: async ({ store }) => {
        const a = await store.registerReference(youtubeMetadata());
        const b = await store.registerReference(
          youtubeMetadata({
            providerContentId: "vid-002",
            canonicalUrl: "https://www.youtube.com/watch?v=vid-002",
          }),
        );
        const tokenForA = await store.authorizeAccess(a.sourceId, providerPermittedBasis());
        return store.recordAcquiredBytes(b.sourceId, tokenForA, fixtureBytes("b-bytes"));
      },
      expectedCode: "corpus.access-invalid",
      expectedFailureClass: "rights",
      postCheck: async ({ store }) => {
        expect((await store.get("source-2")).state).toBe("referenced"); // B untouched
      },
    },
    {
      name: "a basis cannot LIFT a reference-only restriction (ambiguous policy, refused)",
      operation: "authorize-access",
      subjectRef: "https://www.youtube.com/watch?v=vid-ref-only",
      run: async ({ store }) => {
        const registered = await store.registerReference(referenceOnlyMetadata());
        return store.authorizeAccess(registered.sourceId, providerPermittedBasis());
      },
      expectedCode: "corpus.restriction-forbidden",
      expectedFailureClass: "restriction",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("referenced");
      },
    },
    {
      name: "a no-transformation restriction blocks NORMALIZATION (access is not transformation)",
      operation: "normalize",
      subjectRef: "https://www.youtube.com/watch?v=vid-no-transform",
      run: async ({ store }) => {
        const metadata = noTransformationMetadata();
        const registered = await store.registerReference(metadata);
        const adapter = createReferenceAdapter(
          {
            metadata: [metadata],
            bytes: { [metadata.canonicalUrl]: fixtureBytes("no-transform") },
          },
          { provider: "youtube-fixture" },
        );
        return acquireSourceFromAdapter(store, registered.sourceId, adapter, {
          basis: providerPermittedBasis(),
        }).then((acquired) => store.normalizeSource(acquired.sourceId));
      },
      expectedCode: "corpus.restriction-forbidden",
      expectedFailureClass: "restriction",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("acquired"); // acquired, never normalized
      },
    },
    {
      name: "normalizing a NEVER-ACQUIRED reference is an illegal jump",
      operation: "normalize",
      subjectRef: "https://www.youtube.com/watch?v=vid-001",
      run: async ({ store }) => {
        const registered = await store.registerReference(youtubeMetadata());
        return store.normalizeSource(registered.sourceId);
      },
      expectedCode: "corpus.illegal-transition",
      expectedFailureClass: "illegal-transition",
    },
    {
      name: "the adapter has NO bytes (availability is honest, never fabricated)",
      operation: "pipeline-acquire",
      subjectRef: "https://www.youtube.com/watch?v=vid-001",
      run: async ({ store }) => {
        // The adapter WITHOUT a byte store: authorization succeeds, the
        // retrieval refuses honestly.
        const metadata = youtubeMetadata();
        const adapter = createReferenceAdapter(
          { metadata: [metadata] },
          { provider: "youtube-fixture" },
        );
        const registered = await store.registerReference(metadata);
        return acquireSourceFromAdapter(store, registered.sourceId, adapter, {
          basis: providerPermittedBasis(),
        });
      },
      expectedCode: "corpus.bytes-unavailable",
      expectedFailureClass: "not-found",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("authorized-for-access");
      },
    },
    {
      name: "user-fed upload with NO declared basis (the user path pays the one law)",
      operation: "ingest-user-upload",
      subjectRef: "corpus://user-upload/(none)",
      run: async ({ store }) =>
        store.ingestUserUpload({
          bytes: fixtureBytes("upload-no-basis"),
          metadata: uploadMetadata(),
        }),
      expectedCode: "corpus.rights-basis-required",
      expectedFailureClass: "rights",
      postCheck: async ({ store }) => {
        expect(await store.list()).toEqual([]); // nothing was recorded
      },
    },
    {
      name: "a WRONG-CLASS basis riding the user-upload connector (rights laundering shape)",
      operation: "connector-acquire",
      subjectRef: "user-upload connector",
      run: async ({ store }) => {
        const connector = createUserUploadConnector();
        return connector.acquire(store, {
          kind: "user-upload",
          bytes: fixtureBytes("launder"),
          declaredBasis: { ...providerPermittedBasis() }, // feed/provider basis on the upload path
          metadata: uploadMetadata(),
        });
      },
      expectedCode: "corpus.validation",
      expectedFailureClass: "validation",
      postCheck: async ({ store }) => {
        expect(await store.list()).toEqual([]);
      },
    },
    {
      name: "the user-upload connector refuses a mismatched request kind",
      operation: "connector-acquire",
      subjectRef: "user-upload connector",
      run: async ({ store }) => {
        const connector = createUserUploadConnector();
        return connector.acquire(store, {
          kind: "reference-only",
          canonicalUrl: youtubeMetadata().canonicalUrl,
        });
      },
      expectedCode: "corpus.validation",
      expectedFailureClass: "validation",
    },
    {
      name: "the authorized-feed hook returns NULL (the caller cannot satisfy authorization)",
      operation: "connector-acquire",
      subjectRef: "feed:tracking-stats",
      run: async ({ store }) => {
        const metadata = youtubeMetadata({
          provider: "feed:tracking-stats",
          canonicalUrl: "https://feeds.example/items/1",
        });
        const connector = createAuthorizedFeedConnector({
          feedId: "feed:tracking-stats",
          items: [{ metadata, bytes: fixtureBytes("feed-item") }],
          authorizationHook: async () => null,
        });
        return connector.acquire(store, {
          kind: "authorized-feed",
          canonicalUrl: metadata.canonicalUrl,
        });
      },
      expectedCode: "corpus.rights-basis-required",
      expectedFailureClass: "rights",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("referenced");
      },
    },
    {
      name: "the authorized-feed hook returns a WRONG-CLASS basis (forged rights shape)",
      operation: "connector-acquire",
      subjectRef: "feed:tracking-stats",
      run: async ({ store }) => {
        const metadata = youtubeMetadata({
          provider: "feed:tracking-stats",
          canonicalUrl: "https://feeds.example/items/1",
        });
        const connector = createAuthorizedFeedConnector({
          feedId: "feed:tracking-stats",
          items: [{ metadata, bytes: fixtureBytes("feed-item") }],
          authorizationHook: async () => userOwnedBasis(), // an ownership claim on a feed item
        });
        return connector.acquire(store, {
          kind: "authorized-feed",
          canonicalUrl: metadata.canonicalUrl,
        });
      },
      expectedCode: "corpus.validation",
      expectedFailureClass: "validation",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("referenced");
      },
    },
    {
      name: "the authorized-feed hook returns a MALFORMED basis",
      operation: "connector-acquire",
      subjectRef: "feed:tracking-stats",
      run: async ({ store }) => {
        const metadata = youtubeMetadata({
          provider: "feed:tracking-stats",
          canonicalUrl: "https://feeds.example/items/1",
        });
        const connector = createAuthorizedFeedConnector({
          feedId: "feed:tracking-stats",
          items: [{ metadata, bytes: fixtureBytes("feed-item") }],
          authorizationHook: async () => ({
            ...userOwnedBasis(),
            basisType: "authorized-feed",
            grantRef: "",
          }),
        });
        return connector.acquire(store, {
          kind: "authorized-feed",
          canonicalUrl: metadata.canonicalUrl,
        });
      },
      expectedCode: "corpus.rights-basis-required",
      expectedFailureClass: "rights",
    },
    {
      name: "the reference-only connector has NO byte path AT ALL (class 5 law)",
      operation: "connector-acquire",
      subjectRef: "reference-only connector",
      run: async ({ store }) => {
        const connector = createReferenceOnlyConnector({ metadata: [youtubeMetadata()] });
        return connector.acquire(store, {
          kind: "reference-only",
          canonicalUrl: youtubeMetadata().canonicalUrl,
        });
      },
      expectedCode: "corpus.restriction-forbidden",
      expectedFailureClass: "restriction",
    },
    {
      name: "a benchmark over a REFERENCE-ONLY source is ineligible (what was never acquired can never be a benchmark)",
      operation: "benchmark-register",
      subjectRef: "https://www.youtube.com/watch?v=vid-ref-only",
      run: async ({ store, registrar }) => {
        const registered = await store.registerReference(referenceOnlyMetadata());
        return registrar.register({
          sourceId: registered.sourceId,
          timeWindow: { startMs: 0, endMs: 1 },
          versions: [{ name: "optical-flow", kind: "feature", version: "1.0.0" }],
        });
      },
      expectedCode: "corpus.benchmark-ineligible",
      expectedFailureClass: "restriction",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("referenced");
      },
    },
    {
      name: "a benchmark over an ACQUIRED-BUT-NOT-NORMALIZED source is ineligible (the honest not-yet)",
      operation: "benchmark-register",
      subjectRef: "https://www.youtube.com/watch?v=vid-001",
      run: async ({ store, registrar }) => {
        const { adapter } = adapterWithBytes();
        const registered = await store.registerReference(youtubeMetadata());
        await acquireSourceFromAdapter(store, registered.sourceId, adapter, {
          basis: providerPermittedBasis(),
        });
        return registrar.register({
          sourceId: registered.sourceId,
          timeWindow: { startMs: 0, endMs: 1 },
          versions: [{ name: "optical-flow", kind: "feature", version: "1.0.0" }],
        });
      },
      expectedCode: "corpus.benchmark-ineligible",
      expectedFailureClass: "restriction",
      postCheck: async ({ store }) => {
        expect((await store.get("source-1")).state).toBe("acquired");
      },
    },
    {
      name: "an UNKNOWN restriction in registration metadata is a caller error (closed vocabulary)",
      operation: "register-reference",
      subjectRef: "https://www.youtube.com/watch?v=vid-001",
      run: async ({ store }) =>
        store.registerReference(
          youtubeMetadata({ restrictions: ["totally-open-trust-me" as never] }),
        ),
      expectedCode: "corpus.validation",
      expectedFailureClass: "validation",
    },
  ];

  for (const row of rows) {
    test(`REFUSES + RECORDS: ${row.name}`, async () => {
      const store = createCorpusStore();
      const ledger = createRefusalLedger();
      const registrar = createBenchmarkRegistrar(store);
      const context: BatteryContext = { store, ledger, registrar };

      let caught: unknown;
      try {
        await ledger.attempt(row.operation, { subject: row.subjectRef }, () => row.run(context));
      } catch (error) {
        caught = error;
      }

      // Fail-closed: the row THREW (the ledger never swallows).
      expect(caught).toBeInstanceOf(CorpusApiError);
      const typed = caught as CorpusApiError;
      expect(isCorpusError(typed)).toBe(true);
      expect(typed.code).toBe(row.expectedCode);
      expect(typed.failureClass).toBe(row.expectedFailureClass);

      // Recorded: the ledger carries the refusal with the same typed shape.
      const recorded = ledger.list({ operation: row.operation });
      expect(recorded).toHaveLength(1);
      const first = recorded[0];
      if (first === undefined) {
        throw new Error(`the ledger recorded no refusal for operation ${row.operation}`);
      }
      expect(first.code).toBe(row.expectedCode);
      expect(first.failureClass).toBe(row.expectedFailureClass);
      expect(first.subject).toMatchObject({ subject: row.subjectRef });
      expect(ledger.get(first.refusalId)).toEqual(first);

      // The law left the record where it belongs.
      if (row.postCheck !== undefined) {
        await row.postCheck(context);
      }
    });
  }

  test("the battery's total: every row left exactly one recorded refusal — none silently dropped", async () => {
    // Re-drive every row through ONE ledger (a fresh store per row, exactly
    // as the per-row tests drive them) and count: the closing invariant of
    // the battery is per-row recording, so the shared ledger must hold
    // exactly one refusal per row.
    const ledger = createRefusalLedger();
    let refusals = 0;
    for (const row of rows) {
      const store = createCorpusStore();
      const context: BatteryContext = { store, ledger, registrar: createBenchmarkRegistrar(store) };
      try {
        await ledger.attempt(row.operation, { subject: row.subjectRef }, () => row.run(context));
      } catch {
        refusals += 1;
      }
    }
    expect(refusals).toBe(rows.length);
    expect(ledger.count()).toBe(rows.length);
    // Every recorded refusal carries a typed code from the corpus family.
    for (const record of ledger.list()) {
      expect(record.code).toMatch(/^corpus\./);
      expect(record.at).toBeGreaterThan(0);
    }
    // And the count by code matches the table's own expectations (rows may
    // share an operation name; the typed CODE is what the battery pins).
    for (const row of rows) {
      expect(ledger.count({ code: row.expectedCode })).toBe(
        rows.filter((candidate) => candidate.expectedCode === row.expectedCode).length,
      );
    }
  });
});
