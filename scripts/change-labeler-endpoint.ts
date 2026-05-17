/**
 * Change ONLY the #atproto_labeler serviceEndpoint in the labeler's DID doc,
 * via the PDS-mediated PLC operation flow. Keeps the signing key
 * (#atproto_label), the PDS, rotation keys and handle untouched.
 *
 * Two phases (the PLC op requires an e-mailed token):
 *
 *   1) Request the token (also prints the planned before/after):
 *        LABELER_PASSWORD='app-password' npx tsx scripts/change-labeler-endpoint.ts
 *
 *   2) Sign + submit, using the code that arrived by e-mail:
 *        LABELER_PASSWORD='app-password' npx tsx scripts/change-labeler-endpoint.ts \
 *          --token=ABC123 --commit
 *
 * Env (defaults are this labeler's known values):
 *   LABELER_HANDLE    default etiquetasdoorkut.bsky.social
 *   LABELER_PASSWORD  required (an app-password is recommended)
 *   PDS_URL           default https://chaga.us-west.host.bsky.network
 *   NEW_ENDPOINT      default https://orkut.xn--wg8h.joseli.to
 */
import { AtpAgent } from "@atproto/api";

const HANDLE = process.env.LABELER_HANDLE ?? "etiquetasdoorkut.bsky.social";
const PASSWORD = process.env.LABELER_PASSWORD ?? "";
const PDS_URL =
  process.env.PDS_URL ?? "https://chaga.us-west.host.bsky.network";
const DID = "did:plc:3gtp7uvt63bwostaypbcb7ur";
const EXPECTED_CURRENT_ENDPOINT = "https://orkut.joselito.pw";

// atproto serviceEndpoint must NOT have a trailing slash.
const NEW_ENDPOINT = (
  process.env.NEW_ENDPOINT ?? "https://orkut.xn--wg8h.joseli.to"
).replace(/\/+$/, "");

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const tokenArg = args.find((a) => a.startsWith("--token="));
const token = tokenArg ? tokenArg.split("=")[1] : undefined;

const fail = (msg: string): never => {
  console.error(`ABORT: ${msg}`);
  process.exit(1);
};

const main = async () => {
  if (!PASSWORD) fail("LABELER_PASSWORD not set.");

  const agent = new AtpAgent({ service: PDS_URL });
  await agent.login({ identifier: HANDLE, password: PASSWORD });
  if (agent.did !== DID) {
    fail(`Logged-in DID ${agent.did} != expected ${DID}.`);
  }

  // Source of truth must be the live PLC doc, NOT
  // getRecommendedDidCredentials: the bsky.social PDS only "recommends" the
  // identity bits it manages (PDS/handle/atproto key) and OMITS the
  // out-of-band #atproto_label key and #atproto_labeler service. Building the
  // op from the recommended creds would drop both and orphan every label.
  const creds = (await (
    await fetch(`https://plc.directory/${DID}/data`)
  ).json()) as {
    verificationMethods?: Record<string, string>;
    rotationKeys?: string[];
    alsoKnownAs?: string[];
    services?: Record<string, { type: string; endpoint: string }>;
  };

  const services = (creds.services ?? {}) as Record<
    string,
    { type: string; endpoint: string }
  >;
  const vms = (creds.verificationMethods ?? {}) as Record<string, string>;

  const labeler = services.atproto_labeler;
  if (!labeler) fail("No atproto_labeler service in current credentials.");
  if (!vms.atproto_label) {
    fail("No atproto_label verification method — refusing (would orphan labels).");
  }
  if (labeler.endpoint !== EXPECTED_CURRENT_ENDPOINT) {
    console.warn(
      `WARN: current labeler endpoint is "${labeler.endpoint}", ` +
        `expected "${EXPECTED_CURRENT_ENDPOINT}". Inspect before continuing.`
    );
  }

  console.log("Planned change (only #atproto_labeler.endpoint):");
  console.log(`  from: ${labeler.endpoint}`);
  console.log(`  to:   ${NEW_ENDPOINT}`);
  console.log("Unchanged:");
  console.log(`  pds:            ${services.atproto_pds?.endpoint}`);
  console.log(`  atproto_label:  ${vms.atproto_label}`);
  console.log(`  atproto:        ${vms.atproto}`);
  console.log(`  rotationKeys:   ${(creds.rotationKeys ?? []).length} key(s)`);
  console.log(`  alsoKnownAs:    ${JSON.stringify(creds.alsoKnownAs ?? [])}`);

  if (labeler.endpoint === NEW_ENDPOINT) {
    console.log("\nEndpoint already set to the target. Nothing to do.");
    return;
  }

  const nextServices = {
    ...services,
    atproto_labeler: { ...labeler, endpoint: NEW_ENDPOINT },
  };
  const credentialsInput = {
    rotationKeys: creds.rotationKeys,
    alsoKnownAs: creds.alsoKnownAs,
    verificationMethods: creds.verificationMethods,
    services: nextServices,
  };

  if (!commit || !token) {
    await agent.com.atproto.identity.requestPlcOperationSignature();
    console.log(
      "\nDRY-RUN. A confirmation code was e-mailed to the account.\n" +
        "Re-run with:  --token=<code-from-email> --commit"
    );
    return;
  }

  const { data: signed } =
    await agent.com.atproto.identity.signPlcOperation({
      token,
      ...credentialsInput,
    });
  await agent.com.atproto.identity.submitPlcOperation({
    operation: signed.operation,
  });

  console.log("\nSubmitted. Verifying via plc.directory ...");
  const doc = await (
    await fetch(`https://plc.directory/${DID}`)
  ).json();
  const live = (doc.service ?? []).find(
    (s: { id: string }) => s.id === "#atproto_labeler"
  );
  console.log(`  live #atproto_labeler endpoint: ${live?.serviceEndpoint}`);
  if (live?.serviceEndpoint !== NEW_ENDPOINT) {
    console.warn(
      "WARN: not reflecting the new endpoint yet (PLC may take a moment)."
    );
  } else {
    console.log("OK: endpoint updated.");
  }
};

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
