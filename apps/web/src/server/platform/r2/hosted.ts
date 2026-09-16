/**
 * The hosted R2 composition root (W912).
 *
 * Builds the {@link R2RenderOutputStore} from environment bindings. Absent
 * bindings → `null` (callers degrade honestly; the health route reports the
 * provider as unconfigured — the local/preview state).
 *
 * USAGE GUARDRAIL SEAM (for W919 — documented, NOT built this wave): the
 * free-tier matrix pins R2 at 10 GB-month storage / 1M Class A ops / 10M
 * Class B ops. The capability feed shape that should surface this is the
 * `@sporta/capability` provider-health entry (`kind: "storage"`, health
 * `ok|degraded`, `detail`/`degradedMeaning`) plus a quota entry whose
 * `quotaId` names the R2 allowance. The counters themselves (usage
 * measurement + alarms) are W919 scope; the store bounds enforced TODAY are
 * the W504 magnitudes (see `HOSTED_STORE_DEFAULT_LIMITS`).
 */
import { r2AccessKeyId, r2BucketName, r2BucketRegion, r2Endpoint, r2SecretAccessKey } from "../env";
import { R2RenderOutputStore } from "./r2-store";

let store: R2RenderOutputStore | null = null;
let resolved = false;

/** The process-wide R2 render-output store, or null when unconfigured. */
export function getHostedRenderOutputStore(): R2RenderOutputStore | null {
  if (resolved) return store;
  resolved = true;
  const endpoint = r2Endpoint();
  const accessKeyId = r2AccessKeyId();
  const secretAccessKey = r2SecretAccessKey();
  const bucket = r2BucketName();
  if (
    endpoint === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    bucket === undefined
  ) {
    return store; // null — honest unconfigured state
  }
  store = new R2RenderOutputStore({
    endpoint,
    bucket,
    credentials: {
      accessKeyId,
      secretAccessKey,
      region: r2BucketRegion() ?? "auto",
      service: "s3",
    },
  });
  return store;
}
